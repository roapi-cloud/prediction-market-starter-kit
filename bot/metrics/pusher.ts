import type { MetricsSnapshot, StrategyMetrics } from "../contracts/types"

export class MetricsPusher {
  private endpoint: string
  private ws: WebSocket | null = null
  private reconnectInterval = 5000
  private maxRetries = 3
  private retryCount = 0
  private connected = false
  private queue: MetricsSnapshot[] = []

  constructor(endpoint: string) {
    this.endpoint = endpoint
    this.connect()
  }

  private connect(): void {
    try {
      this.ws = new WebSocket(this.endpoint)
      this.ws.onopen = () => {
        this.connected = true
        this.retryCount = 0
        this.flushQueue()
      }
      this.ws.onclose = () => {
        this.connected = false
        this.retryConnection()
      }
      this.ws.onerror = () => {
        this.connected = false
      }
    } catch {
      this.connected = false
    }
  }

  private retryConnection(): void {
    if (this.retryCount >= this.maxRetries) return
    this.retryCount++
    setTimeout(() => this.connect(), this.reconnectInterval)
  }

  push(snapshot: MetricsSnapshot): void {
    if (!this.connected) {
      this.queue.push(snapshot)
      return
    }
    this.send(snapshot)
  }

  pushBatch(snapshots: MetricsSnapshot[]): void {
    for (const snap of snapshots) {
      this.push(snap)
    }
  }

  private send(snapshot: MetricsSnapshot): void {
    if (!this.ws || !this.connected) return
    const data = JSON.stringify(this.serialize(snapshot))
    this.ws.send(data)
  }

  private flushQueue(): void {
    while (this.queue.length > 0 && this.connected) {
      const snap = this.queue.shift()
      if (snap) this.send(snap)
    }
  }

  private serialize(snap: MetricsSnapshot): Record<string, unknown> {
    const strategyObj: Record<string, StrategyMetrics> = {}
    for (const [key, value] of snap.strategyMetrics) {
      strategyObj[key] = value
    }
    return {
      ...snap,
      strategyMetrics: strategyObj,
    }
  }

  isConnected(): boolean {
    return this.connected
  }

  getQueueLength(): number {
    return this.queue.length
  }

  close(): void {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.connected = false
  }
}
