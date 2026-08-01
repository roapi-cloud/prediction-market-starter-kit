import { tickToMarketEvents, type SyntheticTick } from "../ingest/adapter"
import {
  applyBookEvent,
  getDefaultBookState,
  type BookState,
} from "../ingest/orderbook"
import { FeatureEngine } from "../features/engine"
import { generateOpportunity } from "../signal"
import { preTradeCheck } from "../risk/pre_trade"
import { kellySize } from "../execution/kelly"
import { stoikovPriceAdjust } from "../execution/stoikov"
import { PaperPortfolio } from "../paper/portfolio"
import type { BotConfig } from "../config"
import { StrategyRouter, createDefaultRouter } from "../signal/router"
import type {
  StrategyType,
  StatArbConfig,
  TermStructureConfig,
} from "../contracts/types"
import { computeBookMetrics } from "../signal/book-metrics"
import { computeTradeMetrics } from "../signal/trade-metrics"
import { detectMicrostructureOpportunity } from "../signal/microstructure"
import { DEFAULT_MICROSTRUCTURE_CONFIG } from "../config/microstructure-config"
import { SpreadHistory } from "../data/spread-history"
import { computeStatArb, generateStatArbOpportunity } from "../signal/stat-arb"
import {
  computeTermSpread,
  generateTermOpportunity,
} from "../signal/term-structure"

// Default configs are now empty - should be populated by discovery
const DEFAULT_PAIR_CONFIGS: StatArbConfig[] = []
const DEFAULT_TERM_CONFIGS: TermStructureConfig[] = []

// Global dynamic configs (set by daemon at startup)
let dynamicPairConfigs: StatArbConfig[] = []
let dynamicTermConfigs: TermStructureConfig[] = []

/**
 * Set dynamic stat_arb configs (called by daemon after discovery)
 */
export function setStatArbConfigs(configs: StatArbConfig[]): void {
  dynamicPairConfigs = configs
}

/**
 * Set dynamic term_structure configs (called by daemon after discovery)
 */
export function setTermStructureConfigs(configs: TermStructureConfig[]): void {
  dynamicTermConfigs = configs
}

/**
 * Get current stat_arb configs
 */
export function getStatArbConfigs(): StatArbConfig[] {
  return dynamicPairConfigs.length > 0 ? dynamicPairConfigs : DEFAULT_PAIR_CONFIGS
}

/**
 * Get current term_structure configs
 */
export function getTermStructureConfigs(): TermStructureConfig[] {
  return dynamicTermConfigs.length > 0 ? dynamicTermConfigs : DEFAULT_TERM_CONFIGS
}

export type CycleResult = {
  trades: number
  skips: number
  blocks: number
  exits: number
  alerts: string[]
  strategyStats: Map<StrategyType, { trades: number; pnl: number }>
  consecutiveZeroTrades: number
}

export function runCycle(
  ticks: SyntheticTick[],
  portfolio: PaperPortfolio,
  featureEngine: FeatureEngine,
  config: BotConfig
): CycleResult {
  if (ticks.length === 0)
    return {
      trades: 0,
      skips: 0,
      blocks: 0,
      exits: 0,
      alerts: [],
      strategyStats: new Map(),
      consecutiveZeroTrades: 0,
    }

  let book: BookState = getDefaultBookState()
  let trades = 0
  let skips = 0
  let blocks = 0
  let exits = 0
  const alerts: string[] = []
  const router = createDefaultRouter()
  const strategyStats = new Map<StrategyType, { trades: number; pnl: number }>()
  const marketEventsMap = new Map<string, any[]>()
  const spreadHistory = new SpreadHistory()
  const marketPrices = new Map<string, number>()
  let consecutiveZeroTrades = 0

  for (const strategy of [
    "static_arb",
    "stat_arb",
    "microstructure",
    "term_structure",
  ] as StrategyType[]) {
    strategyStats.set(strategy, { trades: 0, pnl: 0 })
  }

  for (const tick of ticks) {
    portfolio.markToMarket(tick.marketId, tick.yesAsk, tick.noAsk)
  }

  const snap = portfolio.snapshot()
  if (snap.drawdownPct >= Math.abs(config.risk.maxDrawdownPct)) {
    alerts.push(
      `[CRIT] Drawdown ${snap.drawdownPct.toFixed(2)}% exceeds ${config.risk.maxDrawdownPct}% limit!`
    )
  } else if (snap.drawdownPct >= Math.abs(config.risk.intradayStopPct)) {
    alerts.push(
      `[WARN] Drawdown ${snap.drawdownPct.toFixed(2)}% approaching limit`
    )
  }

  for (const pos of portfolio.positions.values()) {
    const weight =
      ((pos.size * pos.currentPrice) / Math.max(1, snap.equity)) * 100
    if (weight > config.risk.maxPositionPct) {
      alerts.push(
        `[WARN] ${pos.marketId}:${pos.side} concentration ${weight.toFixed(1)}% > ${config.risk.maxPositionPct}%`
      )
    }
  }

  for (const tick of ticks) {
    const events = tickToMarketEvents(tick)
    for (const evt of events) {
      book = applyBookEvent(book, evt)
    }

    const existingEvents = marketEventsMap.get(tick.marketId) ?? []
    existingEvents.push(...events)
    if (existingEvents.length > 100) {
      existingEvents.splice(0, existingEvents.length - 100)
    }
    marketEventsMap.set(tick.marketId, existingEvents)

    marketPrices.set(tick.marketId, book.yesAsk)

    const feature = featureEngine.build(tick.marketId, tick.ts, book, events)

    const routedOpps = router.route(feature, book, tick.ts)

    const bookMetrics = computeBookMetrics(book, undefined)
    const tradeMetrics = computeTradeMetrics(
      existingEvents.slice(-20),
      5000,
      DEFAULT_MICROSTRUCTURE_CONFIG.largeTradeMultiplier
    )
    const microSignal = detectMicrostructureOpportunity(
      bookMetrics,
      tradeMetrics,
      DEFAULT_MICROSTRUCTURE_CONFIG
    )

    if (
      microSignal &&
      microSignal.direction !== "neutral" &&
      microSignal.evBps > 0
    ) {
      routedOpps.push({
        opportunity: {
          id: `${tick.marketId}-microstructure-${tick.ts}`,
          strategy: "microstructure",
          marketIds: [tick.marketId],
          evBps: microSignal.evBps,
          confidence: microSignal.confidence,
          ttlMs: 2000,
          createdAt: tick.ts,
        },
        sourceStrategy: "microstructure",
        priority: 0.8,
        resourceClaim: {
          marketIds: [tick.marketId],
          estimatedExposure: 50,
          estimatedDurationMs: 2000,
        },
      })
    }

    for (const pairConfig of getStatArbConfigs()) {
      const priceA = marketPrices.get(pairConfig.marketA)
      const priceB = marketPrices.get(pairConfig.marketB)

      if (priceA === undefined || priceB === undefined) {
        continue
      }

      spreadHistory.add(
        pairConfig.pairId,
        tick.ts,
        priceA,
        priceB,
        pairConfig.hedgeRatio
      )

      const signal = computeStatArb(marketPrices, spreadHistory, pairConfig)

      if (!signal || signal.direction === "neutral" || signal.evBps <= 0) {
        continue
      }

      const opp = generateStatArbOpportunity(signal, pairConfig, tick.ts)
      if (!opp) {
        continue
      }

      routedOpps.push({
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

    for (const termConfig of getTermStructureConfigs()) {
      const spread = computeTermSpread(termConfig, marketPrices, tick.ts)
      if (!spread) {
        continue
      }

      const signal = generateTermOpportunity(spread, termConfig)
      if (!signal || signal.direction === "neutral") {
        continue
      }

      routedOpps.push({
        opportunity: {
          id: `${termConfig.eventId}-term-${tick.ts}`,
          strategy: "term_structure",
          marketIds: [signal.shortMarketId, signal.longMarketId],
          evBps: signal.evBps,
          confidence: signal.confidence,
          ttlMs: signal.ttlMs,
          createdAt: tick.ts,
        },
        sourceStrategy: "term_structure",
        priority: 1.5, // Higher priority to test term_structure
        resourceClaim: {
          marketIds: [signal.shortMarketId, signal.longMarketId],
          estimatedExposure: 40,
          estimatedDurationMs: signal.ttlMs,
        },
      })
    }

    if (routedOpps.length === 0) {
      const staticOpp = generateOpportunity(
        feature,
        book,
        tick.ts,
        config.signal.costBps,
        config.signal.minEvBps
      )
      if (
        staticOpp &&
        staticOpp.confidence >= config.signal.confidenceThreshold
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
      continue
    }

    const arbitration = router.arbitrate(routedOpps)
    if (!arbitration.selected) {
      skips += routedOpps.length
      continue
    }

    const opp = arbitration.selected.opportunity

    const decision = preTradeCheck(
      opp,
      portfolio.effectiveOpenNotional,
      config.portfolio.maxOpenNotional
    )
    if (!decision.allow) {
      blocks += 1
      alerts.push(
        `[BLOCK] ${decision.reason}: ${opp.marketIds.join(",")} EV=${opp.evBps.toFixed(1)}bps`
      )
      continue
    }

    const pnlPct = (portfolio.totalPnl / Math.max(1, portfolio.equity)) * 100
    const ddPct = portfolio.drawdownPct
    if (
      pnlPct <= -config.risk.intradayStopPct ||
      ddPct >= Math.abs(config.risk.maxDrawdownPct)
    ) {
      blocks += 1
      alerts.push(`[STOP] Circuit breaker active — no new trades`)
      break
    }

    const size = kellySize(
      opp.evBps,
      opp.confidence,
      portfolio.equity,
      config.execution.kellyCap
    )
    if (size < 0.01) {
      skips += 1
      continue
    }

    const inventory = Array.from(portfolio.positions.values()).reduce(
      (acc, p) => acc + (p.side === "YES" ? p.size : -p.size),
      0
    )
    const adjYes = stoikovPriceAdjust(
      book.yesAsk,
      inventory,
      config.execution.stoikovRiskAversion
    )
    const adjNo = stoikovPriceAdjust(
      book.noAsk,
      -inventory,
      config.execution.stoikovRiskAversion
    )

    const strategy: StrategyType = opp.strategy as StrategyType

    // Execute trades for all markets in the opportunity
    const marketsToTrade = opp.marketIds.length > 1 ? opp.marketIds : [tick.marketId]

    for (const marketId of marketsToTrade) {
      // For multi-market strategies, use the first market's book (simplified)
      const tradePrice = marketId === tick.marketId ? book.yesAsk : (marketPrices.get(marketId) || 0.5)

      portfolio.executeTrade(
        marketId,
        "YES",
        tradePrice,
        size / (2 * marketsToTrade.length),
        tick.ts,
        config.execution.slippageBps,
        config.execution.partialFillBaseRate,
        config.execution.partialFillSizeDecay,
        strategy
      )
      portfolio.executeTrade(
        marketId,
        "NO",
        1 - tradePrice + 0.02, // Approximate NO price
        size / (2 * marketsToTrade.length),
        tick.ts,
        config.execution.slippageBps,
        config.execution.partialFillBaseRate,
        config.execution.partialFillSizeDecay,
        strategy
      )
    }

    trades += marketsToTrade.length
    const stats = strategyStats.get(strategy)
    if (stats) {
      stats.trades += marketsToTrade.length
    }
    alerts.push(
      `[TRADE] ${marketsToTrade.join(",")} via ${strategy} EV=${opp.evBps.toFixed(1)}bps conf=${opp.confidence.toFixed(2)}`
    )
  }

  for (const tick of ticks) {
    portfolio.markToMarket(tick.marketId, tick.yesAsk, tick.noAsk)
  }

  if (trades === 0) {
    consecutiveZeroTrades += 1
  } else {
    consecutiveZeroTrades = 0
  }

  const EXIT_THRESHOLD_CYCLES = 10
  const MIN_HOLD_TIME_MS = 60000
  const SPREAD_EXIT_RATIO = 0.5

  if (consecutiveZeroTrades >= EXIT_THRESHOLD_CYCLES) {
    alerts.push(
      `[EXIT] No trades for ${consecutiveZeroTrades} cycles, checking positions...`
    )

    const marketIds = new Set<string>()
    for (const pos of portfolio.positions.values()) {
      marketIds.add(pos.marketId)
    }

    for (const mid of marketIds) {
      const yesPos = portfolio.positions.get(`${mid}:YES`)
      const noPos = portfolio.positions.get(`${mid}:NO`)

      if (!yesPos || !noPos) continue

      const hedgedSize = Math.min(yesPos.size, noPos.size)
      if (hedgedSize < 1) continue

      const currentSpread = yesPos.currentPrice + noPos.currentPrice - 1
      const entrySpread = yesPos.avgEntry + noPos.avgEntry - 1

      const holdTime =
        Date.now() -
        (yesPos.avgEntry > 0
          ? portfolio.orders.find((o) => o.marketId === mid)?.ts || 0
          : 0)

      const shouldExit =
        currentSpread < entrySpread * SPREAD_EXIT_RATIO ||
        (currentSpread < 0.005 && hedgedSize > 10) ||
        (holdTime > MIN_HOLD_TIME_MS && currentSpread < entrySpread * 0.8)

      if (shouldExit) {
        const exitSize = Math.min(hedgedSize * 0.5, hedgedSize)

        const yesExitPrice = Math.max(0.01, yesPos.currentPrice - 0.01)
        const noExitPrice = Math.max(0.01, noPos.currentPrice - 0.01)

        portfolio.cashBalance += exitSize * yesExitPrice
        portfolio.cashBalance += exitSize * noExitPrice

        yesPos.size -= exitSize
        noPos.size -= exitSize

        if (yesPos.size <= 0.01) {
          portfolio.positions.delete(`${mid}:YES`)
        }
        if (noPos.size <= 0.01) {
          portfolio.positions.delete(`${mid}:NO`)
        }

        exits += 2
        alerts.push(
          `[EXIT] ${mid} hedged=${hedgedSize.toFixed(2)} spread=${(currentSpread * 10000).toFixed(1)}bps -> ${(entrySpread * 10000).toFixed(1)}bps entry`
        )
      }
    }
  }

  return {
    trades,
    skips,
    blocks,
    exits,
    alerts,
    strategyStats,
    consecutiveZeroTrades,
  }
}
