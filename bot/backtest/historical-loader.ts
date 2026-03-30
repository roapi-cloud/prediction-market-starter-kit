import type {
  HistoricalData,
  HistoricalTick,
  BookSnapshot,
  HistoricalTrade,
} from "../contracts/types"
import { createReadStream } from "fs"
import { createInterface } from "readline"

export class HistoricalLoader {
  private dataPath: string

  constructor(dataPath: string) {
    this.dataPath = dataPath
  }

  async loadHistoricalData(): Promise<HistoricalData> {
    const ticks = await this.loadTicks()
    const snapshots = await this.loadSnapshots()
    const trades = await this.loadTrades()

    return { ticks, snapshots, trades }
  }

  private async loadTicks(): Promise<HistoricalTick[]> {
    const path = `${this.dataPath}/ticks.json`
    return this.loadJsonLines<HistoricalTick>(path)
  }

  private async loadSnapshots(): Promise<BookSnapshot[]> {
    const path = `${this.dataPath}/snapshots.json`
    return this.loadJsonLines<BookSnapshot>(path)
  }

  private async loadTrades(): Promise<HistoricalTrade[]> {
    const path = `${this.dataPath}/trades.json`
    return this.loadJsonLines<HistoricalTrade>(path)
  }

  private async loadJsonLines<T>(path: string): Promise<T[]> {
    const items: T[] = []

    try {
      const stream = createReadStream(path)
      const rl = createInterface({ input: stream, crlfDelay: Infinity })

      for await (const line of rl) {
        if (line.trim()) {
          items.push(JSON.parse(line) as T)
        }
      }
    } catch {
      return []
    }

    return items
  }

  async loadTicksInWindow(
    startTs: number,
    endTs: number
  ): Promise<HistoricalTick[]> {
    const ticks = await this.loadTicks()
    return ticks.filter((t) => t.ts >= startTs && t.ts <= endTs)
  }

  async loadSnapshotsInWindow(
    startTs: number,
    endTs: number
  ): Promise<BookSnapshot[]> {
    const snapshots = await this.loadSnapshots()
    return snapshots.filter((s) => s.ts >= startTs && s.ts <= endTs)
  }

  async streamTicks(callback: (tick: HistoricalTick) => void): Promise<void> {
    const path = `${this.dataPath}/ticks.json`

    try {
      const stream = createReadStream(path)
      const rl = createInterface({ input: stream, crlfDelay: Infinity })

      for await (const line of rl) {
        if (line.trim()) {
          const tick = JSON.parse(line) as HistoricalTick
          callback(tick)
        }
      }
    } catch {
      throw new Error(`Failed to stream ticks from ${path}`)
    }
  }

  getAvailableDataRange(): { start: number; end: number } {
    return { start: 0, end: 0 }
  }

  async getMarketList(): Promise<string[]> {
    const ticks = await this.loadTicks()
    const markets = new Set(ticks.map((t) => t.marketId))
    return Array.from(markets)
  }
}

export function createSyntheticData(
  count: number,
  marketId: string = "test-market"
): HistoricalData {
  const ticks: HistoricalTick[] = []
  const snapshots: BookSnapshot[] = []
  const trades: HistoricalTrade[] = []

  const baseTime = Date.now()

  for (let i = 0; i < count; i++) {
    const ts = baseTime + i * 1000
    const priceBase = 0.5 + (Math.random() - 0.5) * 0.1

    // Create arbitrage opportunities 30% of the time
    const hasArbOpportunity = Math.random() < 0.3
    let spreadMultiplier = hasArbOpportunity ? -0.02 : 0.01 // Negative spread for arb

    const yesAsk = Math.min(0.99, Math.max(0.01, priceBase + spreadMultiplier))
    const noAsk = Math.min(
      0.99,
      Math.max(0.01, 1 - priceBase + spreadMultiplier)
    )

    ticks.push({
      ts,
      marketId,
      yesBid: Math.max(0.01, yesAsk - 0.02),
      yesAsk,
      noBid: Math.max(0.01, noAsk - 0.02),
      noAsk,
      volume: Math.random() * 100,
    })

    snapshots.push({
      ts,
      marketId,
      bids: [
        { price: priceBase - 0.01, size: 100 },
        { price: priceBase - 0.02, size: 200 },
        { price: priceBase - 0.03, size: 150 },
      ],
      asks: [
        { price: priceBase + 0.01, size: 100 },
        { price: priceBase + 0.02, size: 200 },
        { price: priceBase + 0.03, size: 150 },
      ],
    })

    if (Math.random() > 0.7) {
      trades.push({
        ts,
        marketId,
        side: Math.random() > 0.5 ? "buy" : "sell",
        price: priceBase + (Math.random() > 0.5 ? 0.01 : -0.01),
        size: Math.random() * 50,
      })
    }
  }

  return { ticks, snapshots, trades }
}

export function validateHistoricalData(data: HistoricalData): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []

  if (data.ticks.length === 0) {
    errors.push("No tick data found")
  }

  for (const tick of data.ticks) {
    if (tick.yesBid < 0 || tick.yesBid > 1) {
      errors.push(`Invalid yesBid at ts ${tick.ts}: ${tick.yesBid}`)
    }
    if (tick.yesAsk < tick.yesBid) {
      errors.push(`Invalid spread at ts ${tick.ts}: yesAsk < yesBid`)
    }
  }

  for (const snapshot of data.snapshots) {
    if (snapshot.bids.length === 0 || snapshot.asks.length === 0) {
      errors.push(`Empty snapshot at ts ${snapshot.ts}`)
    }
  }

  return { valid: errors.length === 0, errors }
}

export function aggregateTicksByInterval(
  ticks: HistoricalTick[],
  intervalMs: number
): Array<{ ts: number; avgPrice: number; volume: number; tickCount: number }> {
  if (ticks.length === 0) return []

  const aggregated: Map<
    number,
    { prices: number[]; volume: number; count: number }
  > = new Map()

  for (const tick of ticks) {
    const intervalStart = Math.floor(tick.ts / intervalMs) * intervalMs
    const existing = aggregated.get(intervalStart)

    if (existing) {
      existing.prices.push((tick.yesBid + tick.yesAsk) / 2)
      existing.volume += tick.volume
      existing.count += 1
    } else {
      aggregated.set(intervalStart, {
        prices: [(tick.yesBid + tick.yesAsk) / 2],
        volume: tick.volume,
        count: 1,
      })
    }
  }

  return Array.from(aggregated.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([ts, data]) => ({
      ts,
      avgPrice: data.prices.reduce((a, b) => a + b, 0) / data.prices.length,
      volume: data.volume,
      tickCount: data.count,
    }))
}
