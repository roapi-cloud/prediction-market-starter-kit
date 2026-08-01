import type { TermStructureConfig, TermSpreadSnapshot, TermStructureSignal } from "../contracts/types"
import type { TermStructureCandidate, EventMarketGroup } from "./discovery"
import { computeTermSpread, generateTermOpportunity } from "../signal/term-structure"
import { createChildLogger } from "../lib/logger"

const log = createChildLogger("term-structure-configs")

/**
 * Term Structure Config Generator - creates configs from discovered markets with different expiries
 */

export type TermStructureConfigOptions = {
  termSpreadThreshold?: number
  maxHoldingBeforeExpiryMs?: number
  timeValueDecayRate?: number
  minExpiryDiffMs?: number
  maxConfigs?: number
}

const DEFAULT_OPTIONS: TermStructureConfigOptions = {
  termSpreadThreshold: 0.05,
  maxHoldingBeforeExpiryMs: 60000, // 1 minute before expiry
  timeValueDecayRate: 0.001,
  minExpiryDiffMs: 3600000, // Minimum 1 hour difference
  maxConfigs: 5,
}

/**
 * Generate TermStructureConfig array from discovered candidates
 */
export function generateTermStructureConfigs(
  candidates: TermStructureCandidate[],
  options: TermStructureConfigOptions = {}
): TermStructureConfig[] {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const configs: TermStructureConfig[] = []

  for (const candidate of candidates) {
    // Check minimum expiry difference
    if (candidate.expiryDiffMs < opts.minExpiryDiffMs!) {
      log.debug(
        { eventId: candidate.eventId, expiryDiffMs: candidate.expiryDiffMs },
        "Skipping due to insufficient expiry difference"
      )
      continue
    }

    if (configs.length >= opts.maxConfigs!) {
      break
    }

    const config: TermStructureConfig = {
      eventId: candidate.eventId,
      markets: candidate.markets,
      termSpreadThreshold: opts.termSpreadThreshold!,
      maxHoldingBeforeExpiryMs: opts.maxHoldingBeforeExpiryMs!,
      timeValueDecayRate: opts.timeValueDecayRate!,
    }

    configs.push(config)
  }

  log.info({ configCount: configs.length }, "Generated term_structure configs")
  return configs
}

/**
 * TermStructureEngine wrapper that uses discovered configs
 */
export class DynamicTermStructureEngine {
  private configs: TermStructureConfig[] = []
  private options: TermStructureConfigOptions

  constructor(options: TermStructureConfigOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  /**
   * Update configs from discovery result
   */
  updateConfigs(candidates: TermStructureCandidate[]): void {
    this.configs = generateTermStructureConfigs(candidates, this.options)
    log.info({ count: this.configs.length }, "Updated term_structure configs")
  }

  /**
   * Get current configs
   */
  getConfigs(): TermStructureConfig[] {
    return this.configs
  }

  /**
   * Add a manual config
   */
  addConfig(config: TermStructureConfig): void {
    this.configs.push(config)
  }

  /**
   * Remove a config by eventId
   */
  removeConfig(eventId: string): void {
    this.configs = this.configs.filter((c) => c.eventId !== eventId)
  }

  /**
   * Scan for opportunities using current configs
   */
  scan(marketPrices: Map<string, number>, now: number): TermStructureSignal[] {
    const signals: TermStructureSignal[] = []

    for (const config of this.configs) {
      const spread = computeTermSpread(config, marketPrices, now)
      if (!spread) continue

      const signal = generateTermOpportunity(spread, config)
      if (signal && signal.direction !== "neutral") {
        signals.push(signal)
      }
    }

    return signals
  }
}

/**
 * Create a default term structure engine with standard options
 */
export function createTermStructureEngine(
  options: TermStructureConfigOptions = {}
): DynamicTermStructureEngine {
  return new DynamicTermStructureEngine(options)
}