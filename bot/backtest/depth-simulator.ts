import type {
  BookSnapshot,
  DepthSimulatorConfig,
  BookDepthLevel,
} from "../contracts/types"

export class DepthSimulator {
  private config: DepthSimulatorConfig
  private currentDepths: Map<string, BookSnapshot> = new Map()

  constructor(config: DepthSimulatorConfig) {
    this.config = {
      levels: config.levels ?? 5,
      tickSize: config.tickSize ?? 0.01,
      minSpread: config.minSpread ?? 0.02,
      liquidityDecayRate: config.liquidityDecayRate ?? 0.5,
    }
  }

  simulateDepth(
    basePrice: number,
    volatility: number,
    marketId: string
  ): BookSnapshot {
    const spread = Math.max(this.config.minSpread, volatility * 2)
    const midPrice = basePrice

    const bids: Array<{ price: number; size: number }> = []
    const asks: Array<{ price: number; size: number }> = []

    let cumulativeBidSize = 0
    let cumulativeAskSize = 0

    for (let i = 0; i < this.config.levels; i++) {
      const bidPrice = Math.max(
        0.01,
        midPrice - spread / 2 - i * this.config.tickSize
      )
      const askPrice = Math.min(
        0.99,
        midPrice + spread / 2 + i * this.config.tickSize
      )

      const baseLiquidity = 1000 / (1 + i * this.config.liquidityDecayRate)
      const liquidityNoise = Math.random() * 0.3 - 0.15

      const bidSize = Math.max(1, baseLiquidity * (1 + liquidityNoise))
      const askSize = Math.max(1, baseLiquidity * (1 - liquidityNoise))

      cumulativeBidSize += bidSize
      cumulativeAskSize += askSize

      bids.push({ price: bidPrice, size: bidSize })
      asks.push({ price: askPrice, size: askSize })
    }

    const snapshot: BookSnapshot = {
      ts: Date.now(),
      marketId,
      bids,
      asks,
    }

    this.currentDepths.set(marketId, snapshot)
    return snapshot
  }

  updateDepth(
    marketId: string,
    trade: { side: "buy" | "sell"; size: number; price: number }
  ): BookSnapshot | null {
    const current = this.currentDepths.get(marketId)
    if (!current) return null

    const levels = trade.side === "buy" ? current.asks : current.bids

    let remainingSize = trade.size
    const updatedLevels: Array<{ price: number; size: number }> = []

    for (const level of levels) {
      if (remainingSize <= 0) {
        updatedLevels.push(level)
        continue
      }

      if (trade.side === "buy" && level.price <= trade.price) {
        const consumed = Math.min(level.size, remainingSize)
        const newSize = level.size - consumed
        if (newSize > 0) {
          updatedLevels.push({ price: level.price, size: newSize })
        }
        remainingSize -= consumed
      } else if (trade.side === "sell" && level.price >= trade.price) {
        const consumed = Math.min(level.size, remainingSize)
        const newSize = level.size - consumed
        if (newSize > 0) {
          updatedLevels.push({ price: level.price, size: newSize })
        }
        remainingSize -= consumed
      } else {
        updatedLevels.push(level)
      }
    }

    const updated: BookSnapshot = {
      ...current,
      ts: Date.now(),
      bids: trade.side === "sell" ? updatedLevels : current.bids,
      asks: trade.side === "buy" ? updatedLevels : current.asks,
    }

    this.currentDepths.set(marketId, updated)
    return updated
  }

  simulateLiquidityDisappearance(
    marketId: string,
    severity: number
  ): BookSnapshot | null {
    const current = this.currentDepths.get(marketId)
    if (!current) return null

    const factor = 1 - severity

    const updated: BookSnapshot = {
      ...current,
      ts: Date.now(),
      bids: current.bids.map((l) => ({
        ...l,
        size: Math.max(1, l.size * factor),
      })),
      asks: current.asks.map((l) => ({
        ...l,
        size: Math.max(1, l.size * factor),
      })),
    }

    this.currentDepths.set(marketId, updated)
    return updated
  }

  getDepthImpact(orderSize: number, marketId: string): number {
    const current = this.currentDepths.get(marketId)
    if (!current) return 0

    const totalBidDepth = current.bids.reduce((a, l) => a + l.size, 0)
    const totalAskDepth = current.asks.reduce((a, l) => a + l.size, 0)
    const avgDepth = (totalBidDepth + totalAskDepth) / 2

    const impactRatio = orderSize / avgDepth
    return Math.min(1, impactRatio) * 10
  }

  getBookSnapshot(marketId: string): BookSnapshot | undefined {
    return this.currentDepths.get(marketId)
  }

  calculateDepthMetrics(marketId: string): {
    bidDepth: number
    askDepth: number
    imbalance: number
    spread: number
    avgLevelSize: number
  } {
    const current = this.currentDepths.get(marketId)
    if (!current) {
      return {
        bidDepth: 0,
        askDepth: 0,
        imbalance: 0,
        spread: 0,
        avgLevelSize: 0,
      }
    }

    const bidDepth = current.bids.reduce((a, l) => a + l.size, 0)
    const askDepth = current.asks.reduce((a, l) => a + l.size, 0)
    const imbalance = (bidDepth - askDepth) / (bidDepth + askDepth)
    const spread = (current.asks[0]?.price ?? 0) - (current.bids[0]?.price ?? 0)
    const avgLevelSize =
      (bidDepth + askDepth) / (current.bids.length + current.asks.length)

    return { bidDepth, askDepth, imbalance, spread, avgLevelSize }
  }

  clearDepths(): void {
    this.currentDepths.clear()
  }
}

export function createDefaultDepthConfig(): DepthSimulatorConfig {
  return {
    levels: 5,
    tickSize: 0.01,
    minSpread: 0.02,
    liquidityDecayRate: 0.5,
  }
}
