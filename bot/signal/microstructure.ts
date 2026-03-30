import type {
  BookMetrics,
  TradeMetrics,
  MicrostructureConfig,
  MicrostructureSignal,
  Opportunity,
  MarketEvent,
} from "../contracts/types"
import type { BookState } from "../ingest/orderbook"
import { computeBookMetrics, detectQueueCollapse } from "./book-metrics"
import { computeTradeMetrics, isSparseTrading } from "./trade-metrics"
import {
  DEFAULT_MICROSTRUCTURE_CONFIG,
  SIGNAL_WEIGHTS,
  MIN_COMBINED_SCORE,
  MIN_EV_BPS,
  DEFAULT_TTL_MS,
} from "../config/microstructure-config"

export { computeBookMetrics } from "./book-metrics"
export { computeTradeMetrics } from "./trade-metrics"

export function detectMicrostructureOpportunity(
  bookMetrics: BookMetrics,
  tradeMetrics: TradeMetrics,
  config: MicrostructureConfig = DEFAULT_MICROSTRUCTURE_CONFIG
): MicrostructureSignal | null {
  const imbalance =
    Math.abs(bookMetrics.imbalanceL1) >= config.imbalanceThreshold
  const microPriceDev =
    bookMetrics.microPriceDev >= config.microPriceDevThreshold
  const largeTrade = tradeMetrics.largeTradeCount > 0
  const queueCollapse = detectQueueCollapse(
    {
      yesBidDepth: bookMetrics.queueDepthBid,
      yesAskDepth: bookMetrics.queueDepthAsk,
    } as BookState,
    bookMetrics.queueConsumptionRate,
    config.queueCollapseWindowMs
  )
  const sparseTrade = isSparseTrading(
    tradeMetrics.tradeFrequency,
    config.sparseTradeThreshold
  )

  const signals = {
    imbalance,
    microPriceDev,
    largeTrade,
    queueCollapse,
    sparseTrade,
  }

  const score =
    (imbalance ? SIGNAL_WEIGHTS.imbalance : 0) +
    (microPriceDev ? SIGNAL_WEIGHTS.microPriceDev : 0) +
    (largeTrade ? SIGNAL_WEIGHTS.largeTrade : 0) +
    (queueCollapse ? SIGNAL_WEIGHTS.queueCollapse : 0) +
    (sparseTrade ? SIGNAL_WEIGHTS.sparseTrade : 0)

  if (score < MIN_COMBINED_SCORE) {
    return null
  }

  let direction: "buy" | "sell" | "neutral" = "neutral"
  if (
    bookMetrics.imbalanceL1 > 0.3 ||
    tradeMetrics.largeTradeDirection === "buy"
  ) {
    direction = "buy"
  } else if (
    bookMetrics.imbalanceL1 < -0.3 ||
    tradeMetrics.largeTradeDirection === "sell"
  ) {
    direction = "sell"
  }

  const evBps = score * 10

  if (evBps < MIN_EV_BPS) {
    return null
  }

  return {
    marketId: "",
    ts: Date.now(),
    signals,
    combinedScore: score,
    evBps,
    direction,
    confidence: Math.min(1, score),
  }
}

export function generateMicrostructureOpportunity(
  book: BookState,
  trades: MarketEvent[],
  marketId: string,
  now: number,
  config: MicrostructureConfig = DEFAULT_MICROSTRUCTURE_CONFIG,
  prevBook?: BookState
): Opportunity | null {
  const bookMetrics = computeBookMetrics(book, prevBook)
  const tradeMetrics = computeTradeMetrics(
    trades,
    5000,
    config.largeTradeMultiplier
  )

  const signal = detectMicrostructureOpportunity(
    bookMetrics,
    tradeMetrics,
    config
  )
  if (!signal) return null

  return {
    id: `${marketId}-microstructure-${now}`,
    strategy: "microstructure",
    marketIds: [marketId],
    evBps: signal.evBps,
    confidence: signal.confidence,
    ttlMs: DEFAULT_TTL_MS,
    createdAt: now,
  }
}
