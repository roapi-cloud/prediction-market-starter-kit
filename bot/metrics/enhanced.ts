import type {
  MetricsConfig,
  MetricsSnapshot,
  StrategyMetrics,
  EngineState,
  StrategyEvent,
} from "../contracts/types"
import { MetricsPersistence } from "./persistence"
import { MetricsPusher } from "./pusher"

export class MetricsCollectorEnhanced {
  private config: MetricsConfig
  private persistence: MetricsPersistence | null = null
  private pusher: MetricsPusher | null = null
  private snapshots: MetricsSnapshot[] = []
  private lastCollectTime = 0
  private eventCount = 0
  private initialEquity = 10_000

  constructor(config: MetricsConfig) {
    this.config = config
    if (config.persistenceEnabled) {
      this.persistence = new MetricsPersistence(config.persistencePath)
    }
    if (config.pushEnabled && config.pushEndpoint) {
      this.pusher = new MetricsPusher(config.pushEndpoint)
    }
  }

  setInitialEquity(equity: number): void {
    this.initialEquity = equity
  }

  collect(state: EngineState): MetricsSnapshot {
    const ts = Date.now()
    this.lastCollectTime = ts

    const pnl = state.totalPnl
    const pnlPct = (pnl / this.initialEquity) * 100
    const drawdown = Math.max(0, state.drawdownPct)
    const drawdownPct = state.drawdownPct

    const winRate = this.computeWinRate(state.orders)
    const legCompletionRate = this.computeLegCompletionRate(
      state.strategyEvents
    )
    const avgSlippageBps = this.computeAvgSlippage(
      state.totalSlippageCost,
      state.orders
    )
    const avgDelayMs = this.computeAvgDelay(state.orders)
    const orderFillRate = state.fillCount / Math.max(1, state.orderCount)
    const hedgeSuccessRate = this.computeHedgeSuccessRate(state.strategyEvents)

    const latencyMs = ts - this.lastCollectTime
    const throughput =
      this.eventCount / Math.max(1, this.config.collectionIntervalMs / 1000)

    const activeStrategies = this.countActiveStrategies(state.strategyEvents)
    const strategyMetrics = this.computeStrategyMetrics(state.strategyEvents)

    const snapshot: MetricsSnapshot = {
      ts,
      pnl,
      pnlPct,
      drawdown,
      drawdownPct,
      winRate,
      legCompletionRate,
      avgSlippageBps,
      avgDelayMs,
      orderFillRate,
      hedgeSuccessRate,
      dataLatencyMs: latencyMs,
      eventThroughput: throughput,
      activeStrategies,
      riskState: state.riskState,
      strategyMetrics,
    }

    this.snapshots.push(snapshot)
    this.eventCount = state.strategyEvents.length

    if (this.persistence) {
      this.persistence.persist(snapshot)
    }
    if (this.pusher) {
      this.pusher.push(snapshot)
    }

    return snapshot
  }

  collectStrategyMetrics(
    strategy: string,
    events: StrategyEvent[]
  ): StrategyMetrics {
    const strategyEvents = events.filter((e) => e.strategy === strategy)
    const opportunities = strategyEvents.filter(
      (e) => e.type === "opportunity"
    ).length
    const executed = strategyEvents.filter((e) => e.type === "executed").length
    const pnl = strategyEvents.reduce((sum, e) => sum + (e.pnl ?? 0), 0)
    const avgEvBps =
      strategyEvents.length > 0
        ? strategyEvents.reduce((sum, e) => sum + e.evBps, 0) /
          strategyEvents.length
        : 0
    const wins = strategyEvents.filter((e) => e.success === true).length
    const winRate = executed > 0 ? wins / executed : 0

    return { opportunities, executed, pnl, avgEvBps, winRate }
  }

  private computeWinRate(orders: EngineState["orders"]): number {
    const filled = orders.filter(
      (o) => o.status === "filled" || o.status === "FILLED"
    )
    const wins = filled.filter((o) => o.pnl > 0).length
    return filled.length > 0 ? wins / filled.length : 0
  }

  private computeLegCompletionRate(events: StrategyEvent[]): number {
    const executions = events.filter((e) => e.type === "executed")
    if (executions.length === 0) return 1
    const completed = executions.filter((e) => e.success === true).length
    return completed / executions.length
  }

  private computeAvgSlippage(
    totalCost: number,
    orders: EngineState["orders"]
  ): number {
    if (orders.length === 0) return 0
    const avgCost = totalCost / orders.length
    return avgCost * 10000
  }

  private computeAvgDelay(orders: EngineState["orders"]): number {
    if (orders.length < 2) return 0
    const timestamps = orders.map((o) => o.ts).sort()
    const diffs = timestamps.slice(1).map((t, i) => t - timestamps[i])
    return diffs.reduce((sum, d) => sum + d, 0) / diffs.length
  }

  private computeHedgeSuccessRate(events: StrategyEvent[]): number {
    const hedgeEvents = events.filter(
      (e) => e.type === "executed" && e.strategy.includes("arb")
    )
    if (hedgeEvents.length === 0) return 1
    const success = hedgeEvents.filter((e) => e.success === true).length
    return success / hedgeEvents.length
  }

  private countActiveStrategies(events: StrategyEvent[]): number {
    const strategies = new Set(events.map((e) => e.strategy))
    return strategies.size
  }

  private computeStrategyMetrics(
    events: StrategyEvent[]
  ): Map<string, StrategyMetrics> {
    const result = new Map<string, StrategyMetrics>()
    const byStrategy = new Map<string, StrategyEvent[]>()

    for (const event of events) {
      const existing = byStrategy.get(event.strategy) ?? []
      existing.push(event)
      byStrategy.set(event.strategy, existing)
    }

    for (const [strategy, stratEvents] of byStrategy) {
      result.set(strategy, this.collectStrategyMetrics(strategy, stratEvents))
    }

    return result
  }

  getSnapshots(): MetricsSnapshot[] {
    return this.snapshots
  }

  getLatest(): MetricsSnapshot | null {
    return this.snapshots.length > 0
      ? this.snapshots[this.snapshots.length - 1]
      : null
  }

  loadHistorical(start: number, end: number): MetricsSnapshot[] {
    if (!this.persistence) return []
    return this.persistence.loadRange(start, end)
  }

  aggregateByMinute(
    snapshots: MetricsSnapshot[]
  ): Map<number, MetricsSnapshot> {
    const result = new Map<number, MetricsSnapshot>()
    const byMinute = new Map<number, MetricsSnapshot[]>()

    for (const snap of snapshots) {
      const minute = Math.floor(snap.ts / 60000)
      const existing = byMinute.get(minute) ?? []
      existing.push(snap)
      byMinute.set(minute, existing)
    }

    for (const [minute, snaps] of byMinute) {
      result.set(minute, this.aggregateSnapshots(snaps))
    }

    return result
  }

  aggregateByHour(snapshots: MetricsSnapshot[]): Map<number, MetricsSnapshot> {
    const result = new Map<number, MetricsSnapshot>()
    const byHour = new Map<number, MetricsSnapshot[]>()

    for (const snap of snapshots) {
      const hour = Math.floor(snap.ts / 3600000)
      const existing = byHour.get(hour) ?? []
      existing.push(snap)
      byHour.set(hour, existing)
    }

    for (const [hour, snaps] of byHour) {
      result.set(hour, this.aggregateSnapshots(snaps))
    }

    return result
  }

  private aggregateSnapshots(snapshots: MetricsSnapshot[]): MetricsSnapshot {
    if (snapshots.length === 0) {
      return this.createEmptySnapshot()
    }
    if (snapshots.length === 1) {
      return snapshots[0]
    }

    const latest = snapshots[snapshots.length - 1]
    const count = snapshots.length

    const avgPnl = snapshots.reduce((sum, s) => sum + s.pnl, 0) / count
    const avgPnlPct = snapshots.reduce((sum, s) => sum + s.pnlPct, 0) / count
    const maxDrawdown = Math.max(...snapshots.map((s) => s.drawdown))
    const maxDrawdownPct = Math.max(...snapshots.map((s) => s.drawdownPct))
    const avgWinRate = snapshots.reduce((sum, s) => sum + s.winRate, 0) / count
    const avgLegCompletionRate =
      snapshots.reduce((sum, s) => sum + s.legCompletionRate, 0) / count
    const avgSlippageBps =
      snapshots.reduce((sum, s) => sum + s.avgSlippageBps, 0) / count
    const avgDelayMs =
      snapshots.reduce((sum, s) => sum + s.avgDelayMs, 0) / count
    const avgFillRate =
      snapshots.reduce((sum, s) => sum + s.orderFillRate, 0) / count
    const avgHedgeRate =
      snapshots.reduce((sum, s) => sum + s.hedgeSuccessRate, 0) / count
    const avgLatency =
      snapshots.reduce((sum, s) => sum + s.dataLatencyMs, 0) / count
    const avgThroughput =
      snapshots.reduce((sum, s) => sum + s.eventThroughput, 0) / count
    const avgActive = Math.round(
      snapshots.reduce((sum, s) => sum + s.activeStrategies, 0) / count
    )

    return {
      ts: latest.ts,
      pnl: avgPnl,
      pnlPct: avgPnlPct,
      drawdown: maxDrawdown,
      drawdownPct: maxDrawdownPct,
      winRate: avgWinRate,
      legCompletionRate: avgLegCompletionRate,
      avgSlippageBps: avgSlippageBps,
      avgDelayMs: avgDelayMs,
      orderFillRate: avgFillRate,
      hedgeSuccessRate: avgHedgeRate,
      dataLatencyMs: avgLatency,
      eventThroughput: avgThroughput,
      activeStrategies: avgActive,
      riskState: latest.riskState,
      strategyMetrics: this.aggregateStrategyMetrics(snapshots),
    }
  }

  private aggregateStrategyMetrics(
    snapshots: MetricsSnapshot[]
  ): Map<string, StrategyMetrics> {
    const result = new Map<string, StrategyMetrics>()
    const byStrategy = new Map<string, StrategyMetrics[]>()

    for (const snap of snapshots) {
      for (const [strategy, metrics] of snap.strategyMetrics) {
        const existing = byStrategy.get(strategy) ?? []
        existing.push(metrics)
        byStrategy.set(strategy, existing)
      }
    }

    for (const [strategy, metrics] of byStrategy) {
      const count = metrics.length
      result.set(strategy, {
        opportunities: metrics.reduce((sum, m) => sum + m.opportunities, 0),
        executed: metrics.reduce((sum, m) => sum + m.executed, 0),
        pnl: metrics.reduce((sum, m) => sum + m.pnl, 0),
        avgEvBps: metrics.reduce((sum, m) => sum + m.avgEvBps, 0) / count,
        winRate: metrics.reduce((sum, m) => sum + m.winRate, 0) / count,
      })
    }

    return result
  }

  private createEmptySnapshot(): MetricsSnapshot {
    return {
      ts: Date.now(),
      pnl: 0,
      pnlPct: 0,
      drawdown: 0,
      drawdownPct: 0,
      winRate: 0,
      legCompletionRate: 1,
      avgSlippageBps: 0,
      avgDelayMs: 0,
      orderFillRate: 0,
      hedgeSuccessRate: 1,
      dataLatencyMs: 0,
      eventThroughput: 0,
      activeStrategies: 0,
      riskState: "normal",
      strategyMetrics: new Map(),
    }
  }

  computeSharpeRatio(snapshots: MetricsSnapshot[]): number {
    if (snapshots.length < 2) return 0
    const returns = snapshots.map((s) => s.pnlPct)
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length
    const variance =
      returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) /
      returns.length
    const stdDev = Math.sqrt(variance)
    return stdDev > 0 ? avgReturn / stdDev : 0
  }

  close(): void {
    if (this.pusher) {
      this.pusher.close()
    }
  }
}
