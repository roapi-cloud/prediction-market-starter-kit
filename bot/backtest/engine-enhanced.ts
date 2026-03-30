import type {
  BacktestConfigEnhanced,
  BacktestResultEnhanced,
  BacktestReport,
  HistoricalData,
  BacktestParams,
  MonteCarloResult,
  ExecutionEvent,
  RiskEventBacktest,
  AttributionResult,
  HistoricalTick,
  Opportunity,
  BacktestEvent,
  PerturbationRanges,
} from "../contracts/types"
import {
  HistoricalLoader,
  createSyntheticData,
  aggregateTicksByInterval,
} from "./historical-loader"
import { QueueSimulator, createDefaultQueueConfig } from "./queue-simulator"
import { DepthSimulator, createDefaultDepthConfig } from "./depth-simulator"
import { DelayInjector, createDefaultDelayConfig } from "./delay-injector"
import { AttributionEngine, attributePnl } from "./attribution"
import {
  generateReport,
  generatePnlCurve,
  generateMcDistribution,
  computeSummaryStatistics,
  computeExecutionStatistics,
  computeRiskStatistics,
} from "./report-generator"
import {
  monteCarloEnhanced,
  computeConfidenceInterval,
} from "../montecarlo/sim"
import {
  generatePerturbationSet,
  perturbParams,
} from "../montecarlo/perturbation"
import {
  computeSensitivityFromMonteCarlo,
  createDefaultBaseParams,
} from "../montecarlo/sensitivity"
import { FeatureEngine } from "../features/engine"
import { generateOpportunity } from "../signal"
import { preTradeCheck } from "../risk/pre_trade"
import { shouldTriggerDrawdownStop } from "../risk/realtime"
import { kellySize } from "../execution/kelly"
import { stoikovPriceAdjust } from "../execution/stoikov"
import { getDefaultBookState, type BookState } from "../ingest/orderbook"
import { tickToMarketEvents } from "../ingest/adapter"

export class BacktestEngineEnhanced {
  private config: BacktestConfigEnhanced
  private queueSimulator: QueueSimulator
  private depthSimulator: DepthSimulator
  private delayInjector: DelayInjector
  private attributionEngine: AttributionEngine
  private featureEngine: FeatureEngine
  private historicalLoader: HistoricalLoader | null

  constructor(config: BacktestConfigEnhanced) {
    this.config = config
    this.queueSimulator = new QueueSimulator(createDefaultQueueConfig())
    this.depthSimulator = new DepthSimulator({
      levels: config.simulateDepth,
      tickSize: 0.01,
      minSpread: 0.02,
      liquidityDecayRate: 0.5,
    })
    this.delayInjector = new DelayInjector(config.delayConfig)
    this.attributionEngine = new AttributionEngine()
    this.featureEngine = new FeatureEngine()
    this.historicalLoader = null
  }

  async loadHistoricalData(path: string): Promise<HistoricalData> {
    this.historicalLoader = new HistoricalLoader(path)
    return this.historicalLoader.loadHistoricalData()
  }

  runBacktest(data: HistoricalData): BacktestResultEnhanced {
    const equity = 10000
    let currentEquity = equity
    let inventory = 0
    let totalPnl = 0

    const pnlEvents: Array<{ ts: number; pnl: number }> = []
    const executionEvents: ExecutionEvent[] = []
    const riskEvents: RiskEventBacktest[] = []
    const backtestEvents: BacktestEvent[] = []

    let opportunities = 0
    let executed = 0
    let wins = 0
    let totalEvBps = 0
    let totalHoldingTimeMs = 0
    let consecutiveFails = 0
    let killSwitchTriggered = 0
    let riskLimitBreaches = 0
    let killSwitchActive = false

    this.queueSimulator.clearQueuePositions()
    this.depthSimulator.clearDepths()
    this.delayInjector.reset()
    this.attributionEngine.clear()

    let book: BookState = getDefaultBookState()
    const sortedTicks = [...data.ticks].sort((a, b) => a.ts - b.ts)

    const aggregated = aggregateTicksByInterval(sortedTicks, 60000)
    const volatility =
      aggregated.length > 0 ? this.estimateVolatility(aggregated) : 0.02

    const snapshotMap = new Map<string, (typeof data.snapshots)[0]>()
    for (const snapshot of data.snapshots) {
      snapshotMap.set(`${snapshot.marketId}-${snapshot.ts}`, snapshot)
    }

    for (const tick of sortedTicks) {
      if (killSwitchActive) continue

      const events = tickToMarketEvents({
        ts: tick.ts,
        marketId: tick.marketId,
        yesBid: tick.yesBid,
        yesAsk: tick.yesAsk,
        noBid: tick.noBid,
        noAsk: tick.noAsk,
        volume: tick.volume,
      })

      for (const evt of events) {
        book = this.applyBookEventEnhanced(book, evt)
      }

      if (this.config.simulateDepth > 0) {
        const midPrice = (tick.yesBid + tick.yesAsk) / 2
        this.depthSimulator.simulateDepth(midPrice, volatility, tick.marketId)
      }

      const feature = this.featureEngine.build(
        tick.marketId,
        tick.ts,
        book,
        events
      )
      const opp = generateOpportunity(feature, book, tick.ts)

      if (!opp) continue

      opportunities += 1
      backtestEvents.push({
        ts: tick.ts,
        type: "opportunity",
        data: { opportunity: opp },
      })

      const decision = preTradeCheck(
        opp,
        Math.abs(inventory),
        this.config.riskConfig.maxMarketExposure
      )

      if (!decision.allow) {
        riskLimitBreaches += 1
        riskEvents.push({
          ts: tick.ts,
          type: "limit_breach",
          reason: decision.reason ?? "unknown",
          impact: (opp.evBps / 10000) * 100,
        })

        backtestEvents.push({
          ts: tick.ts,
          type: "risk",
          data: { decision, opportunity: opp },
          riskControlLoss: (opp.evBps / 10000) * 100,
        })

        continue
      }

      const pnlPct = (totalPnl / Math.max(1, equity)) * 100
      if (shouldTriggerDrawdownStop(pnlPct, pnlPct)) {
        killSwitchActive = true
        killSwitchTriggered += 1
        riskEvents.push({
          ts: tick.ts,
          type: "kill_switch",
          reason: "drawdown_threshold",
          impact: currentEquity * -0.02,
        })
        continue
      }

      const size = kellySize(
        opp.evBps,
        opp.confidence,
        currentEquity,
        this.config.executionConfig.kellyCap
      )
      if (size < 0.01) continue

      const adjPrice = stoikovPriceAdjust(
        0.5,
        inventory,
        this.config.executionConfig.stoikovRiskAversion
      )

      const delayMs = this.config.injectDelay
        ? this.delayInjector.injectDelay()
        : 0

      const fillRate = this.simulateFillRate(opp.confidence, size)
      let filledSize = size * fillRate

      if (this.config.simulateQueue) {
        const snapshot = snapshotMap.get(`${tick.marketId}-${tick.ts}`) ?? {
          ts: tick.ts,
          marketId: tick.marketId,
          bids: [{ price: tick.yesBid, size: 100 }],
          asks: [{ price: tick.yesAsk, size: 100 }],
        }
        const queuePos = this.queueSimulator.simulateQueuePosition(
          {
            opportunityId: opp.id,
            marketId: tick.marketId,
            side: "buy",
            price: adjPrice,
            size: size,
            tif: "IOC",
          },
          snapshot
        )
        const fillResult = this.queueSimulator.simulateFill(queuePos, size)
        filledSize = Math.min(filledSize, fillResult.filledSize)
      }

      const slippageBps = this.simulateSlippage(filledSize, volatility)
      const avgPrice = adjPrice * (1 - slippageBps / 10000)

      const executionPnl =
        filledSize * (opp.evBps / 10000) - (filledSize * slippageBps) / 10000
      const signalPnl = (filledSize * opp.evBps) / 10000
      const executionLoss = (filledSize * slippageBps) / 10000

      if (executionPnl <= 0) {
        consecutiveFails += 1
        if (
          consecutiveFails >= this.config.riskConfig.consecutiveFailThreshold
        ) {
          riskEvents.push({
            ts: tick.ts,
            type: "consecutive_fail",
            reason: "consecutive_failures",
            impact: 0,
          })
        }
      } else {
        consecutiveFails = 0
        wins += 1
      }

      executed += 1
      totalPnl += executionPnl
      currentEquity += executionPnl
      inventory += filledSize
      totalEvBps += opp.evBps
      totalHoldingTimeMs += 3000

      pnlEvents.push({ ts: tick.ts, pnl: executionPnl })

      executionEvents.push({
        ts: tick.ts,
        opportunityId: opp.id,
        marketId: tick.marketId,
        side: "buy",
        intendedSize: size,
        filledSize,
        intendedPrice: adjPrice,
        avgPrice,
        slippageBps,
        delayMs,
        status:
          filledSize >= size ? "filled" : filledSize > 0 ? "partial" : "failed",
      })

      backtestEvents.push({
        ts: tick.ts,
        type: "execution",
        data: { opportunity: opp, filledSize, avgPrice },
        pnl: executionPnl,
        signalPnl,
        executionLoss,
      })
    }

    const pnlCurve = generatePnlCurve(pnlEvents, equity)
    const summaryStats = computeSummaryStatistics(pnlCurve)
    const execStats = computeExecutionStatistics(executionEvents)
    const riskStats = computeRiskStatistics(riskEvents)
    const attribution = attributePnl(backtestEvents)

    const mcResult = monteCarloEnhanced(
      totalPnl,
      summaryStats.maxDrawdown,
      this.config.monteCarloRuns,
      this.config.perturbationRanges,
      this.config.samplingMethod
    )

    const mcDistribution = generateMcDistribution(mcResult.pnlDistribution)

    const sensitivityAnalysis = this.computeSensitivity(
      backtestEvents,
      mcResult
    )

    const result: BacktestResultEnhanced = {
      totalPnl,
      totalPnlBps: (totalPnl / equity) * 10000,
      sharpeRatio: summaryStats.sharpeRatio,
      sortinoRatio: summaryStats.sortinoRatio,
      maxDrawdown: summaryStats.maxDrawdown,
      maxDrawdownPct: summaryStats.maxDrawdownPct,
      totalOpportunities: opportunities,
      totalExecuted: executed,
      winRate: executed > 0 ? wins / executed : 0,
      avgEvBps: opportunities > 0 ? totalEvBps / opportunities : 0,
      avgHoldingTimeMs: executed > 0 ? totalHoldingTimeMs / executed : 0,
      avgSlippageBps: execStats.avgSlippageBps,
      p95SlippageBps: execStats.p95SlippageBps,
      avgDelayMs: execStats.avgDelayMs,
      p99DelayMs: execStats.p99DelayMs,
      legCompletionRate: execStats.legCompletionRate,
      killSwitchTriggered,
      riskLimitBreaches,
      consecutiveFailEvents: riskStats.consecutiveFailEvents,
      signalPnl: attribution.signalPnl,
      executionLoss: attribution.executionLoss,
      inventoryLoss: attribution.inventoryLoss,
      riskControlLoss: attribution.riskControlLoss,
      mcPnLMean: mcResult.meanPnl,
      mcPnLP05: mcResult.p05Pnl,
      mcPnLP95: mcResult.p95Pnl,
      mcMaxDdMean: mcResult.meanMaxDd,
      mcMaxDdP95: mcResult.p95MaxDd,
      mcRuinProbability: mcResult.ruinProbability,
      sensitivityAnalysis,
    }

    return result
  }

  runMonteCarlo(
    baseResult: BacktestResultEnhanced,
    runs: number
  ): MonteCarloResult {
    return monteCarloEnhanced(
      baseResult.totalPnl,
      baseResult.maxDrawdown,
      runs,
      this.config.perturbationRanges,
      this.config.samplingMethod
    )
  }

  perturbParams(
    params: BacktestParams,
    ranges: PerturbationRanges
  ): BacktestParams {
    return perturbParams(params, ranges)
  }

  attributePnl(events: BacktestEvent[]): AttributionResult {
    return attributePnl(events)
  }

  generateReport(result: BacktestResultEnhanced): BacktestReport {
    const pnlCurve = generatePnlCurve(
      [
        { ts: 0, pnl: 0 },
        { ts: this.config.dataEnd, pnl: result.totalPnl },
      ],
      10000
    )
    const mcDistribution = generateMcDistribution(
      Array.from(
        { length: 100 },
        (_, i) =>
          result.mcPnLP05 + ((result.mcPnLP95 - result.mcPnLP05) * i) / 100
      )
    )

    return generateReport(result, pnlCurve, [], [], mcDistribution, {}, {})
  }

  private applyBookEventEnhanced(
    current: BookState,
    event: { type: string; payload: Record<string, unknown> }
  ): BookState {
    if (event.type !== "book_update") return current
    const payload = event.payload
    return {
      yesBid:
        typeof payload.yesBid === "number" ? payload.yesBid : current.yesBid,
      yesAsk:
        typeof payload.yesAsk === "number" ? payload.yesAsk : current.yesAsk,
      noBid: typeof payload.noBid === "number" ? payload.noBid : current.noBid,
      noAsk: typeof payload.noAsk === "number" ? payload.noAsk : current.noAsk,
    }
  }

  private simulateFillRate(confidence: number, size: number): number {
    const baseRate = this.config.executionConfig.partialFillBaseRate
    const decay = this.config.executionConfig.partialFillSizeDecay
    const sizeAdjustment = Math.exp(-size * decay)
    return baseRate + confidence * 0.3 * sizeAdjustment
  }

  private simulateSlippage(size: number, volatility: number): number {
    const baseSlippage = this.config.executionConfig.slippageBps
    const sizeImpact = Math.log10(Math.max(1, size)) * 5
    const volatilityImpact = volatility * 100
    return baseSlippage + sizeImpact + volatilityImpact
  }

  private estimateVolatility(aggregated: Array<{ avgPrice: number }>): number {
    if (aggregated.length < 2) return 0.02

    const prices = aggregated.map((a) => a.avgPrice)
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length
    const variance =
      prices.reduce((a, p) => a + (p - mean) ** 2, 0) / prices.length
    return Math.sqrt(variance)
  }

  private computeSensitivity(
    events: BacktestEvent[],
    mcResult: MonteCarloResult
  ): Record<string, number> {
    const baseParams = createDefaultBaseParams()
    const perturbations = generatePerturbationSet(
      this.config.perturbationRanges,
      100,
      "lhs"
    )

    const mockResults: BacktestResultEnhanced[] = perturbations.map((p) => ({
      ...this.createEmptyResult(),
      totalPnl: mcResult.meanPnl * p.slippageMultiplier * p.fillRate,
    }))

    return computeSensitivityFromMonteCarlo(
      mockResults[0],
      mockResults,
      perturbations
    )
  }

  private createEmptyResult(): BacktestResultEnhanced {
    return {
      totalPnl: 0,
      totalPnlBps: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
      maxDrawdown: 0,
      maxDrawdownPct: 0,
      totalOpportunities: 0,
      totalExecuted: 0,
      winRate: 0,
      avgEvBps: 0,
      avgHoldingTimeMs: 0,
      avgSlippageBps: 0,
      p95SlippageBps: 0,
      avgDelayMs: 0,
      p99DelayMs: 0,
      legCompletionRate: 0,
      killSwitchTriggered: 0,
      riskLimitBreaches: 0,
      consecutiveFailEvents: 0,
      signalPnl: 0,
      executionLoss: 0,
      inventoryLoss: 0,
      riskControlLoss: 0,
      mcPnLMean: 0,
      mcPnLP05: 0,
      mcPnLP95: 0,
      mcMaxDdMean: 0,
      mcMaxDdP95: 0,
      mcRuinProbability: 0,
      sensitivityAnalysis: {},
    }
  }
}

export function runEnhancedBacktest(
  data: HistoricalData,
  config: BacktestConfigEnhanced
): BacktestResultEnhanced {
  const engine = new BacktestEngineEnhanced(config)
  return engine.runBacktest(data)
}

export function runEnhancedBacktestWithReport(
  data: HistoricalData,
  config: BacktestConfigEnhanced
): { result: BacktestResultEnhanced; report: BacktestReport } {
  const engine = new BacktestEngineEnhanced(config)
  const result = engine.runBacktest(data)
  const report = engine.generateReport(result)
  return { result, report }
}

export { createSyntheticData }
