import type { StatArbConfig, StatArbSignal } from "../contracts/types"
import type { StatArbCandidate, EventMarketGroup } from "./discovery"
import { SpreadHistory } from "../data/spread-history"
import { createChildLogger } from "../lib/logger"

const log = createChildLogger("stat-arb-pairs")

/**
 * Stat Arb Pair Generator - creates StatArbConfig from discovered market pairs
 */

export type StatArbPairConfigOptions = {
  lookbackWindow?: number
  entryZThreshold?: number
  exitZThreshold?: number
  maxHoldingMs?: number
  stopLossZThreshold?: number
  minVolume24hr?: number
  maxPairsPerEvent?: number
}

const DEFAULT_OPTIONS: StatArbPairConfigOptions = {
  lookbackWindow: 50,
  entryZThreshold: 2.0,
  exitZThreshold: 0.5,
  maxHoldingMs: 3600000, // 1 hour
  stopLossZThreshold: 4.0,
  minVolume24hr: 10000, // Minimum $10k 24hr volume
  maxPairsPerEvent: 3, // Limit pairs per event to avoid over-exposure
}

/**
 * Generate StatArbConfig array from discovered candidates
 */
export function generateStatArbConfigs(
  candidates: StatArbCandidate[],
  groups: EventMarketGroup[],
  options: StatArbPairConfigOptions = {}
): StatArbConfig[] {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const configs: StatArbConfig[] = []
  const pairsPerEvent = new Map<string, number>()

  // Build volume map for filtering
  const volumeMap = new Map<string, number>()
  for (const group of groups) {
    for (const market of group.markets) {
      volumeMap.set(market.marketId, market.volume24hr)
    }
  }

  for (const candidate of candidates) {
    // Check volume threshold
    const volumeA = volumeMap.get(candidate.marketA) || 0
    const volumeB = volumeMap.get(candidate.marketB) || 0

    if (volumeA < opts.minVolume24hr! || volumeB < opts.minVolume24hr!) {
      log.debug(
        { marketA: candidate.marketA, volumeA, marketB: candidate.marketB, volumeB },
        "Skipping pair due to low volume"
      )
      continue
    }

    // Limit pairs per event
    const currentPairs = pairsPerEvent.get(candidate.eventId) || 0
    if (currentPairs >= opts.maxPairsPerEvent!) {
      continue
    }

    const config: StatArbConfig = {
      pairId: `${candidate.eventId}-${candidate.marketA}-${candidate.marketB}`,
      marketA: candidate.marketA,
      marketB: candidate.marketB,
      hedgeRatio: calculateHedgeRatio(candidate),
      lookbackWindow: opts.lookbackWindow!,
      entryZThreshold: opts.entryZThreshold!,
      exitZThreshold: opts.exitZThreshold!,
      maxHoldingMs: opts.maxHoldingMs!,
      stopLossZThreshold: opts.stopLossZThreshold!,
    }

    configs.push(config)
    pairsPerEvent.set(candidate.eventId, currentPairs + 1)
  }

  log.info({ configCount: configs.length }, "Generated stat_arb configs")
  return configs
}

/**
 * Calculate hedge ratio based on correlation type and market prices
 */
function calculateHedgeRatio(candidate: StatArbCandidate): number {
  switch (candidate.correlationType) {
    case "inverse":
      // For mutually exclusive outcomes (e.g., World Cup winner)
      // If Brazil wins, France cannot win - prices move inversely
      return -1.0

    case "parallel":
      // For correlated outcomes (e.g., S&P 500 above 6000 and above 6500)
      // If S&P goes up, both probabilities increase
      return 1.0

    default:
      // Unknown correlation - use 1.0 as default
      // Will be calibrated by spread history over time
      return 1.0
  }
}

/**
 * StatArbEngine wrapper that uses discovered configs
 */
export class DynamicStatArbEngine {
  private configs: StatArbConfig[] = []
  private history: SpreadHistory
  private options: StatArbPairConfigOptions

  constructor(options: StatArbPairConfigOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
    this.history = new SpreadHistory(1000)
  }

  /**
   * Update configs from discovery result
   */
  updateConfigs(
    candidates: StatArbCandidate[],
    groups: EventMarketGroup[]
  ): void {
    this.configs = generateStatArbConfigs(candidates, groups, this.options)
    log.info({ count: this.configs.length }, "Updated stat_arb configs")
  }

  /**
   * Get current configs
   */
  getConfigs(): StatArbConfig[] {
    return this.configs
  }

  /**
   * Get spread history
   */
  getHistory(): SpreadHistory {
    return this.history
  }

  /**
   * Add a manual config
   */
  addConfig(config: StatArbConfig): void {
    this.configs.push(config)
  }

  /**
   * Remove a config by pairId
   */
  removeConfig(pairId: string): void {
    this.configs = this.configs.filter((c) => c.pairId !== pairId)
  }
}

/**
 * Create a default stat arb engine with standard options
 */
export function createStatArbEngine(
  options: StatArbPairConfigOptions = {}
): DynamicStatArbEngine {
  return new DynamicStatArbEngine(options)
}