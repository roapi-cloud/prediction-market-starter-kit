import type {
  AlertConfig,
  AlertEvent,
  AlertRule,
  AlertChannel,
  MetricsSnapshot,
} from "../contracts/types"
import { AlertChannels } from "./channels"
import { evaluateRule, formatMessage, getMetricValue } from "./rules"

export class AlertSystem {
  private config: AlertConfig
  private channels: AlertChannels
  private activeAlerts: Map<string, AlertEvent> = new Map()
  private lastTriggerTime: Map<string, number> = new Map()
  private alertHistory: AlertEvent[] = []

  constructor(config: AlertConfig) {
    this.config = config
    this.channels = new AlertChannels()
  }

  check(snapshot: MetricsSnapshot): AlertEvent[] {
    const alerts: AlertEvent[] = []
    const now = Date.now()
    const data = this.snapshotToData(snapshot)

    for (const rule of this.config.rules) {
      const lastTrigger = this.lastTriggerTime.get(rule.name) ?? 0
      if (now - lastTrigger < this.config.cooldownMs) continue

      const value = getMetricValue(rule.metric, data)
      if (evaluateRule(rule, value)) {
        const alert = this.createAlert(rule, value, now)
        alerts.push(alert)
        this.lastTriggerTime.set(rule.name, now)
        this.activeAlerts.set(alert.id, alert)
        this.alertHistory.push(alert)
      }
    }

    return alerts
  }

  private snapshotToData(
    snapshot: MetricsSnapshot
  ): Record<string, number | string> {
    return {
      pnl: snapshot.pnl,
      pnlPct: snapshot.pnlPct,
      drawdown: snapshot.drawdown,
      drawdownPct: snapshot.drawdownPct,
      winRate: snapshot.winRate,
      legCompletionRate: snapshot.legCompletionRate,
      avgSlippageBps: snapshot.avgSlippageBps,
      avgDelayMs: snapshot.avgDelayMs,
      orderFillRate: snapshot.orderFillRate,
      hedgeSuccessRate: snapshot.hedgeSuccessRate,
      dataLatencyMs: snapshot.dataLatencyMs,
      eventThroughput: snapshot.eventThroughput,
      activeStrategies: snapshot.activeStrategies,
      riskState: snapshot.riskState,
    }
  }

  private createAlert(rule: AlertRule, value: number, ts: number): AlertEvent {
    return {
      id: `${rule.name}-${ts}`,
      rule: rule.name,
      severity: rule.severity,
      message: formatMessage(rule.message, value, rule.threshold),
      ts,
      value,
      threshold: rule.threshold,
      acknowledged: false,
    }
  }

  emit(alert: AlertEvent): void {
    for (const channel of this.config.channels) {
      if (channel.enabled) {
        this.channels.send(alert, channel)
      }
    }
  }

  emitBatch(alerts: AlertEvent[]): void {
    for (const alert of alerts) {
      this.emit(alert)
    }
  }

  acknowledge(alertId: string): void {
    const alert = this.activeAlerts.get(alertId)
    if (alert) {
      alert.acknowledged = true
      this.activeAlerts.delete(alertId)
    }
  }

  acknowledgeAll(): void {
    for (const alert of this.activeAlerts.values()) {
      alert.acknowledged = true
    }
    this.activeAlerts.clear()
  }

  getActiveAlerts(): AlertEvent[] {
    return Array.from(this.activeAlerts.values())
  }

  getHistory(limit = 100): AlertEvent[] {
    return this.alertHistory.slice(-limit)
  }

  hasActiveCritical(): boolean {
    for (const alert of this.activeAlerts.values()) {
      if (alert.severity === "critical") return true
    }
    return false
  }

  getActiveCount(): number {
    return this.activeAlerts.size
  }

  clearCooldowns(): void {
    this.lastTriggerTime.clear()
  }

  addCustomRule(rule: AlertRule): void {
    this.config.rules.push(rule)
  }

  removeRule(name: string): void {
    this.config.rules = this.config.rules.filter((r) => r.name !== name)
  }

  enableChannel(type: AlertChannel["type"], endpoint?: string): void {
    const existing = this.config.channels.find((c) => c.type === type)
    if (existing) {
      existing.enabled = true
      if (endpoint) existing.endpoint = endpoint
    } else {
      this.config.channels.push({ type, enabled: true, endpoint })
    }
  }

  disableChannel(type: AlertChannel["type"]): void {
    const existing = this.config.channels.find((c) => c.type === type)
    if (existing) {
      existing.enabled = false
    }
  }
}
