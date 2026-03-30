import type { StrategyType, Opportunity, MarketEvent } from "../contracts/types"
import type { AllocationDecision } from "../capital/allocator"
import type { ManagedPosition, PortfolioState } from "../position/manager"

export type LogEventType =
  | "signal"
  | "signal_rejected"
  | "order_submitted"
  | "order_filled"
  | "order_partial"
  | "order_rejected"
  | "hedge_created"
  | "hedge_closed"
  | "position_opened"
  | "position_closed"
  | "risk_event"
  | "weight_adjustment"
  | "capital_rebalance"
  | "hourly_snapshot"
  | "error"

export type SignalLog = {
  type: "signal" | "signal_rejected"
  ts: number
  strategy: StrategyType
  marketId: string
  evBps: number
  confidence: number
  rejected: boolean
  rejectReason?: string
  signalDetails?: {
    features: Record<string, number>
    bookState?: {
      yesBid: number
      yesAsk: number
      noBid: number
      noAsk: number
    }
  }
}

export type OrderLog = {
  type: "order_submitted" | "order_filled" | "order_partial" | "order_rejected"
  ts: number
  orderId: string
  strategy: StrategyType
  marketId: string
  side: "YES" | "NO"
  action: "BUY" | "SELL"
  requestedSize: number
  requestedPrice: number
  filledSize: number
  avgPrice: number
  slippageBps: number
  executionTimeMs: number
}

export type PositionLog = {
  type: "position_opened" | "position_closed"
  ts: number
  positionId: string
  strategy: StrategyType
  marketId: string
  side: "YES" | "NO"
  size: number
  entryPrice: number
  exitPrice?: number
  pnl?: number
  hedgeStatus: "hedged" | "partial" | "unhedged"
  pairedPositionId?: string
}

export type HedgeLog = {
  type: "hedge_created" | "hedge_closed"
  ts: number
  yesPositionId: string
  noPositionId: string
  strategy: StrategyType
  marketId: string
  hedgedSize: number
  lockedProfit: number
  efficiency: number
}

export type RiskEventLog = {
  type: "risk_event"
  ts: number
  eventType:
    | "drawdown_warning"
    | "drawdown_breach"
    | "exposure_limit"
    | "kill_switch"
    | "consecutive_fail"
  strategy?: StrategyType
  marketId?: string
  currentValue: number
  threshold: number
  message: string
  action: "warning" | "block" | "pause" | "liquidate"
}

export type WeightAdjustmentLog = {
  type: "weight_adjustment"
  ts: number
  adjustments: Array<{
    strategy: StrategyType
    oldWeight: number
    newWeight: number
    reason: string
  }>
  trigger: "hourly" | "drawdown" | "manual"
}

export type CapitalRebalanceLog = {
  type: "capital_rebalance"
  ts: number
  trigger: string
  fromStrategy?: StrategyType
  toStrategy?: StrategyType
  amount: number
  reason: string
  beforeState: Record<StrategyType, number>
  afterState: Record<StrategyType, number>
}

export type HourlySnapshotLog = {
  type: "hourly_snapshot"
  ts: number
  equity: number
  cashBalance: number
  totalExposure: number
  hedgedValue: number
  unrealizedPnl: number
  realizedPnl: number
  strategyStats: Record<
    StrategyType,
    {
      exposure: number
      pnl: number
      opportunities: number
      executed: number
      winRate: number
    }
  >
  topPositions: Array<{
    positionId: string
    marketId: string
    strategy: StrategyType
    size: number
    pnl: number
  }>
}

export type ErrorLog = {
  type: "error"
  ts: number
  module: string
  message: string
  stack?: string
  context?: Record<string, unknown>
}

export type LogEntry =
  | SignalLog
  | OrderLog
  | PositionLog
  | HedgeLog
  | RiskEventLog
  | WeightAdjustmentLog
  | CapitalRebalanceLog
  | HourlySnapshotLog
  | ErrorLog

export class DetailedLogger {
  private logs: LogEntry[] = []
  private maxLogs: number
  private hourlySnapshotInterval: number = 60 * 60 * 1000
  private lastSnapshotTs: number = 0

  constructor(maxLogs: number = 100000) {
    this.maxLogs = maxLogs
  }

  logSignal(
    strategy: StrategyType,
    marketId: string,
    evBps: number,
    confidence: number,
    rejected: boolean,
    rejectReason?: string,
    features?: Record<string, number>
  ): void {
    const entry: SignalLog = {
      type: rejected ? "signal_rejected" : "signal",
      ts: Date.now(),
      strategy,
      marketId,
      evBps,
      confidence,
      rejected,
      rejectReason,
      signalDetails: features ? { features } : undefined,
    }
    this.addLog(entry)
  }

  logOrder(
    type: OrderLog["type"],
    orderId: string,
    strategy: StrategyType,
    marketId: string,
    side: "YES" | "NO",
    action: "BUY" | "SELL",
    requestedSize: number,
    requestedPrice: number,
    filledSize: number,
    avgPrice: number,
    slippageBps: number,
    executionTimeMs: number
  ): void {
    const entry: OrderLog = {
      type,
      ts: Date.now(),
      orderId,
      strategy,
      marketId,
      side,
      action,
      requestedSize,
      requestedPrice,
      filledSize,
      avgPrice,
      slippageBps,
      executionTimeMs,
    }
    this.addLog(entry)
  }

  logPositionOpened(
    positionId: string,
    strategy: StrategyType,
    marketId: string,
    side: "YES" | "NO",
    size: number,
    entryPrice: number,
    hedgeStatus: "hedged" | "partial" | "unhedged"
  ): void {
    const entry: PositionLog = {
      type: "position_opened",
      ts: Date.now(),
      positionId,
      strategy,
      marketId,
      side,
      size,
      entryPrice,
      hedgeStatus,
    }
    this.addLog(entry)
  }

  logPositionClosed(
    positionId: string,
    strategy: StrategyType,
    marketId: string,
    side: "YES" | "NO",
    size: number,
    entryPrice: number,
    exitPrice: number,
    pnl: number,
    hedgeStatus: "hedged" | "partial" | "unhedged"
  ): void {
    const entry: PositionLog = {
      type: "position_closed",
      ts: Date.now(),
      positionId,
      strategy,
      marketId,
      side,
      size,
      entryPrice,
      exitPrice,
      pnl,
      hedgeStatus,
    }
    this.addLog(entry)
  }

  logHedgeCreated(
    yesPositionId: string,
    noPositionId: string,
    strategy: StrategyType,
    marketId: string,
    hedgedSize: number,
    lockedProfit: number,
    efficiency: number
  ): void {
    const entry: HedgeLog = {
      type: "hedge_created",
      ts: Date.now(),
      yesPositionId,
      noPositionId,
      strategy,
      marketId,
      hedgedSize,
      lockedProfit,
      efficiency,
    }
    this.addLog(entry)
  }

  logRiskEvent(
    eventType: RiskEventLog["eventType"],
    currentValue: number,
    threshold: number,
    message: string,
    action: RiskEventLog["action"],
    strategy?: StrategyType,
    marketId?: string
  ): void {
    const entry: RiskEventLog = {
      type: "risk_event",
      ts: Date.now(),
      eventType,
      strategy,
      marketId,
      currentValue,
      threshold,
      message,
      action,
    }
    this.addLog(entry)
  }

  logWeightAdjustment(
    adjustments: Array<{
      strategy: StrategyType
      oldWeight: number
      newWeight: number
      reason: string
    }>,
    trigger: "hourly" | "drawdown" | "manual"
  ): void {
    const entry: WeightAdjustmentLog = {
      type: "weight_adjustment",
      ts: Date.now(),
      adjustments,
      trigger,
    }
    this.addLog(entry)
  }

  logCapitalRebalance(
    trigger: string,
    amount: number,
    reason: string,
    beforeState: Record<StrategyType, number>,
    afterState: Record<StrategyType, number>,
    fromStrategy?: StrategyType,
    toStrategy?: StrategyType
  ): void {
    const entry: CapitalRebalanceLog = {
      type: "capital_rebalance",
      ts: Date.now(),
      trigger,
      fromStrategy,
      toStrategy,
      amount,
      reason,
      beforeState,
      afterState,
    }
    this.addLog(entry)
  }

  logHourlySnapshot(
    portfolioState: PortfolioState,
    strategyStats: Record<
      StrategyType,
      {
        exposure: number
        pnl: number
        opportunities: number
        executed: number
        winRate: number
      }
    >,
    positions: ManagedPosition[]
  ): void {
    // Get top 10 positions by size
    const topPositions = positions
      .sort((a, b) => b.size * b.currentPrice - a.size * a.currentPrice)
      .slice(0, 10)
      .map((p) => ({
        positionId: p.id,
        marketId: p.marketId,
        strategy: p.strategy,
        size: p.size,
        pnl: p.unrealizedPnl,
      }))

    const entry: HourlySnapshotLog = {
      type: "hourly_snapshot",
      ts: Date.now(),
      equity: portfolioState.totalEquity,
      cashBalance: portfolioState.cashBalance,
      totalExposure: portfolioState.combinedExposure,
      hedgedValue: portfolioState.hedgedValue,
      unrealizedPnl: portfolioState.totalUnrealizedPnl,
      realizedPnl: portfolioState.totalRealizedPnl,
      strategyStats,
      topPositions,
    }
    this.addLog(entry)
    this.lastSnapshotTs = Date.now()
  }

  logError(
    module: string,
    message: string,
    stack?: string,
    context?: Record<string, unknown>
  ): void {
    const entry: ErrorLog = {
      type: "error",
      ts: Date.now(),
      module,
      message,
      stack,
      context,
    }
    this.addLog(entry)
  }

  private addLog(entry: LogEntry): void {
    this.logs.push(entry)
    if (this.logs.length > this.maxLogs) {
      this.logs.shift()
    }
  }

  getLogs(type?: LogEventType): LogEntry[] {
    if (!type) return [...this.logs]
    return this.logs.filter((l) => l.type === type)
  }

  getLogsByStrategy(strategy: StrategyType): LogEntry[] {
    return this.logs.filter((l) => "strategy" in l && l.strategy === strategy)
  }

  getLogsByTimeRange(start: number, end: number): LogEntry[] {
    return this.logs.filter((l) => l.ts >= start && l.ts <= end)
  }

  getRecentLogs(count: number = 100): LogEntry[] {
    return this.logs.slice(-count)
  }

  getSignalStats(): {
    total: number
    rejected: number
    byStrategy: Record<
      StrategyType,
      { total: number; rejected: number; avgEv: number }
    >
  } {
    const signals = this.logs.filter(
      (l) => l.type === "signal" || l.type === "signal_rejected"
    ) as SignalLog[]
    const rejected = signals.filter((s) => s.rejected).length

    const byStrategy: Record<
      StrategyType,
      { total: number; rejected: number; avgEv: number }
    > = {
      static_arb: { total: 0, rejected: 0, avgEv: 0 },
      stat_arb: { total: 0, rejected: 0, avgEv: 0 },
      microstructure: { total: 0, rejected: 0, avgEv: 0 },
      term_structure: { total: 0, rejected: 0, avgEv: 0 },
    }

    for (const signal of signals) {
      const stats = byStrategy[signal.strategy]
      stats.total += 1
      if (signal.rejected) stats.rejected += 1
      stats.avgEv =
        (stats.avgEv * (stats.total - 1) + signal.evBps) / stats.total
    }

    return { total: signals.length, rejected, byStrategy }
  }

  getOrderStats(): {
    total: number
    filled: number
    partial: number
    rejected: number
    avgSlippage: number
    avgExecutionTime: number
  } {
    const orders = this.logs.filter(
      (l) =>
        l.type === "order_submitted" ||
        l.type === "order_filled" ||
        l.type === "order_partial" ||
        l.type === "order_rejected"
    ) as OrderLog[]

    const filled = orders.filter((o) => o.type === "order_filled").length
    const partial = orders.filter((o) => o.type === "order_partial").length
    const rejected = orders.filter((o) => o.type === "order_rejected").length

    const avgSlippage =
      orders.length > 0
        ? orders.reduce((sum, o) => sum + o.slippageBps, 0) / orders.length
        : 0

    const avgExecutionTime =
      orders.length > 0
        ? orders.reduce((sum, o) => sum + o.executionTimeMs, 0) / orders.length
        : 0

    return {
      total: orders.length,
      filled,
      partial,
      rejected,
      avgSlippage,
      avgExecutionTime,
    }
  }

  exportToJson(): string {
    return JSON.stringify(this.logs, null, 2)
  }

  clear(): void {
    this.logs = []
  }

  getLogCount(): number {
    return this.logs.length
  }
}
