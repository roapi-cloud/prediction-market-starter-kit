import { getEvents } from "@/lib/gamma"
import { parsePrices } from "@/lib/prices"
import { readFile } from "node:fs/promises"
import type { SyntheticTick } from "../ingest/adapter"
import type {
  IDataSource,
  DataSourceConfig,
  DataSourceCallbacks,
} from "./types"

function clampPrice(value: number): number {
  return Math.max(0.01, Math.min(0.99, value))
}

export class RestDataSource implements IDataSource {
  private config: DataSourceConfig["rest"]
  private running = false
  private pollTimer: NodeJS.Timeout | null = null
  private callbacks: DataSourceCallbacks = {}
  private lastTicks: Map<string, SyntheticTick> = new Map()

  constructor(config: DataSourceConfig["rest"]) {
    this.config = config
  }

  async fetchOnce(): Promise<SyntheticTick[]> {
    let events: Awaited<ReturnType<typeof getEvents>>
    try {
      events = await getEvents({
        active: true,
        closed: false,
        archived: false,
        limit: this.config.tickLimit,
      })
    } catch {
      const snapshot = await readFile(
        new URL("../fixtures/gamma-events.snapshot.json", import.meta.url),
        "utf8"
      )
      events = JSON.parse(snapshot)
    }

    const ticks: SyntheticTick[] = []
    const ts = Date.now()

    for (const event of events) {
      for (const market of event.markets ?? []) {
        const [yes, no] = parsePrices(market)
        if (yes <= 0 || no <= 0) continue

        const spread = 0.01
        const tick: SyntheticTick = {
          ts,
          marketId: market.id,
          yesBid: clampPrice(yes - spread),
          yesAsk: clampPrice(yes + spread),
          noBid: clampPrice(no - spread),
          noAsk: clampPrice(no + spread),
          volume: Math.max(1, market.volume_24hr || market.volume || 1),
        }
        ticks.push(tick)
        this.lastTicks.set(market.id, tick)
      }
    }

    return ticks
  }

  start(callbacks: DataSourceCallbacks): void {
    this.callbacks = callbacks
    this.running = true
    this.poll()
    callbacks.onConnect?.()
  }

  private async poll(): Promise<void> {
    if (!this.running) return

    try {
      const ticks = await this.fetchOnce()
      for (const tick of ticks) {
        this.callbacks.onTick?.(tick)
      }
    } catch (err) {
      this.callbacks.onError?.(
        err instanceof Error ? err : new Error(String(err))
      )
    }

    if (this.running) {
      this.pollTimer = setTimeout(() => this.poll(), this.config.pollIntervalMs)
    }
  }

  stop(): void {
    this.running = false
    if (this.pollTimer) {
      clearTimeout(this.pollTimer)
      this.pollTimer = null
    }
    this.callbacks.onDisconnect?.()
  }

  isRunning(): boolean {
    return this.running
  }
}
