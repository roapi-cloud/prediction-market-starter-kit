import type {
  Leg,
  OrderIntent,
  OrderAction,
  ExecutionState,
  TwoLegExecutionConfig,
} from "../contracts/types"
import type { BookState } from "../ingest/orderbook"

export type HedgeRequest = {
  legIndex: number
  marketId: string
  side: "buy" | "sell"
  targetSize: number
  maxSlippageBps: number
  urgency: "low" | "medium" | "high" | "critical"
  targetPrice?: number
}

export type HedgeResult = {
  success: boolean
  filledSize: number
  avgPrice: number
  slippageBps: number
  attemptsUsed: number
  reason: string
}

export type HedgeState = {
  pendingHedges: Map<string, HedgeRequest>
  completedHedges: Map<string, HedgeResult>
  failedHedges: Map<string, HedgeResult>
  attemptCount: number
}

export function createHedgeState(): HedgeState {
  return {
    pendingHedges: new Map(),
    completedHedges: new Map(),
    failedHedges: new Map(),
    attemptCount: 0,
  }
}

export function createHedgeRequest(
  leg: Leg,
  legIndex: number,
  filledLeg: Leg,
  config: TwoLegExecutionConfig
): HedgeRequest {
  const hedgeSize = filledLeg.filledSize - leg.filledSize
  const urgency = hedgeSize > filledLeg.targetSize * 0.8 ? "critical" : "high"

  return {
    legIndex,
    marketId: leg.marketId,
    side: leg.side === "buy" ? "sell" : "buy",
    targetSize: hedgeSize,
    maxSlippageBps: config.maxSlippageBps,
    urgency,
    targetPrice: leg.targetPrice,
  }
}

export function calculateHedgePrice(
  request: HedgeRequest,
  book: BookState,
  maxSlippageBps: number,
  attemptNumber: number
): number {
  const slippageMultiplier = 1 + attemptNumber * 0.5
  const effectiveSlippageBps = Math.min(
    maxSlippageBps * slippageMultiplier,
    maxSlippageBps * 2
  )

  const slippageFactor = effectiveSlippageBps / 10000

  if (request.side === "buy") {
    const basePrice = book.yesAsk
    return Math.min(0.99, basePrice + slippageFactor)
  } else {
    const basePrice = book.yesBid
    return Math.max(0.01, basePrice - slippageFactor)
  }
}

export function createHedgeOrder(
  request: HedgeRequest,
  price: number,
  opportunityId: string
): OrderIntent {
  return {
    opportunityId,
    marketId: request.marketId,
    side: request.side,
    price,
    size: request.targetSize,
    tif: "IOC",
  }
}

export function createHedgeAction(
  request: HedgeRequest,
  book: BookState,
  config: TwoLegExecutionConfig,
  attemptNumber: number,
  opportunityId: string
): OrderAction {
  const price = calculateHedgePrice(
    request,
    book,
    config.maxSlippageBps,
    attemptNumber
  )
  const order = createHedgeOrder(request, price, opportunityId)

  return {
    type: "submit",
    legIndex: request.legIndex,
    order,
  }
}

export function evaluateHedgeUrgency(
  state: ExecutionState,
  elapsedMs: number,
  config: TwoLegExecutionConfig
): "low" | "medium" | "high" | "critical" {
  const remainingMs = config.legsTTLMs - elapsedMs
  const ratio = remainingMs / config.legsTTLMs

  if (ratio <= 0.1 || state.hedgeAttempts >= config.maxHedgeAttempts - 1) {
    return "critical"
  }
  if (ratio <= 0.3) {
    return "high"
  }
  if (ratio <= 0.5) {
    return "medium"
  }
  return "low"
}

export function shouldHedgeNow(
  state: ExecutionState,
  _book: BookState,
  _config: TwoLegExecutionConfig
): boolean {
  if (state.phase !== "passive_wait" && state.phase !== "hedge_active") {
    return false
  }

  const filledLeg = state.legs.find(
    (l) => l.status === "filled" || l.status === "partial"
  )
  if (!filledLeg || filledLeg.filledSize <= 0) {
    return false
  }

  const pendingLeg = state.legs.find(
    (l) => l.status === "pending" || l.status === "submitted"
  )
  if (!pendingLeg) {
    return false
  }

  const hedgeNeeded = filledLeg.filledSize - pendingLeg.filledSize
  return hedgeNeeded > 0
}

export function handleHedgeFailure(
  state: HedgeState,
  requestId: string,
  result: HedgeResult
): HedgeState {
  const newFailed = new Map(state.failedHedges)
  newFailed.set(requestId, result)

  const newPending = new Map(state.pendingHedges)
  newPending.delete(requestId)

  return {
    pendingHedges: newPending,
    completedHedges: state.completedHedges,
    failedHedges: newFailed,
    attemptCount: state.attemptCount + 1,
  }
}

export function handleHedgeSuccess(
  state: HedgeState,
  requestId: string,
  result: HedgeResult
): HedgeState {
  const newCompleted = new Map(state.completedHedges)
  newCompleted.set(requestId, result)

  const newPending = new Map(state.pendingHedges)
  newPending.delete(requestId)

  return {
    pendingHedges: newPending,
    completedHedges: newCompleted,
    failedHedges: state.failedHedges,
    attemptCount: state.attemptCount + 1,
  }
}

export function canRetryHedge(
  state: HedgeState,
  config: TwoLegExecutionConfig
): boolean {
  return state.attemptCount < config.maxHedgeAttempts
}

export function getHedgeFailureAction(
  state: ExecutionState,
  config: TwoLegExecutionConfig
): "retry" | "abort" | "force_balance" {
  if (state.hedgeAttempts < config.maxHedgeAttempts) {
    return "retry"
  }

  const filledLeg = state.legs.find((l) => l.filledSize > 0)
  if (filledLeg && filledLeg.filledSize > 0) {
    return "force_balance"
  }

  return "abort"
}

export function createForceBalanceAction(
  state: ExecutionState,
  book: BookState,
  opportunityId: string
): OrderAction | null {
  const filledLeg = state.legs.find((l) => l.filledSize > 0)
  if (!filledLeg) return null

  const hedgeSide = filledLeg.side === "buy" ? "sell" : "buy"
  const price = hedgeSide === "buy" ? book.yesAsk : book.yesBid

  return {
    type: "submit",
    legIndex: state.legs.findIndex((l) => l.filledSize === 0),
    order: {
      opportunityId,
      marketId: filledLeg.marketId,
      side: hedgeSide,
      price,
      size: filledLeg.filledSize,
      tif: "IOC",
    },
  }
}

export function calculateActualSlippage(
  targetPrice: number,
  actualPrice: number,
  side: "buy" | "sell"
): number {
  if (side === "buy") {
    return ((actualPrice - targetPrice) / targetPrice) * 10000
  }
  return ((targetPrice - actualPrice) / targetPrice) * 10000
}

export function isSlippageAcceptable(
  slippageBps: number,
  maxSlippageBps: number
): boolean {
  return slippageBps <= maxSlippageBps
}

export type BatchHedgePlan = {
  requests: HedgeRequest[]
  totalSize: number
  maxSlippageBps: number
  estimatedCost: number
}

export function createBatchHedgePlan(
  legs: Leg[],
  config: TwoLegExecutionConfig,
  bookStates: Map<string, BookState>
): BatchHedgePlan {
  const requests: HedgeRequest[] = []
  let totalSize = 0

  const filledLegs = legs.filter((l) => l.filledSize > 0)
  for (const filled of filledLegs) {
    const pending = legs.find(
      (l) => l.marketId !== filled.marketId && l.filledSize < filled.filledSize
    )
    if (!pending) continue

    const hedgeSize = filled.filledSize - pending.filledSize
    if (hedgeSize <= 0) continue

    const urgency = hedgeSize > filled.targetSize * 0.5 ? "high" : "medium"

    requests.push({
      legIndex: legs.indexOf(pending),
      marketId: pending.marketId,
      side: pending.side,
      targetSize: hedgeSize,
      maxSlippageBps: config.maxSlippageBps,
      urgency,
      targetPrice: pending.targetPrice,
    })

    totalSize += hedgeSize
  }

  let estimatedCost = 0
  for (const req of requests) {
    const book = bookStates.get(req.marketId)
    if (book) {
      const price = req.side === "buy" ? book.yesAsk : book.yesBid
      estimatedCost += price * req.targetSize
    }
  }

  return {
    requests,
    totalSize,
    maxSlippageBps: config.maxSlippageBps,
    estimatedCost,
  }
}
