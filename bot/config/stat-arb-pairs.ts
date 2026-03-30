import type { StatArbConfig } from "../contracts/types"

export const DEFAULT_STAT_ARB_CONFIG: Omit<
  StatArbConfig,
  "pairId" | "marketA" | "marketB"
> = {
  hedgeRatio: 1.0,
  lookbackWindow: 100,
  entryZThreshold: 2.0,
  exitZThreshold: 0.5,
  maxHoldingMs: 300000,
  stopLossZThreshold: 3.0,
}

export function createStatArbPair(
  pairId: string,
  marketA: string,
  marketB: string,
  overrides?: Partial<StatArbConfig>
): StatArbConfig {
  return {
    ...DEFAULT_STAT_ARB_CONFIG,
    pairId,
    marketA,
    marketB,
    ...overrides,
  }
}

export const EXAMPLE_PAIRS: StatArbConfig[] = [
  createStatArbPair(
    "trump-win-2024",
    "market-trump-win-yes",
    "market-trump-lose-yes",
    { hedgeRatio: 1.0, lookbackWindow: 50 }
  ),
]

export class StatArbPairRegistry {
  private pairs: Map<string, StatArbConfig> = new Map()
  private marketToPairs: Map<string, string[]> = new Map()

  add(config: StatArbConfig): void {
    this.pairs.set(config.pairId, config)

    const marketAPairs = this.marketToPairs.get(config.marketA) ?? []
    if (!marketAPairs.includes(config.pairId)) {
      marketAPairs.push(config.pairId)
    }
    this.marketToPairs.set(config.marketA, marketAPairs)

    const marketBPairs = this.marketToPairs.get(config.marketB) ?? []
    if (!marketBPairs.includes(config.pairId)) {
      marketBPairs.push(config.pairId)
    }
    this.marketToPairs.set(config.marketB, marketBPairs)
  }

  get(pairId: string): StatArbConfig | undefined {
    return this.pairs.get(pairId)
  }

  getAll(): StatArbConfig[] {
    return Array.from(this.pairs.values())
  }

  getByMarket(marketId: string): StatArbConfig[] {
    const pairIds = this.marketToPairs.get(marketId) ?? []
    return pairIds.map((id) => this.pairs.get(id)!).filter(Boolean)
  }

  remove(pairId: string): void {
    const config = this.pairs.get(pairId)
    if (!config) return

    this.pairs.delete(pairId)

    const marketAPairs = this.marketToPairs.get(config.marketA)
    if (marketAPairs) {
      const index = marketAPairs.indexOf(pairId)
      if (index >= 0) marketAPairs.splice(index, 1)
    }

    const marketBPairs = this.marketToPairs.get(config.marketB)
    if (marketBPairs) {
      const index = marketBPairs.indexOf(pairId)
      if (index >= 0) marketBPairs.splice(index, 1)
    }
  }

  clear(): void {
    this.pairs.clear()
    this.marketToPairs.clear()
  }
}
