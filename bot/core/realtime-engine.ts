import { FeatureEngine } from "../features/engine"
import { PaperPortfolio } from "../paper/portfolio"
import { type BotConfig } from "../config"
import { generateOpportunity } from "../signal"
import { preTradeCheck } from "../risk/pre_trade"
import { kellySize } from "../execution/kelly"
import {
  analyzeDepth,
  splitOrderSize,
  computeLimitPrice,
} from "../execution/depth"
import { checkExitOpportunity } from "../execution/exit"
import { tickToMarketEvents, type SyntheticTick } from "../ingest/adapter"
import {
  applyBookEvent,
  getDefaultBookState,
  type BookState,
} from "../ingest/orderbook"
import { createDataSource } from "../integration"
import { StrategyRouter, createDefaultRouter } from "../signal/router"
import type {
  RoutedOpportunity,
  StrategyType,
  StatArbConfig,
  TermStructureConfig,
  MarketInfo,
} from "../contracts/types"
import { computeBookMetrics } from "../signal/book-metrics"
import { computeTradeMetrics } from "../signal/trade-metrics"
import {
  generateMicrostructureOpportunity,
  detectMicrostructureOpportunity,
} from "../signal/microstructure"
import { DEFAULT_MICROSTRUCTURE_CONFIG } from "../config/microstructure-config"
import { SpreadHistory } from "../data/spread-history"
import { computeStatArb, generateStatArbOpportunity } from "../signal/stat-arb"
import {
  computeTermSpread,
  generateTermOpportunity,
  identifyTermMarkets,
} from "../signal/term-structure"

const DEFAULT_PAIR_CONFIGS: StatArbConfig[] = [
  {
    pairId: "trump-vs-harris",
    marketA: "mkt-trump-win",
    marketB: "mkt-harris-win",
    hedgeRatio: 1,
    lookbackWindow: 50,
    entryZThreshold: 2,
    exitZThreshold: 0.5,
    maxHoldingMs: 3600000,
    stopLossZThreshold: 4,
  },
  {
    pairId: "fed-vs-inflation",
    marketA: "mkt-fed-cut",
    marketB: "mkt-inflation-high",
    hedgeRatio: 0.8,
    lookbackWindow: 50,
    entryZThreshold: 2,
    exitZThreshold: 0.5,
    maxHoldingMs: 3600000,
    stopLossZThreshold: 4,
  },
]

const DEFAULT_TERM_CONFIGS: TermStructureConfig[] = [
  {
    eventId: "presidential-election",
    markets: [
      { marketId: "mkt-trump-dec", expiryTs: 1735689600 },
      { marketId: "mkt-trump-jan", expiryTs: 1738368000 },
    ],
    termSpreadThreshold: 0.05,
    maxHoldingBeforeExpiryMs: 60000,
    timeValueDecayRate: 0.001,
  },
]

export type RealtimeResult = {
  trades: number
  exits: number
  skips: number
  blocks: number
  alerts: string[]
  spreadChanges: Array<{
    marketId: string
    oldSpread: number
    newSpread: number
  }>
}

export class RealtimeEngine {
  private config: BotConfig
  private portfolio: PaperPortfolio
  private featureEngine: FeatureEngine
  private router: StrategyRouter
  private lastSpreads: Map<string, number> = new Map()
  private bookStates: Map<string, BookState> = new Map()
  private marketEvents: Map<string, Array<{ ts: number; event: any }>> =
    new Map()
  private spreadHistory: SpreadHistory
  private marketPrices: Map<string, number>
  private pairConfigs: StatArbConfig[]
  private termConfigs: TermStructureConfig[]
  private marketInfos: Map<string, MarketInfo>
  private running = false
  private scanInterval = 1000
  private lastScanTime = 0

  constructor(portfolio: PaperPortfolio, config: BotConfig) {
    this.config = config
    this.portfolio = portfolio
    this.featureEngine = new FeatureEngine()
    this.router = createDefaultRouter()
    this.spreadHistory = new SpreadHistory()
    this.marketPrices = new Map()
    this.pairConfigs = DEFAULT_PAIR_CONFIGS
    this.termConfigs = DEFAULT_TERM_CONFIGS
    this.marketInfos = new Map()
  }

  setScanInterval(ms: number): void {
    this.scanInterval = ms
  }

  processTick(tick: SyntheticTick): RealtimeResult {
    const alerts: string[] = []
    const spreadChanges: Array<{
      marketId: string
      oldSpread: number
      newSpread: number
    }> = []
    let trades = 0
    let exits = 0
    let skips = 0
    let blocks = 0

    const currentSpread = tick.yesAsk + tick.noAsk - 1
    const lastSpread = this.lastSpreads.get(tick.marketId)

    if (lastSpread !== undefined) {
      const spreadChange = currentSpread - lastSpread
      if (spreadChange < -0.001) {
        spreadChanges.push({
          marketId: tick.marketId,
          oldSpread: lastSpread,
          newSpread: currentSpread,
        })

        const exitDecision = checkExitOpportunity(
          tick.marketId,
          this.portfolio,
          currentSpread,
          lastSpread,
          this.config
        )

        if (exitDecision.shouldExit) {
          this.executeExit(tick, exitDecision)
          exits += 1
          alerts.push(
            `[EXIT] ${tick.marketId} spread narrowed from ${lastSpread.toFixed(4)} to ${currentSpread.toFixed(4)}, locked profit`
          )
        }
      }
    }

    this.lastSpreads.set(tick.marketId, currentSpread)

    this.portfolio.markToMarket(tick.marketId, tick.yesAsk, tick.noAsk)

    const snap = this.portfolio.snapshot()
    if (snap.drawdownPct >= Math.abs(this.config.risk.maxDrawdownPct)) {
      alerts.push(
        `[CRIT] Drawdown ${snap.drawdownPct.toFixed(2)}% exceeds limit`
      )
      return { trades, exits, skips, blocks: 1, alerts, spreadChanges }
    }

    let book = this.bookStates.get(tick.marketId) ?? getDefaultBookState()
    const events = tickToMarketEvents(tick)
    for (const evt of events) {
      book = applyBookEvent(book, evt)
    }
    this.bookStates.set(tick.marketId, book)

    const marketEventsList = this.marketEvents.get(tick.marketId) ?? []
    marketEventsList.push({ ts: tick.ts, event: events })
    if (marketEventsList.length > 100) {
      marketEventsList.shift()
    }
    this.marketEvents.set(tick.marketId, marketEventsList)

    const feature = this.featureEngine.build(
      tick.marketId,
      tick.ts,
      book,
      events
    )

    const routedOpps = this.router.route(feature, book, tick.ts)

    const microOpp = this.generateMicrostructureOpportunity(
      tick.marketId,
      book,
      events,
      tick.ts
    )
    if (microOpp) {
      routedOpps.push(microOpp)
    }

    this.marketPrices.set(tick.marketId, book.yesAsk)
    const statArbOpps = this.generateStatArbOpportunities(tick.ts)
    for (const opp of statArbOpps) {
      routedOpps.push(opp)
    }

    const termOpps = this.generateTermStructureOpportunities(tick.ts)
    for (const opp of termOpps) {
      routedOpps.push(opp)
    }

    if (routedOpps.length === 0) {
      const staticOpp = generateOpportunity(
        feature,
        book,
        tick.ts,
        this.config.signal.costBps,
        this.config.signal.minEvBps
      )
      if (
        staticOpp &&
        staticOpp.confidence >= this.config.signal.confidenceThreshold
      ) {
        routedOpps.push({
          opportunity: staticOpp,
          sourceStrategy: "static_arb",
          priority: 1,
          resourceClaim: {
            marketIds: [tick.marketId],
            estimatedExposure: 50,
            estimatedDurationMs: 5000,
          },
        })
      }
    }

    if (routedOpps.length === 0) {
      skips += 1
      return { trades, exits, skips, blocks, alerts, spreadChanges }
    }

    const arbitration = this.router.arbitrate(routedOpps)
    if (!arbitration.selected) {
      skips += routedOpps.length
      return { trades, exits, skips, blocks, alerts, spreadChanges }
    }

    const opp = arbitration.selected.opportunity

    const decision = preTradeCheck(
      opp,
      this.portfolio.effectiveOpenNotional,
      this.config.portfolio.maxOpenNotional
    )
    if (!decision.allow) {
      blocks += 1
      alerts.push(
        `[BLOCK] ${decision.reason}: ${opp.marketIds.join(",")} EV=${opp.evBps.toFixed(1)}bps`
      )
      return { trades, exits, skips, blocks, alerts, spreadChanges }
    }

    const depthAnalysis = analyzeDepth(book, tick.volume)
    const baseSize = kellySize(
      opp.evBps,
      opp.confidence,
      this.portfolio.equity,
      this.config.execution.kellyCap
    )

    if (baseSize < 0.01) {
      skips += 1
      return { trades, exits, skips, blocks, alerts, spreadChanges }
    }

    const orderSplits = splitOrderSize(baseSize, depthAnalysis)
    const strategy: StrategyType = opp.strategy as StrategyType

    for (const split of orderSplits) {
      const limitYes = computeLimitPrice(
        book.yesAsk,
        split.size,
        "BUY",
        this.config
      )
      const limitNo = computeLimitPrice(
        book.noAsk,
        split.size,
        "BUY",
        this.config
      )

      this.portfolio.executeTrade(
        tick.marketId,
        "YES",
        limitYes,
        split.size / 2,
        tick.ts,
        this.config.execution.slippageBps,
        this.config.execution.partialFillBaseRate,
        this.config.execution.partialFillSizeDecay,
        strategy
      )
      this.portfolio.executeTrade(
        tick.marketId,
        "NO",
        limitNo,
        split.size / 2,
        tick.ts,
        this.config.execution.slippageBps,
        this.config.execution.partialFillBaseRate,
        this.config.execution.partialFillSizeDecay,
        strategy
      )
      trades += 1
      alerts.push(
        `[TRADE] ${tick.marketId} via ${strategy} EV=${opp.evBps.toFixed(1)}bps conf=${opp.confidence.toFixed(2)}`
      )
    }

    this.portfolio.markToMarket(tick.marketId, tick.yesAsk, tick.noAsk)

    return { trades, exits, skips, blocks, alerts, spreadChanges }
  }

  private generateMicrostructureOpportunity(
    marketId: string,
    book: BookState,
    events: any[],
    now: number
  ): RoutedOpportunity | null {
    const recentEvents = (this.marketEvents.get(marketId) ?? [])
      .slice(-20)
      .flatMap((e) => e.event)

    const bookMetrics = computeBookMetrics(book, undefined)
    const tradeMetrics = computeTradeMetrics(
      recentEvents,
      5000,
      DEFAULT_MICROSTRUCTURE_CONFIG.largeTradeMultiplier
    )

    const signal = detectMicrostructureOpportunity(
      bookMetrics,
      tradeMetrics,
      DEFAULT_MICROSTRUCTURE_CONFIG
    )

    if (!signal || signal.direction === "neutral") {
      return null
    }

    return {
      opportunity: {
        id: `${marketId}-microstructure-${now}`,
        strategy: "microstructure",
        marketIds: [marketId],
        evBps: signal.evBps,
        confidence: signal.confidence,
        ttlMs: 2000,
        createdAt: now,
      },
      sourceStrategy: "microstructure",
      priority: 0.8,
      resourceClaim: {
        marketIds: [marketId],
        estimatedExposure: 50,
        estimatedDurationMs: 2000,
      },
    }
  }

  private generateStatArbOpportunities(now: number): RoutedOpportunity[] {
    const opportunities: RoutedOpportunity[] = []

    for (const pairConfig of this.pairConfigs) {
      const priceA = this.marketPrices.get(pairConfig.marketA)
      const priceB = this.marketPrices.get(pairConfig.marketB)

      if (priceA === undefined || priceB === undefined) {
        continue
      }

      this.spreadHistory.add(
        pairConfig.pairId,
        now,
        priceA,
        priceB,
        pairConfig.hedgeRatio
      )

      const signal = computeStatArb(
        this.marketPrices,
        this.spreadHistory,
        pairConfig
      )

      if (!signal || signal.direction === "neutral" || signal.evBps <= 0) {
        continue
      }

      const opp = generateStatArbOpportunity(signal, pairConfig, now)
      if (!opp) {
        continue
      }

      opportunities.push({
        opportunity: opp,
        sourceStrategy: "stat_arb",
        priority: 0.7,
        resourceClaim: {
          marketIds: [pairConfig.marketA, pairConfig.marketB],
          estimatedExposure: 30,
          estimatedDurationMs: pairConfig.maxHoldingMs,
        },
      })
    }

    return opportunities
  }

  private generateTermStructureOpportunities(now: number): RoutedOpportunity[] {
    const opportunities: RoutedOpportunity[] = []

    for (const termConfig of this.termConfigs) {
      const spread = computeTermSpread(termConfig, this.marketPrices, now)
      if (!spread) {
        continue
      }

      const signal = generateTermOpportunity(spread, termConfig)
      if (!signal || signal.direction === "neutral") {
        continue
      }

      opportunities.push({
        opportunity: {
          id: `${termConfig.eventId}-term-${now}`,
          strategy: "term_structure",
          marketIds: [signal.shortMarketId, signal.longMarketId],
          evBps: signal.evBps,
          confidence: signal.confidence,
          ttlMs: signal.ttlMs,
          createdAt: now,
        },
        sourceStrategy: "term_structure",
        priority: 0.6,
        resourceClaim: {
          marketIds: [signal.shortMarketId, signal.longMarketId],
          estimatedExposure: 40,
          estimatedDurationMs: signal.ttlMs,
        },
      })
    }

    return opportunities
  }

  async scanOnce(): Promise<RealtimeResult> {
    const dataSource = createDataSource(this.config.data.dataSource)
    const ticks = await dataSource.fetchOnce()
    if (ticks.length === 0) {
      return {
        trades: 0,
        exits: 0,
        skips: 0,
        blocks: 0,
        alerts: [],
        spreadChanges: [],
      }
    }

    const result: RealtimeResult = {
      trades: 0,
      exits: 0,
      skips: 0,
      blocks: 0,
      alerts: [],
      spreadChanges: [],
    }

    for (const tick of ticks) {
      const tickResult = this.processTick(tick)
      result.trades += tickResult.trades
      result.exits += tickResult.exits
      result.skips += tickResult.skips
      result.blocks += tickResult.blocks
      result.alerts.push(...tickResult.alerts)
      result.spreadChanges.push(...tickResult.spreadChanges)
    }

    return result
  }

  private executeExit(
    tick: SyntheticTick,
    decision: { yesSize: number; noSize: number }
  ): void {
    const yesPos = this.portfolio.positions.get(`${tick.marketId}:YES`)
    const noPos = this.portfolio.positions.get(`${tick.marketId}:NO`)

    if (yesPos && decision.yesSize > 0) {
      const sellValue = decision.yesSize * tick.yesBid
      this.portfolio.cashBalance += sellValue
      yesPos.size -= decision.yesSize
      if (yesPos.size <= 0.01) {
        this.portfolio.positions.delete(`${tick.marketId}:YES`)
      }
    }

    if (noPos && decision.noSize > 0) {
      const sellValue = decision.noSize * tick.noBid
      this.portfolio.cashBalance += sellValue
      noPos.size -= decision.noSize
      if (noPos.size <= 0.01) {
        this.portfolio.positions.delete(`${tick.marketId}:NO`)
      }
    }
  }

  start(onCycle?: (result: RealtimeResult) => void): void {
    this.running = true
    const loop = async (): Promise<void> => {
      while (this.running) {
        const now = Date.now()
        if (now - this.lastScanTime >= this.scanInterval) {
          this.lastScanTime = now
          try {
            const result = await this.scanOnce()
            if (onCycle) onCycle(result)
          } catch (err) {
            console.error(`[ERROR] Scan failed: ${err}`)
          }
        }
        await new Promise((r) => setTimeout(r, 100))
      }
    }
    loop()
  }

  stop(): void {
    this.running = false
  }

  isRunning(): boolean {
    return this.running
  }
}
