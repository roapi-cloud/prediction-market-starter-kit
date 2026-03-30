import type {
  SemanticConfig,
  SemanticEvent,
  SemanticSignal,
  SemanticSnapshot,
  BayesianOutputEnhanced,
  BayesianOutputWithSemantic,
} from "../contracts/types"
import { getSemanticFetcher } from "../ingest/semantic-fetcher"
import { getSemanticCache } from "../data/semantic-cache"
import {
  loadSemanticConfig,
  isSemanticEnabled,
  getEnabledSources,
} from "../config/semantic-config"
import {
  analyzeEvents,
  aggregateSignal,
  createSnapshot,
} from "./semantic-analyzer"
import { injectSemanticPrior, shouldUseSemanticSignal } from "./semantic-prior"

export class SemanticEngine {
  private config: SemanticConfig
  private keywords: Map<string, string[]> = new Map()
  private lastUpdate: Map<string, number> = new Map()
  private updatePromise: Map<string, Promise<SemanticSignal | null>> = new Map()

  constructor(config?: SemanticConfig) {
    this.config = config ?? loadSemanticConfig()
  }

  async fetchSemanticData(eventId: string): Promise<SemanticEvent[]> {
    if (!this.config.enabled) {
      return []
    }

    const keywords = this.keywords.get(eventId) ?? []
    const sources = getEnabledSources()

    if (sources.length === 0) {
      return []
    }

    const fetcher = getSemanticFetcher()
    const events = await fetcher.fetchAllSources(eventId, sources, keywords)

    const analyzed = analyzeEvents(events, keywords)

    return analyzed
  }

  analyzeSentiment(events: SemanticEvent[]): SemanticSignal {
    const keywords =
      events.length > 0 ? (this.keywords.get(events[0].eventId) ?? []) : []
    const analyzed = analyzeEvents(events, keywords)
    return aggregateSignal(analyzed)
  }

  computePriorAdjustment(signal: SemanticSignal, basePrior = 0.5): number {
    if (!shouldUseSemanticSignal(signal)) {
      return 0
    }

    return signal.priorAdjustment
  }

  async getSignal(eventId: string): Promise<SemanticSignal | null> {
    const cache = getSemanticCache()
    const cached = cache.getSignal(eventId)
    if (cached && shouldUseSemanticSignal(cached)) {
      return cached
    }

    const existingPromise = this.updatePromise.get(eventId)
    if (existingPromise) {
      return existingPromise
    }

    const promise = this.updateSignal(eventId)
    this.updatePromise.set(eventId, promise)

    try {
      const result = await promise
      return result
    } finally {
      this.updatePromise.delete(eventId)
    }
  }

  private async updateSignal(eventId: string): Promise<SemanticSignal | null> {
    const events = await this.fetchSemanticData(eventId)

    if (events.length === 0) {
      return null
    }

    const signal = this.analyzeSentiment(events)
    const cache = getSemanticCache()
    cache.setSignal(eventId, signal, this.config.signalTTLMs)

    this.lastUpdate.set(eventId, Date.now())

    return signal
  }

  injectPrior(
    bayesian: BayesianOutputEnhanced,
    signal: SemanticSignal | null
  ): BayesianOutputWithSemantic {
    return injectSemanticPrior(bayesian, signal)
  }

  setKeywords(eventId: string, keywords: string[]): void {
    this.keywords.set(eventId, keywords)
  }

  getKeywords(eventId: string): string[] {
    return this.keywords.get(eventId) ?? []
  }

  shouldUpdate(eventId: string): boolean {
    const last = this.lastUpdate.get(eventId)
    if (!last) return true

    const elapsed = Date.now() - last
    return elapsed > this.config.updateIntervalMs
  }

  getSnapshot(eventId: string): SemanticSnapshot | null {
    const events = getSemanticCache().getEvents(eventId)
    if (!events || events.length === 0) return null
    return createSnapshot(events)
  }

  isEnabled(): boolean {
    return this.config.enabled && isSemanticEnabled()
  }

  getConfig(): SemanticConfig {
    return this.config
  }

  updateConfig(config: SemanticConfig): void {
    this.config = config
  }

  clearCache(eventId?: string): void {
    const cache = getSemanticCache()
    if (eventId) {
      cache.clearEvent(eventId)
    } else {
      cache.clearAll()
    }
  }
}

let globalEngine: SemanticEngine | null = null

export function getSemanticEngine(): SemanticEngine {
  if (!globalEngine) {
    globalEngine = new SemanticEngine()
  }
  return globalEngine
}

export function resetSemanticEngine(): void {
  globalEngine = null
}

export async function fetchAndInjectSemantic(
  eventId: string,
  bayesian: BayesianOutputEnhanced
): Promise<BayesianOutputWithSemantic> {
  const engine = getSemanticEngine()

  if (!engine.isEnabled()) {
    return {
      ...bayesian,
      semanticAdjustment: 0,
      semanticSignal: undefined,
    }
  }

  const signal = await engine.getSignal(eventId)
  return engine.injectPrior(bayesian, signal)
}
