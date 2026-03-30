import type { BookState } from "../ingest/orderbook"

export type DepthAnalysis = {
  liquidityScore: number // 0-1, higher = more liquid
  recommendedSplit: number // number of batches
  avgFillPriceImpact: number // expected price impact per batch
}

export type OrderSplit = {
  size: number
  batch: number
  expectedFillRate: number
}

/**
 * Analyze order book depth to determine optimal order execution strategy.
 */
export function analyzeDepth(book: BookState, volume: number): DepthAnalysis {
  const spread = book.yesAsk - book.yesBid
  const avgSpread = spread

  // Estimate liquidity from spread and volume
  // Tight spread + high volume = high liquidity
  const spreadScore = Math.max(0, 1 - avgSpread * 10) // spread < 0.1 = good
  const volumeScore = Math.min(1, volume / 10000) // volume > 10000 = good
  const liquidityScore = (spreadScore + volumeScore) / 2

  // Recommended splits based on liquidity
  // Low liquidity = more splits, high liquidity = fewer splits
  const recommendedSplit =
    liquidityScore < 0.3
      ? 5
      : liquidityScore < 0.5
        ? 3
        : liquidityScore < 0.7
          ? 2
          : 1

  // Expected price impact
  const avgFillPriceImpact = avgSpread * (1 - liquidityScore) * 0.5

  return {
    liquidityScore,
    recommendedSplit,
    avgFillPriceImpact,
  }
}

/**
 * Split order size into multiple batches for better execution.
 */
export function splitOrderSize(
  totalSize: number,
  depth: DepthAnalysis
): OrderSplit[] {
  const splits: OrderSplit[] = []
  const batchSize = totalSize / depth.recommendedSplit

  for (let i = 0; i < depth.recommendedSplit; i++) {
    // Later batches have lower fill rate expectation
    const expectedFillRate = Math.max(0.1, 0.9 - i * 0.15)
    splits.push({
      size: batchSize,
      batch: i + 1,
      expectedFillRate,
    })
  }

  return splits
}

/**
 * Compute limit price based on order size and direction.
 * For BUY: slightly below ask to get better price
 * For SELL: slightly above bid
 */
export function computeLimitPrice(
  referencePrice: number,
  orderSize: number,
  direction: "BUY" | "SELL",
  config: { execution: { slippageBps: number } }
): number {
  // For limit orders, we aim for a better price than market
  // BUY: bid below ask, try to get filled at mid or better
  // SELL: ask above bid

  const limitOffset = config.execution.slippageBps / 20000 // half of slippage as limit offset

  if (direction === "BUY") {
    // Limit buy: slightly better than ask
    return Math.min(0.99, referencePrice * (1 - limitOffset))
  } else {
    // Limit sell: slightly better than bid
    return Math.max(0.01, referencePrice * (1 + limitOffset))
  }
}
