import type { BookState } from "../ingest/orderbook"

export type QueueState = {
  position: number
  totalSize: number
  aheadSize: number
  behindSize: number
  estimatedFillTimeMs: number
}

export type TradeRateEstimate = {
  buyRate: number
  sellRate: number
  lastUpdate: number
  samples: number
}

export function simulateQueuePosition(
  price: number,
  side: "buy" | "sell",
  book: BookState,
  orderSize: number
): QueueState {
  const isBuy = side === "buy"
  const bestPrice = isBuy ? book.yesAsk : book.yesBid

  if (isBuy) {
    if (price < bestPrice) {
      return {
        position: -1,
        totalSize: orderSize,
        aheadSize: Infinity,
        behindSize: 0,
        estimatedFillTimeMs: Infinity,
      }
    }

    const atBestLevel = Math.abs(price - bestPrice) < 0.001
    if (!atBestLevel) {
      return {
        position: 0,
        totalSize: orderSize,
        aheadSize: 0,
        behindSize: 0,
        estimatedFillTimeMs: 0,
      }
    }

    const queueAhead = estimateQueueDepth(bestPrice, "ask", book)
    return {
      position: queueAhead / Math.max(1, orderSize),
      totalSize: orderSize,
      aheadSize: queueAhead,
      behindSize: 0,
      estimatedFillTimeMs: Infinity,
    }
  } else {
    if (price > bestPrice) {
      return {
        position: -1,
        totalSize: orderSize,
        aheadSize: Infinity,
        behindSize: 0,
        estimatedFillTimeMs: Infinity,
      }
    }

    const atBestLevel = Math.abs(price - bestPrice) < 0.001
    if (!atBestLevel) {
      return {
        position: 0,
        totalSize: orderSize,
        aheadSize: 0,
        behindSize: 0,
        estimatedFillTimeMs: 0,
      }
    }

    const queueAhead = estimateQueueDepth(bestPrice, "bid", book)
    return {
      position: queueAhead / Math.max(1, orderSize),
      totalSize: orderSize,
      aheadSize: queueAhead,
      behindSize: 0,
      estimatedFillTimeMs: Infinity,
    }
  }
}

export function estimateQueueDepth(
  price: number,
  side: "bid" | "ask",
  book: BookState
): number {
  const spread = book.yesAsk - book.yesBid
  const midPrice = (book.yesBid + book.yesAsk) / 2
  const depth = spread * 1000

  if (side === "bid") {
    const distanceFromMid = midPrice - price
    if (distanceFromMid > spread * 0.5) {
      return depth * 0.5
    }
    return depth * (1 - distanceFromMid / spread)
  } else {
    const distanceFromMid = price - midPrice
    if (distanceFromMid > spread * 0.5) {
      return depth * 0.5
    }
    return depth * (1 - distanceFromMid / spread)
  }
}

export function estimateFillTime(
  queuePos: number,
  tradeRate: number,
  orderSize: number
): number {
  if (queuePos <= 0) return 0
  if (tradeRate <= 0) return Infinity

  const sizeAhead = queuePos * orderSize
  return (sizeAhead / tradeRate) * 1000
}

export function calculateQueueImpact(
  _orderSize: number,
  queueAhead: number,
  avgTradeSize: number
): number {
  const tradesAhead = Math.ceil(queueAhead / Math.max(1, avgTradeSize))
  return tradesAhead * 0.1
}

export type QueueTracker = {
  orders: Map<string, QueueState>
  tradeRates: Map<string, TradeRateEstimate>
  updates: number
}

export function createQueueTracker(): QueueTracker {
  return {
    orders: new Map(),
    tradeRates: new Map(),
    updates: 0,
  }
}

export function updateQueuePosition(
  tracker: QueueTracker,
  orderId: string,
  state: QueueState
): QueueTracker {
  const newOrders = new Map(tracker.orders)
  newOrders.set(orderId, state)
  return {
    ...tracker,
    orders: newOrders,
    updates: tracker.updates + 1,
  }
}

export function updateTradeRate(
  tracker: QueueTracker,
  marketId: string,
  tradeSize: number,
  side: "buy" | "sell",
  ts: number
): QueueTracker {
  const existing = tracker.tradeRates.get(marketId)
  const windowMs = 60000

  if (!existing) {
    const rate = tradeSize / (windowMs / 1000)
    const newRates = new Map(tracker.tradeRates)
    newRates.set(marketId, {
      buyRate: side === "buy" ? rate : 0,
      sellRate: side === "sell" ? rate : 0,
      lastUpdate: ts,
      samples: 1,
    })
    return { ...tracker, tradeRates: newRates }
  }

  const elapsed = (ts - existing.lastUpdate) / 1000
  const decay = Math.exp(-elapsed / 60)
  const alpha = 0.1

  const newRates = new Map(tracker.tradeRates)
  newRates.set(marketId, {
    buyRate:
      side === "buy"
        ? existing.buyRate * decay * (1 - alpha) + (tradeSize / elapsed) * alpha
        : existing.buyRate * decay,
    sellRate:
      side === "sell"
        ? existing.sellRate * decay * (1 - alpha) +
          (tradeSize / elapsed) * alpha
        : existing.sellRate * decay,
    lastUpdate: ts,
    samples: existing.samples + 1,
  })

  return { ...tracker, tradeRates: newRates }
}

export function getEstimatedFillTime(
  tracker: QueueTracker,
  marketId: string,
  orderId: string
): number {
  const queueState = tracker.orders.get(orderId)
  const tradeRate = tracker.tradeRates.get(marketId)

  if (!queueState) return Infinity

  const rate = tradeRate
    ? queueState.totalSize > 0
      ? tradeRate.buyRate
      : tradeRate.sellRate
    : 0

  return estimateFillTime(queueState.position, rate, queueState.totalSize)
}

export function shouldAdjustPrice(
  currentState: QueueState,
  targetFillTimeMs: number,
  maxAdjustmentBps: number
): { adjust: boolean; adjustmentBps: number } {
  if (currentState.estimatedFillTimeMs <= targetFillTimeMs) {
    return { adjust: false, adjustmentBps: 0 }
  }

  const ratio = currentState.estimatedFillTimeMs / targetFillTimeMs
  const adjustmentBps = Math.min(maxAdjustmentBps, Math.floor(ratio * 10))

  return { adjust: adjustmentBps > 0, adjustmentBps }
}

export function simulateQueueCancellation(
  queueAhead: number,
  cancelledSize: number,
  ourPosition: number
): number {
  if (cancelledSize >= ourPosition) {
    return Math.max(0, queueAhead - cancelledSize)
  }
  return queueAhead
}
