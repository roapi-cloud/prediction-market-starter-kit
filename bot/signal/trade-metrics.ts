import type { MarketEvent, TradeMetrics } from "../contracts/types"

export function computeTradeMetrics(
  trades: MarketEvent[],
  windowMs: number,
  largeTradeMultiplier = 3.0
): TradeMetrics {
  if (trades.length === 0) {
    return {
      largeTradeCount: 0,
      largeTradeVolume: 0,
      largeTradeDirection: "neutral",
      tradeFrequency: 0,
      avgTradeSize: 0,
    }
  }

  const tradeEvents = trades.filter((e) => e.type === "trade_print")
  if (tradeEvents.length === 0) {
    return {
      largeTradeCount: 0,
      largeTradeVolume: 0,
      largeTradeDirection: "neutral",
      tradeFrequency: 0,
      avgTradeSize: 0,
    }
  }

  const now = Math.max(...tradeEvents.map((e) => e.tsLocal))
  const windowStart = now - windowMs
  const recentTrades = tradeEvents.filter((e) => e.tsLocal >= windowStart)

  const volumes = recentTrades.map((e) => {
    const v = e.payload.volume
    return typeof v === "number" ? v : 0
  })

  const totalVolume = volumes.reduce((sum, v) => sum + v, 0)
  const avgTradeSize = volumes.length > 0 ? totalVolume / volumes.length : 0

  const tradeFrequency = volumes.length / (windowMs / 1000)

  const largeThreshold = avgTradeSize * largeTradeMultiplier
  let largeTradeCount = 0
  let largeTradeVolume = 0
  let largeBuyVolume = 0
  let largeSellVolume = 0

  for (const trade of recentTrades) {
    const vol =
      typeof trade.payload.volume === "number" ? trade.payload.volume : 0
    if (vol >= largeThreshold) {
      largeTradeCount++
      largeTradeVolume += vol

      const side = trade.payload.side
      if (side === "buy") {
        largeBuyVolume += vol
      } else if (side === "sell") {
        largeSellVolume += vol
      }
    }
  }

  let largeTradeDirection: "buy" | "sell" | "neutral" = "neutral"
  if (largeBuyVolume > largeSellVolume * 1.5) {
    largeTradeDirection = "buy"
  } else if (largeSellVolume > largeBuyVolume * 1.5) {
    largeTradeDirection = "sell"
  }

  return {
    largeTradeCount,
    largeTradeVolume,
    largeTradeDirection,
    tradeFrequency,
    avgTradeSize,
  }
}

export function isSparseTrading(
  tradeFrequency: number,
  threshold: number
): boolean {
  return tradeFrequency < threshold
}
