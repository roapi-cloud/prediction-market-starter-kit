import type {
  Opportunity,
  StatArbConfig,
  MarketEvent,
  MicrostructureConfig,
  TermStructureConfig,
  TermSpreadSnapshot,
  TermStructureSignal,
  MarketInfo,
  BayesianOutputEnhanced,
  BayesianOutputWithSemantic,
  SemanticSignal,
  StrategyConfig,
  StrategyState,
  RouterState,
  RoutedOpportunity,
  ArbitrationResult,
  AllocationDecision,
  StrategyExecutionResult,
} from "../contracts/types"
import type { BookState } from "../ingest/orderbook"
import { computeBayesian } from "./bayesian"
import { computeBayesianEnhanced, getGlobalFilter } from "./bayesian-enhanced"
import { computeEdge } from "./edge"
import {
  computeStatArb,
  generateStatArbOpportunity,
  updateSpreadHistory,
} from "./stat-arb"
import {
  computeBookMetrics,
  computeTradeMetrics,
  detectMicrostructureOpportunity,
  generateMicrostructureOpportunity,
} from "./microstructure"
import {
  identifyTermMarkets,
  computeTermSpread,
  generateTermOpportunity,
  selectTermPair,
  validateTermConfig,
} from "./term-structure"
import { recordTermSpread } from "../data/term-history"
import type { FeatureSnapshot } from "../contracts/types"
import { SpreadHistory } from "../data/spread-history"
import {
  SemanticEngine,
  getSemanticEngine,
  fetchAndInjectSemantic,
} from "./semantic-engine"
import { injectSemanticPrior, shouldUseSemanticSignal } from "./semantic-prior"
import { StrategyRouter, createDefaultRouter } from "./router"
import { StrategyRegistryManager } from "./registry"
import {
  arbitrate,
  checkResourceConflict,
  checkMarketConflict,
  DEFAULT_ARBITRATION_CONFIG,
} from "./arbitration"
import { allocateCapital, DEFAULT_ALLOCATION_CONFIG } from "./allocation"

export {
  computeBookMetrics,
  computeTradeMetrics,
  detectMicrostructureOpportunity,
  generateMicrostructureOpportunity,
  identifyTermMarkets,
  computeTermSpread,
  generateTermOpportunity,
  selectTermPair,
  validateTermConfig,
  computeBayesianEnhanced,
  getGlobalFilter,
  SemanticEngine,
  getSemanticEngine,
  fetchAndInjectSemantic,
  injectSemanticPrior,
  shouldUseSemanticSignal,
  StrategyRouter,
  createDefaultRouter,
  StrategyRegistryManager,
}

export type BayesianVersion = "simple" | "enhanced"

let globalRouter: StrategyRouter | null = null

export function getRouter(): StrategyRouter {
  if (!globalRouter) {
    globalRouter = createDefaultRouter()
  }
  return globalRouter
}

export function resetRouter(): void {
  globalRouter = null
}

export function initializeRouterWithConfig(
  strategies: StrategyConfig[]
): StrategyRouter {
  const router = new StrategyRouter()
  for (const config of strategies) {
    router.registerStrategy(config)
  }
  globalRouter = router
  return router
}

export function generateMultiStrategyOpportunities(
  feature: FeatureSnapshot,
  book: BookState,
  now: number
): RoutedOpportunity[] {
  const router = getRouter()
  return router.route(feature, book, now)
}

export function selectBestOpportunity(
  feature: FeatureSnapshot,
  book: BookState,
  now: number
): RoutedOpportunity | null {
  const router = getRouter()
  return router.selectBestOpportunity(feature, book, now)
}

export function routeAndArbitrate(
  feature: FeatureSnapshot,
  book: BookState,
  now: number
): ArbitrationResult {
  const router = getRouter()
  return router.routeAndArbitrate(feature, book, now)
}

export function generateOpportunity(
  feature: FeatureSnapshot,
  book: BookState,
  now: number,
  costBps = 20,
  minEvBps = 5,
  bayesianVersion: BayesianVersion = "simple"
): Opportunity | null {
  const bayesian =
    bayesianVersion === "enhanced"
      ? computeBayesianEnhanced(feature)
      : computeBayesian(feature)
  const edge = computeEdge(book, costBps, minEvBps)

  if (!edge.shouldTrade) return null
  if (bayesian.confidence < 0.1) return null

  return {
    id: `${feature.marketId}-${now}`,
    strategy: "static_arb",
    marketIds: [feature.marketId],
    evBps: edge.evBps,
    confidence: bayesian.confidence,
    ttlMs: 3_000,
    createdAt: now,
  }
}

export function generateOpportunityEnhanced(
  feature: FeatureSnapshot,
  book: BookState,
  now: number,
  costBps = 20,
  minEvBps = 5
): { opportunity: Opportunity | null; bayesian: BayesianOutputEnhanced } {
  const bayesian = computeBayesianEnhanced(feature)
  const edge = computeEdge(book, costBps, minEvBps)

  if (!edge.shouldTrade || bayesian.confidence < 0.1) {
    return { opportunity: null, bayesian }
  }

  const opportunity = {
    id: `${feature.marketId}-${now}`,
    strategy: "static_arb" as const,
    marketIds: [feature.marketId],
    evBps: edge.evBps,
    confidence: bayesian.confidence,
    ttlMs: 3_000,
    createdAt: now,
  }

  return { opportunity, bayesian }
}

export async function generateOpportunityWithSemantic(
  feature: FeatureSnapshot,
  book: BookState,
  eventId: string,
  now: number,
  costBps = 20,
  minEvBps = 5
): Promise<{
  opportunity: Opportunity | null
  bayesian: BayesianOutputWithSemantic
  semanticSignal: SemanticSignal | null
}> {
  const bayesian = computeBayesianEnhanced(feature)
  const edge = computeEdge(book, costBps, minEvBps)

  const engine = getSemanticEngine()
  let semanticSignal: SemanticSignal | null = null
  let bayesianWithSemantic: BayesianOutputWithSemantic = {
    ...bayesian,
    semanticAdjustment: 0,
    semanticSignal: undefined,
  }

  if (engine.isEnabled()) {
    semanticSignal = await engine.getSignal(eventId)
    bayesianWithSemantic = injectSemanticPrior(bayesian, semanticSignal)
  }

  if (!edge.shouldTrade) {
    return { opportunity: null, bayesian: bayesianWithSemantic, semanticSignal }
  }

  const confidence = bayesianWithSemantic.confidence
  if (confidence < 0.1) {
    return { opportunity: null, bayesian: bayesianWithSemantic, semanticSignal }
  }

  const opportunity = {
    id: `${feature.marketId}-${now}`,
    strategy: "static_arb" as const,
    marketIds: [feature.marketId],
    evBps: edge.evBps,
    confidence,
    ttlMs: 3_000,
    createdAt: now,
  }

  return { opportunity, bayesian: bayesianWithSemantic, semanticSignal }
}

export class StatArbEngine {
  private history: SpreadHistory
  private configs: StatArbConfig[]

  constructor(configs: StatArbConfig[], maxHistorySize = 1000) {
    this.history = new SpreadHistory(maxHistorySize)
    this.configs = configs
  }

  updateHistory(marketPrices: Map<string, number>, ts: number): void {
    for (const config of this.configs) {
      updateSpreadHistory(this.history, config, marketPrices, ts)
    }
  }

  scan(marketPrices: Map<string, number>, now: number): Opportunity[] {
    const opportunities: Opportunity[] = []

    for (const config of this.configs) {
      const signal = computeStatArb(marketPrices, this.history, config)
      if (!signal) continue

      const opportunity = generateStatArbOpportunity(signal, config, now)
      if (opportunity) {
        opportunities.push(opportunity)
      }
    }

    return opportunities
  }

  addConfig(config: StatArbConfig): void {
    this.configs.push(config)
  }

  removeConfig(pairId: string): void {
    this.configs = this.configs.filter((c) => c.pairId !== pairId)
  }

  getHistory(): SpreadHistory {
    return this.history
  }
}

export class TermStructureEngine {
  private configs: Map<string, TermStructureConfig> = new Map()

  addConfig(config: TermStructureConfig): void {
    if (!validateTermConfig(config)) {
      throw new Error(
        `Invalid term structure config for event ${config.eventId}`
      )
    }
    this.configs.set(config.eventId, config)
  }

  removeConfig(eventId: string): boolean {
    return this.configs.delete(eventId)
  }

  getConfig(eventId: string): TermStructureConfig | undefined {
    return this.configs.get(eventId)
  }

  scan(marketPrices: Map<string, number>, now: number): Opportunity[] {
    const opportunities: Opportunity[] = []

    for (const config of this.configs.values()) {
      const spread = computeTermSpread(config, marketPrices, now)
      if (!spread) continue

      const pair = selectTermPair(config)
      if (pair) {
        recordTermSpread(spread, {
          shortMarketId: pair.short.marketId,
          longMarketId: pair.long.marketId,
        })
      }

      const signal = generateTermOpportunity(spread, config)
      if (!signal) continue

      const opportunity = this.signalToOpportunity(signal, now)
      if (opportunity) {
        opportunities.push(opportunity)
      }
    }

    return opportunities
  }

  private signalToOpportunity(
    signal: TermStructureSignal,
    now: number
  ): Opportunity | null {
    if (signal.direction === "neutral") return null

    return {
      id: `${signal.eventId}-${now}`,
      strategy: "term_structure",
      marketIds: [signal.shortMarketId, signal.longMarketId],
      evBps: signal.evBps,
      confidence: signal.confidence,
      ttlMs: signal.ttlMs,
      createdAt: now,
    }
  }

  scanEvent(
    eventId: string,
    marketPrices: Map<string, number>,
    now: number
  ): Opportunity | null {
    const config = this.configs.get(eventId)
    if (!config) return null

    const spread = computeTermSpread(config, marketPrices, now)
    if (!spread) return null

    const pair = selectTermPair(config)
    if (pair) {
      recordTermSpread(spread, {
        shortMarketId: pair.short.marketId,
        longMarketId: pair.long.marketId,
      })
    }

    const signal = generateTermOpportunity(spread, config)
    if (!signal) return null

    return this.signalToOpportunity(signal, now)
  }
}
