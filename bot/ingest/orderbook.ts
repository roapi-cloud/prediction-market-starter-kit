import type { MarketEvent } from "../contracts/types"

export type DepthLevel = {
  price: number
  size: number
}

export type BookState = {
  yesBid: number
  yesAsk: number
  noBid: number
  noAsk: number
  yesBidDepth?: number
  yesAskDepth?: number
  noBidDepth?: number
  noAskDepth?: number
  yesBidLevels?: DepthLevel[]
  yesAskLevels?: DepthLevel[]
  noBidLevels?: DepthLevel[]
  noAskLevels?: DepthLevel[]
  lastUpdateTime?: number
}

const DEFAULT_BOOK: BookState = {
  yesBid: 0.49,
  yesAsk: 0.5,
  noBid: 0.49,
  noAsk: 0.5,
}

export function applyBookEvent(
  current: BookState,
  event: MarketEvent
): BookState {
  if (event.type !== "book_update") return current
  const payload = event.payload
  return {
    yesBid:
      typeof payload.yesBid === "number" ? payload.yesBid : current.yesBid,
    yesAsk:
      typeof payload.yesAsk === "number" ? payload.yesAsk : current.yesAsk,
    noBid: typeof payload.noBid === "number" ? payload.noBid : current.noBid,
    noAsk: typeof payload.noAsk === "number" ? payload.noAsk : current.noAsk,
    yesBidDepth:
      typeof payload.yesBidDepth === "number"
        ? payload.yesBidDepth
        : current.yesBidDepth,
    yesAskDepth:
      typeof payload.yesAskDepth === "number"
        ? payload.yesAskDepth
        : current.yesAskDepth,
    noBidDepth:
      typeof payload.noBidDepth === "number"
        ? payload.noBidDepth
        : current.noBidDepth,
    noAskDepth:
      typeof payload.noAskDepth === "number"
        ? payload.noAskDepth
        : current.noAskDepth,
    yesBidLevels: Array.isArray(payload.yesBidLevels)
      ? (payload.yesBidLevels as DepthLevel[])
      : current.yesBidLevels,
    yesAskLevels: Array.isArray(payload.yesAskLevels)
      ? (payload.yesAskLevels as DepthLevel[])
      : current.yesAskLevels,
    noBidLevels: Array.isArray(payload.noBidLevels)
      ? (payload.noBidLevels as DepthLevel[])
      : current.noBidLevels,
    noAskLevels: Array.isArray(payload.noAskLevels)
      ? (payload.noAskLevels as DepthLevel[])
      : current.noAskLevels,
    lastUpdateTime: event.tsLocal,
  }
}

export function getDefaultBookState(): BookState {
  return { ...DEFAULT_BOOK }
}
