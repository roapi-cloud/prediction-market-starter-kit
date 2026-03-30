import type { BookMetrics } from "../contracts/types"
import type { BookState, DepthLevel } from "../ingest/orderbook"

function sumDepth(levels: DepthLevel[] | undefined, maxLevels: number): number {
  if (!levels || levels.length === 0) return 0
  return levels.slice(0, maxLevels).reduce((sum, l) => sum + l.size, 0)
}

export function computeImbalance(bidDepth: number, askDepth: number): number {
  const total = bidDepth + askDepth
  if (total === 0) return 0
  return (bidDepth - askDepth) / total
}

export function computeMicroPrice(
  bid: number,
  ask: number,
  bidDepth: number,
  askDepth: number
): number {
  const total = bidDepth + askDepth
  if (total === 0) return (bid + ask) / 2
  return (ask * bidDepth + bid * askDepth) / total
}

export function computeBookMetrics(
  book: BookState,
  prevBook?: BookState
): BookMetrics {
  const bidDepthL1 = book.yesBidDepth ?? book.yesBidLevels?.[0]?.size ?? 100
  const askDepthL1 = book.yesAskDepth ?? book.yesAskLevels?.[0]?.size ?? 100

  const bidDepthL5 = sumDepth(book.yesBidLevels, 5) || bidDepthL1 * 5
  const askDepthL5 = sumDepth(book.yesAskLevels, 5) || askDepthL1 * 5

  const bidDepthL10 = sumDepth(book.yesBidLevels, 10) || bidDepthL1 * 10
  const askDepthL10 = sumDepth(book.yesAskLevels, 10) || askDepthL1 * 10

  const imbalanceL1 = computeImbalance(bidDepthL1, askDepthL1)
  const imbalanceL5 = computeImbalance(bidDepthL5, askDepthL5)
  const imbalanceL10 = computeImbalance(bidDepthL10, askDepthL10)

  const microPrice = computeMicroPrice(
    book.yesBid,
    book.yesAsk,
    bidDepthL1,
    askDepthL1
  )
  const midPrice = (book.yesBid + book.yesAsk) / 2
  const microPriceDev = Math.abs(microPrice - midPrice)

  let queueConsumptionRate = 0
  if (prevBook && prevBook.lastUpdateTime && book.lastUpdateTime) {
    const dt = book.lastUpdateTime - prevBook.lastUpdateTime
    if (dt > 0) {
      const bidConsumed = (prevBook.yesBidDepth ?? 100) - bidDepthL1
      const askConsumed = (prevBook.yesAskDepth ?? 100) - askDepthL1
      queueConsumptionRate = (bidConsumed + askConsumed) / dt
    }
  }

  return {
    imbalanceL1,
    imbalanceL5,
    imbalanceL10,
    microPrice,
    microPriceDev,
    queueDepthBid: bidDepthL1,
    queueDepthAsk: askDepthL1,
    queueConsumptionRate,
  }
}

export function detectQueueCollapse(
  book: BookState,
  consumptionRate: number,
  thresholdMs: number
): boolean {
  if (consumptionRate <= 0) return false

  const bidDepth = book.yesBidDepth ?? 100
  const askDepth = book.yesAskDepth ?? 100
  const minDepth = Math.min(bidDepth, askDepth)

  const timeToEmpty = minDepth / consumptionRate
  return timeToEmpty < thresholdMs
}
