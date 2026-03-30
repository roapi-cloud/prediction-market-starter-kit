import type { SpreadHistoryEntry } from "../contracts/types"

export class SpreadHistory {
  private history: Map<string, SpreadHistoryEntry[]> = new Map()
  private maxWindowSize: number

  constructor(maxWindowSize = 1000) {
    this.maxWindowSize = maxWindowSize
  }

  add(
    pairId: string,
    ts: number,
    priceA: number,
    priceB: number,
    hedgeRatio: number
  ): void {
    const spread = priceA - hedgeRatio * priceB
    const entry: SpreadHistoryEntry = { ts, priceA, priceB, spread }

    if (!this.history.has(pairId)) {
      this.history.set(pairId, [])
    }

    const entries = this.history.get(pairId)!
    entries.push(entry)

    if (entries.length > this.maxWindowSize) {
      entries.shift()
    }
  }

  get(pairId: string): SpreadHistoryEntry[] {
    return this.history.get(pairId) ?? []
  }

  getLatest(pairId: string, windowSize: number): SpreadHistoryEntry[] {
    const entries = this.history.get(pairId) ?? []
    return entries.slice(-windowSize)
  }

  getSpreadValues(pairId: string, windowSize: number): number[] {
    return this.getLatest(pairId, windowSize).map((e) => e.spread)
  }

  clear(pairId?: string): void {
    if (pairId) {
      this.history.delete(pairId)
    } else {
      this.history.clear()
    }
  }

  size(pairId: string): number {
    return this.history.get(pairId)?.length ?? 0
  }

  estimateHalfLife(spreads: number[]): number | undefined {
    if (spreads.length < 10) return undefined

    const deltas: number[] = []
    for (let i = 1; i < spreads.length; i++) {
      deltas.push(spreads[i] - spreads[i - 1])
    }

    const laggedSpreads = spreads.slice(0, -1)
    let sumXY = 0
    let sumXX = 0
    const meanLagged =
      laggedSpreads.reduce((a, b) => a + b, 0) / laggedSpreads.length
    const meanDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length

    for (let i = 0; i < deltas.length; i++) {
      sumXY += (laggedSpreads[i] - meanLagged) * (deltas[i] - meanDelta)
      sumXX += (laggedSpreads[i] - meanLagged) ** 2
    }

    if (sumXX === 0) return undefined

    const beta = sumXY / sumXX

    if (beta >= 0) return undefined

    return -Math.log(2) / beta
  }
}
