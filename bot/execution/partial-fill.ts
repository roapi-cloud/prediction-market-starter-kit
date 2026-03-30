import type { Leg, OrderUpdate } from "../contracts/types"

export type PartialFillState = {
  legIndex: number
  originalSize: number
  filledSize: number
  remainingSize: number
  avgPrice: number
  fillRatio: number
  fillCount: number
  lastFillTs: number
}

export function createPartialFillState(
  leg: Leg,
  legIndex: number
): PartialFillState {
  return {
    legIndex,
    originalSize: leg.targetSize,
    filledSize: leg.filledSize,
    remainingSize: leg.targetSize - leg.filledSize,
    avgPrice: leg.avgPrice,
    fillRatio: leg.filledSize / Math.max(1, leg.targetSize),
    fillCount: 0,
    lastFillTs: 0,
  }
}

export function updatePartialFill(
  state: PartialFillState,
  update: OrderUpdate,
  _threshold: number
): PartialFillState {
  const newFilledSize = state.filledSize + update.filledSize
  const newRemainingSize = state.originalSize - newFilledSize
  const newFillRatio = newFilledSize / Math.max(1, state.originalSize)

  const prevTotalCost = state.avgPrice * state.filledSize
  const newFillCost = (update.avgPrice ?? state.avgPrice) * update.filledSize
  const newAvgPrice =
    newFilledSize > 0
      ? (prevTotalCost + newFillCost) / newFilledSize
      : state.avgPrice

  return {
    legIndex: state.legIndex,
    originalSize: state.originalSize,
    filledSize: newFilledSize,
    remainingSize: newRemainingSize,
    avgPrice: newAvgPrice,
    fillRatio: newFillRatio,
    fillCount: state.fillCount + 1,
    lastFillTs: update.ts,
  }
}

export function isPartialFill(
  state: PartialFillState,
  threshold: number
): boolean {
  return (
    state.fillRatio > 0 && state.fillRatio < 1 && state.fillRatio >= threshold
  )
}

export function isBelowThreshold(
  state: PartialFillState,
  threshold: number
): boolean {
  return state.fillRatio > 0 && state.fillRatio < threshold
}

export function isFullyFilled(state: PartialFillState): boolean {
  return state.fillRatio >= 1
}

export function needsHedge(state: PartialFillState): boolean {
  return state.remainingSize > 0 && state.filledSize > 0
}

export function getHedgeSize(state: PartialFillState): number {
  return state.remainingSize
}

export function shouldReevaluate(
  state: PartialFillState,
  threshold: number
): boolean {
  return isBelowThreshold(state, threshold)
}

export type PartialFillHandler = {
  states: Map<string, PartialFillState>
  pendingHedges: Map<string, number[]>
}

export function createPartialFillHandler(): PartialFillHandler {
  return {
    states: new Map(),
    pendingHedges: new Map(),
  }
}

export function registerLeg(
  handler: PartialFillHandler,
  orderId: string,
  leg: Leg,
  legIndex: number
): PartialFillHandler {
  const newStates = new Map(handler.states)
  newStates.set(orderId, createPartialFillState(leg, legIndex))
  return { ...handler, states: newStates }
}

export function processFill(
  handler: PartialFillHandler,
  orderId: string,
  update: OrderUpdate,
  threshold: number
): {
  handler: PartialFillHandler
  state: PartialFillState | null
  needsHedge: boolean
  hedgeSize: number
} {
  const existing = handler.states.get(orderId)
  if (!existing) {
    return { handler, state: null, needsHedge: false, hedgeSize: 0 }
  }

  const newState = updatePartialFill(existing, update, threshold)
  const newStates = new Map(handler.states)
  newStates.set(orderId, newState)

  const needsHedge =
    isPartialFill(newState, threshold) ||
    (isFullyFilled(newState) && newState.remainingSize === 0)
  const hedgeSize = needsHedge ? getHedgeSize(newState) : 0

  return {
    handler: { ...handler, states: newStates },
    state: newState,
    needsHedge,
    hedgeSize,
  }
}

export function clearState(
  handler: PartialFillHandler,
  orderId: string
): PartialFillHandler {
  const newStates = new Map(handler.states)
  newStates.delete(orderId)
  return { ...handler, states: newStates }
}

export function getRemainingSizeForLeg(
  handler: PartialFillHandler,
  orderId: string
): number {
  const state = handler.states.get(orderId)
  return state?.remainingSize ?? 0
}

export function calculateBatchHedgeSizes(
  handler: PartialFillHandler,
  orderIds: string[]
): number[] {
  return orderIds.map((id) => {
    const state = handler.states.get(id)
    return state?.remainingSize ?? 0
  })
}

export function splitHedgeOrder(
  totalSize: number,
  maxBatchSize: number
): number[] {
  if (totalSize <= maxBatchSize) return [totalSize]

  const batches: number[] = []
  let remaining = totalSize

  while (remaining > 0) {
    const batch = Math.min(maxBatchSize, remaining)
    batches.push(batch)
    remaining -= batch
  }

  return batches
}

export type PartialFillDecision = {
  action: "continue" | "hedge_partial" | "cancel" | "complete"
  reason: string
  hedgeSize?: number
}

export function makePartialFillDecision(
  state: PartialFillState,
  elapsedMs: number,
  maxElapsedMs: number,
  threshold: number
): PartialFillDecision {
  if (isFullyFilled(state)) {
    return { action: "complete", reason: "Fully filled" }
  }

  if (elapsedMs >= maxElapsedMs) {
    if (state.filledSize > 0) {
      return {
        action: "hedge_partial",
        reason: `Timeout with ${state.fillRatio.toFixed(2)} filled`,
        hedgeSize: state.remainingSize,
      }
    }
    return { action: "cancel", reason: "Timeout with no fills" }
  }

  if (isPartialFill(state, threshold)) {
    return {
      action: "hedge_partial",
      reason: `Partial fill threshold reached (${state.fillRatio.toFixed(2)})`,
      hedgeSize: state.remainingSize,
    }
  }

  if (isBelowThreshold(state, threshold) && state.filledSize > 0) {
    return {
      action: "continue",
      reason: `Below threshold (${state.fillRatio.toFixed(2)}), continue waiting`,
    }
  }

  return { action: "continue", reason: "No fills yet, continue waiting" }
}
