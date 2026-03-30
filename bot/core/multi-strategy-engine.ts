import type {
  Opportunity,
  FeatureSnapshot,
  StrategyType,
  MarketEvent,
} from "../contracts/types"
import type { BookState } from "../ingest/orderbook"
import { CapitalAllocator, createDefaultAllocator } from "../capital/allocator"
import { PositionManager } from "../position/manager"
import { StrategyCoordinator } from "./coordinator"
import { DetailedLogger } from "../metrics/detailed-logger"
import { FeatureEngine } from "../features/engine"
import { kellySize } from "../execution/kelly"
import { stoikovPriceAdjust } from "../execution/stoikov"

export type MultiStrategyConfig = {
  enabledStrategies: StrategyType[]
  initialEquity: number
  strategyWeights: Partial<Record<StrategyType, number>>
  reservePct: number
  maxSingleStrategyPct: number
  maxMarketExposurePct: number
}

export const DEFAULT_MULTI_STRATEGY_CONFIG: MultiStrategyConfig = {
  enabledStrategies: [
    "static_arb",
    "stat_arb",
    "microstructure",
    "term_structure",
  ],
  initialEquity: 10_000,
  strategyWeights: {
    static_arb: 0.4,
    stat_arb: 0.25,
    microstructure: 0.2,
    term_structure: 0.15,
  },
  reservePct: 0.1,
  maxSingleStrategyPct: 0.4,
  maxMarketExposurePct: 0.15,
}

export type StrategyPnL = {
  strategy: StrategyType
  opportunities: number
  executed: number
  wins: number
  losses: number
  totalPnl: number
  totalPnlBps: number
  avgEvBps: number
  winRate: number
  avgHoldTimeMs: number
  maxDrawdown: number
  sharpeRatio: number
  equityCurve: number[]
}

export type MultiStrategyResult = {
  totalPnl: number
  totalPnlBps: number
  byStrategy: Map<StrategyType, StrategyPnL>
  combinedEquityCurve: number[]
  correlations: Map<string, number>
  bestStrategy: StrategyType
  worstStrategy: StrategyType
  metricsSnapshot: {
    ts: number
    equity: number
    totalExposure: number
    hedgedValue: number
    unhedgedExposure: number
    totalPnl: number
  }
}

export type ProcessingResult = {
  opportunity: Opportunity | null
  executed: boolean
  pnl: number
  warnings: string[]
}

export class MultiStrategyEngine {
  private config: MultiStrategyConfig
  private capitalAllocator: CapitalAllocator
  private positionManager: PositionManager
  private coordinator: StrategyCoordinator
  private logger: DetailedLogger
  private featureEngine: FeatureEngine

  private equity: number
  private cashBalance: number
  private equityCurve: number[]
  private strategyPnLs: Map<StrategyType, StrategyPnL>

  private running: boolean = false
  private lastHourlyAdjustment: number = 0
  private lastHourlySnapshot: number = 0

  constructor(config: Partial<MultiStrategyConfig> = {}) {
    this.config = { ...DEFAULT_MULTI_STRATEGY_CONFIG, ...config }

    this.capitalAllocator = createDefaultAllocator(this.config.initialEquity)
    this.positionManager = new PositionManager()
    this.coordinator = new StrategyCoordinator(
      this.capitalAllocator,
      this.positionManager
    )
    this.logger = new DetailedLogger()
    this.featureEngine = new FeatureEngine()

    this.equity = this.config.initialEquity
    this.cashBalance = this.config.initialEquity
    this.equityCurve = [this.equity]

    this.strategyPnLs = new Map()
    this.initializeStrategyPnLs()
  }

  private initializeStrategyPnLs(): void {
    for (const strategy of this.config.enabledStrategies) {
      this.strategyPnLs.set(strategy, {
        strategy,
        opportunities: 0,
        executed: 0,
        wins: 0,
        losses: 0,
        totalPnl: 0,
        totalPnlBps: 0,
        avgEvBps: 0,
        winRate: 0,
        avgHoldTimeMs: 0,
        maxDrawdown: 0,
        sharpeRatio: 0,
        equityCurve: [0],
      })
    }
  }

  processTick(
    marketId: string,
    ts: number,
    book: BookState,
    events: MarketEvent[]
  ): ProcessingResult {
    const warnings: string[] = []
    let executed = false
    let pnl = 0

    // Check hourly weight adjustment
    if (this.shouldAdjustWeights(ts)) {
      const adjustments = this.coordinator.adjustWeights(ts)
      if (adjustments.length > 0) {
        this.logger.logWeightAdjustment(
          adjustments.map((msg) => ({
            strategy: this.extractStrategyFromMessage(msg),
            oldWeight:
              this.config.strategyWeights[
                this.extractStrategyFromMessage(msg)
              ] ?? 0,
            newWeight: this.getAdjustedWeight(
              this.extractStrategyFromMessage(msg)
            ),
            reason: msg,
          })),
          "hourly"
        )
        warnings.push(`WEIGHT_ADJUSTMENT: ${adjustments.length} changes`)
      }
    }

    // Build features
    const feature = this.featureEngine.build(marketId, ts, book, events)

    // Coordinate strategies
    const coordination = this.coordinator.coordinate(feature, book, ts)

    // Log signals
    for (const rejected of coordination.rejectedOpportunities) {
      this.logger.logSignal(
        rejected.opportunity.strategy,
        rejected.opportunity.marketIds[0] ?? "",
        rejected.opportunity.evBps,
        rejected.opportunity.confidence,
        true,
        rejected.reason
      )
    }

    if (!coordination.selectedOpportunity || !coordination.allocationDecision) {
      return {
        opportunity: coordination.selectedOpportunity,
        executed: false,
        pnl: 0,
        warnings: coordination.warnings,
      }
    }

    const opportunity = coordination.selectedOpportunity
    const allocation = coordination.allocationDecision

    // Log accepted signal
    this.logger.logSignal(
      opportunity.strategy,
      opportunity.marketIds[0] ?? "",
      opportunity.evBps,
      opportunity.confidence,
      false
    )

    // Calculate position size
    const maxSize = allocation.allowedAmount
    const size = kellySize(
      opportunity.evBps,
      opportunity.confidence,
      this.equity,
      maxSize / this.equity
    )

    if (size < 0.01) {
      return {
        opportunity,
        executed: false,
        pnl: 0,
        warnings: [...warnings, "SIZE_TOO_SMALL"],
      }
    }

    // Execute trade (simplified for paper trading)
    const adjPrice = stoikovPriceAdjust(0.5, 0)
    const fillRatio = Math.min(1, 0.7 + opportunity.confidence * 0.3)
    const filledSize = size * fillRatio
    const slippageBps = Math.random() * 20
    const executionPnl =
      filledSize * (opportunity.evBps / 10000) -
      (filledSize * slippageBps) / 10000

    // Update position manager
    const position = this.positionManager.openPosition(
      opportunity.strategy,
      opportunity.marketIds[0] ?? "",
      "YES",
      filledSize / 2,
      adjPrice,
      `order-${ts}`
    )

    const noPosition = this.positionManager.openPosition(
      opportunity.strategy,
      opportunity.marketIds[0] ?? "",
      "NO",
      filledSize / 2,
      1 - adjPrice,
      `order-${ts}-no`
    )

    // Log positions
    this.logger.logPositionOpened(
      position.id,
      opportunity.strategy,
      opportunity.marketIds[0] ?? "",
      "YES",
      filledSize / 2,
      adjPrice,
      position.hedgeStatus
    )

    // Check if hedge was created
    if (position.pairedPositionId) {
      this.logger.logHedgeCreated(
        position.id,
        noPosition.id,
        opportunity.strategy,
        opportunity.marketIds[0] ?? "",
        Math.min(position.size, noPosition.size),
        Math.min(position.size, noPosition.size) *
          (1 - adjPrice - (1 - adjPrice)),
        Math.min(position.size, noPosition.size) /
          Math.max(position.size, noPosition.size)
      )
    }

    // Update strategy PnL
    const strategyPnL = this.strategyPnLs.get(opportunity.strategy)
    if (strategyPnL) {
      strategyPnL.opportunities += 1
      strategyPnL.executed += 1
      strategyPnL.totalPnl += executionPnl
      if (executionPnl > 0) {
        strategyPnL.wins += 1
      } else {
        strategyPnL.losses += 1
      }
      strategyPnL.winRate =
        strategyPnL.executed > 0 ? strategyPnL.wins / strategyPnL.executed : 0
      strategyPnL.totalPnlBps =
        (strategyPnL.totalPnl / this.config.initialEquity) * 10000
      strategyPnL.avgEvBps =
        strategyPnL.executed > 0
          ? (strategyPnL.avgEvBps * (strategyPnL.executed - 1) +
              opportunity.evBps) /
            strategyPnL.executed
          : opportunity.evBps
      strategyPnL.equityCurve.push(strategyPnL.totalPnl)
    }

    // Update totals
    this.equity += executionPnl
    this.cashBalance -= filledSize * adjPrice
    this.equityCurve.push(this.equity)

    // Update coordinator
    this.coordinator.updateAfterExecution(
      opportunity.strategy,
      executionPnl > 0,
      executionPnl,
      this.positionManager.getStrategyExposure(opportunity.strategy)
    )

    executed = true
    pnl = executionPnl

    return {
      opportunity,
      executed,
      pnl,
      warnings: [...warnings, ...coordination.warnings],
    }
  }

  private shouldAdjustWeights(ts: number): boolean {
    return ts - this.lastHourlyAdjustment >= 60 * 60 * 1000
  }

  private extractStrategyFromMessage(msg: string): StrategyType {
    for (const strategy of this.config.enabledStrategies) {
      if (msg.includes(strategy)) return strategy
    }
    return "static_arb"
  }

  private getAdjustedWeight(strategy: StrategyType): number {
    const allocation = this.capitalAllocator.getStrategyAllocation(strategy)
    return (
      allocation?.adjustedWeight ?? this.config.strategyWeights[strategy] ?? 0
    )
  }

  getResults(): MultiStrategyResult {
    const byStrategy = new Map<StrategyType, StrategyPnL>()

    for (const [strategy, pnl] of this.strategyPnLs) {
      const equityCurve = pnl.equityCurve
      let maxDd = 0
      let peak = 0

      for (const eq of equityCurve) {
        if (eq > peak) peak = eq
        const dd = peak - eq
        if (dd > maxDd) maxDd = dd
      }

      const sharpe = this.calculateSharpe(equityCurve)

      byStrategy.set(strategy, {
        ...pnl,
        maxDrawdown: maxDd,
        sharpeRatio: sharpe,
      })
    }

    let bestStrategy: StrategyType = "static_arb"
    let worstStrategy: StrategyType = "static_arb"
    let bestPnl = -Infinity
    let worstPnl = Infinity

    for (const [strategy, pnl] of byStrategy) {
      if (pnl.totalPnl > bestPnl) {
        bestPnl = pnl.totalPnl
        bestStrategy = strategy
      }
      if (pnl.totalPnl < worstPnl) {
        worstPnl = pnl.totalPnl
        worstStrategy = strategy
      }
    }

    const correlations = this.calculateCorrelations(byStrategy)

    const portfolioState = this.positionManager.getPortfolioState(
      this.equity,
      this.cashBalance
    )

    return {
      totalPnl: this.equity - this.config.initialEquity,
      totalPnlBps:
        ((this.equity - this.config.initialEquity) /
          this.config.initialEquity) *
        10000,
      byStrategy,
      combinedEquityCurve: this.equityCurve,
      correlations,
      bestStrategy,
      worstStrategy,
      metricsSnapshot: {
        ts: Date.now(),
        equity: this.equity,
        totalExposure: portfolioState.combinedExposure,
        hedgedValue: portfolioState.hedgedValue,
        unhedgedExposure: portfolioState.unhedgedExposure,
        totalPnl: this.equity - this.config.initialEquity,
      },
    }
  }

  private calculateSharpe(equityCurve: number[]): number {
    if (equityCurve.length < 2) return 0

    const returns: number[] = []
    for (let i = 1; i < equityCurve.length; i++) {
      if (equityCurve[i - 1] !== 0) {
        returns.push(
          (equityCurve[i] - equityCurve[i - 1]) /
            Math.abs(equityCurve[i - 1] || 1)
        )
      }
    }

    if (returns.length < 2) return 0

    const mean = returns.reduce((a, b) => a + b, 0) / returns.length
    const variance =
      returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length
    const std = Math.sqrt(variance)

    return std > 0 ? (mean / std) * Math.sqrt(252) : 0
  }

  private calculateCorrelations(
    byStrategy: Map<StrategyType, StrategyPnL>
  ): Map<string, number> {
    const correlations = new Map<string, number>()
    const strategies = Array.from(byStrategy.keys())

    for (let i = 0; i < strategies.length; i++) {
      for (let j = i + 1; j < strategies.length; j++) {
        const pnlA = byStrategy.get(strategies[i])
        const pnlB = byStrategy.get(strategies[j])

        if (
          pnlA &&
          pnlB &&
          pnlA.equityCurve.length > 1 &&
          pnlB.equityCurve.length > 1
        ) {
          const corr = this.computeCorrelation(
            pnlA.equityCurve,
            pnlB.equityCurve
          )
          correlations.set(`${strategies[i]}_${strategies[j]}`, corr)
        }
      }
    }

    return correlations
  }

  private computeCorrelation(seriesA: number[], seriesB: number[]): number {
    const minLen = Math.min(seriesA.length, seriesB.length)
    if (minLen < 2) return 0

    const a = seriesA.slice(0, minLen)
    const b = seriesB.slice(0, minLen)

    const meanA = a.reduce((x, y) => x + y, 0) / minLen
    const meanB = b.reduce((x, y) => x + y, 0) / minLen

    let num = 0
    let denA = 0
    let denB = 0

    for (let i = 0; i < minLen; i++) {
      const da = a[i] - meanA
      const db = b[i] - meanB
      num += da * db
      denA += da * da
      denB += db * db
    }

    const den = Math.sqrt(denA * denB)
    return den > 0 ? num / den : 0
  }

  getEquity(): number {
    return this.equity
  }

  getLogger(): DetailedLogger {
    return this.logger
  }

  getPositionManager(): PositionManager {
    return this.positionManager
  }

  getCapitalAllocator(): CapitalAllocator {
    return this.capitalAllocator
  }

  reset(): void {
    this.equity = this.config.initialEquity
    this.cashBalance = this.config.initialEquity
    this.equityCurve = [this.equity]
    this.capitalAllocator.reset()
    this.positionManager.reset()
    this.coordinator.reset()
    this.logger.clear()
    this.initializeStrategyPnLs()
    this.lastHourlyAdjustment = 0
    this.lastHourlySnapshot = 0
  }
}

export function runMultiStrategyBacktest(
  ticks: Array<{
    ts: number
    marketId: string
    yesBid: number
    yesAsk: number
    noBid: number
    noAsk: number
    volume: number
  }>,
  config: Partial<MultiStrategyConfig> = {}
): MultiStrategyResult {
  const engine = new MultiStrategyEngine(config)
  const bookStates = new Map<string, BookState>()

  for (const tick of ticks) {
    const book: BookState = {
      yesBid: tick.yesBid,
      yesAsk: tick.yesAsk,
      noBid: tick.noBid,
      noAsk: tick.noAsk,
    }
    bookStates.set(tick.marketId, book)

    const events: MarketEvent[] = [
      {
        eventId: `${tick.marketId}-${tick.ts}`,
        tsExchange: tick.ts,
        tsLocal: tick.ts,
        marketId: tick.marketId,
        type: "book_update",
        payload: {
          yesBid: tick.yesBid,
          yesAsk: tick.yesAsk,
          noBid: tick.noBid,
          noAsk: tick.noAsk,
          volume: tick.volume,
        },
      },
    ]

    engine.processTick(tick.marketId, tick.ts, book, events)
  }

  return engine.getResults()
}

export function formatStrategyComparison(result: MultiStrategyResult): string {
  const lines: string[] = []

  lines.push(
    "╔══════════════════════════════════════════════════════════════════╗"
  )
  lines.push(
    "║                    MULTI-STRATEGY COMPARISON                      ║"
  )
  lines.push(
    "╠══════════════════════════════════════════════════════════════════╣"
  )
  lines.push(
    `║ Total PnL: $${result.totalPnl.toFixed(2)} (${result.totalPnlBps.toFixed(1)} bps)`
  )
  lines.push(`║ Best Strategy: ${result.bestStrategy}`)
  lines.push(`║ Worst Strategy: ${result.worstStrategy}`)
  lines.push(
    "╠══════════════════════════════════════════════════════════════════╣"
  )
  lines.push(
    "║ STRATEGY         │ OPPS  │ EXEC  │ WIN%   │ PnL      │ SHARPE  ║"
  )
  lines.push(
    "╠══════════════════════════════════════════════════════════════════╣"
  )

  for (const [strategy, pnl] of result.byStrategy) {
    const name = strategy.padEnd(17)
    const opps = String(pnl.opportunities).padStart(5)
    const exec = String(pnl.executed).padStart(5)
    const win = (pnl.winRate * 100).toFixed(1).padStart(5) + "%"
    const pnlStr =
      (pnl.totalPnl >= 0 ? "+" : "") + `$${pnl.totalPnl.toFixed(2)}`.padStart(8)
    const sharpe = pnl.sharpeRatio.toFixed(2).padStart(6)

    lines.push(
      `║ ${name}│ ${opps} │ ${exec} │ ${win} │ ${pnlStr} │ ${sharpe} ║`
    )
  }

  lines.push(
    "╠══════════════════════════════════════════════════════════════════╣"
  )
  lines.push("║ CORRELATIONS:")

  for (const [pair, corr] of result.correlations) {
    lines.push(`║   ${pair}: ${corr.toFixed(3)}`)
  }

  lines.push(
    "╚══════════════════════════════════════════════════════════════════╝"
  )

  return lines.join("\n")
}
