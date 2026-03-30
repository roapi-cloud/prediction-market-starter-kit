import type {
  Opportunity,
  OrderUpdate,
  OrderAction,
  ExecutionState,
  ExecutionPlan,
  TwoLegExecutionResult,
  TwoLegExecutionConfig,
  Leg,
} from "../contracts/types"
import type { BookState } from "../ingest/orderbook"
import { simulateQueuePosition, estimateFillTime } from "./queue-simulator"
import {
  shouldHedgeNow,
  createHedgeAction,
  getHedgeFailureAction,
  calculateActualSlippage,
} from "./hedge-handler"
import { createPartialFillHandler } from "./partial-fill"
import { kellySize } from "./kelly"
import { stoikovPriceAdjust } from "./stoikov"

export class ExecutionOrchestrator {
  private config: TwoLegExecutionConfig
  private activeStates: Map<string, ExecutionState>
  private partialFillHandler: ReturnType<typeof createPartialFillHandler>

  constructor(config: TwoLegExecutionConfig) {
    this.config = config
    this.activeStates = new Map()
    this.partialFillHandler = createPartialFillHandler()
  }

  createPlan(
    opportunity: Opportunity,
    bookStates: Map<string, BookState>,
    equity: number,
    inventory: number
  ): ExecutionPlan {
    const size = kellySize(opportunity.evBps, opportunity.confidence, equity)
    const legs = this.createLegs(opportunity, bookStates, size, inventory)
    const queuePositions = this.calculateQueuePositions(legs, bookStates)
    const estimatedFillTime = this.estimateTotalFillTime(
      queuePositions,
      legs,
      bookStates
    )

    return {
      opportunityId: opportunity.id,
      legs,
      config: this.config,
      estimatedFillTime,
      queuePositions,
    }
  }

  private createLegs(
    opportunity: Opportunity,
    bookStates: Map<string, BookState>,
    size: number,
    inventory: number
  ): Leg[] {
    const legs: Leg[] = []
    const marketIds = opportunity.marketIds

    if (marketIds.length < 2) {
      return legs
    }

    const bookA = bookStates.get(marketIds[0])
    const bookB = bookStates.get(marketIds[1])

    if (!bookA || !bookB) {
      return legs
    }

    const priceA = stoikovPriceAdjust(bookA.yesBid, inventory)
    const priceB = stoikovPriceAdjust(bookB.yesBid, -inventory)

    legs.push({
      marketId: marketIds[0],
      side: "buy",
      targetPrice: priceA,
      targetSize: size,
      filledSize: 0,
      avgPrice: 0,
      status: "pending",
    })

    legs.push({
      marketId: marketIds[1],
      side: "sell",
      targetPrice: priceB,
      targetSize: size,
      filledSize: 0,
      avgPrice: 0,
      status: "pending",
    })

    return legs
  }

  private calculateQueuePositions(
    legs: Leg[],
    bookStates: Map<string, BookState>
  ): number[] {
    if (!this.config.queuePositionSimulation) {
      return legs.map(() => 0)
    }

    return legs.map((leg) => {
      const book = bookStates.get(leg.marketId)
      if (!book) return 0

      const queueState = simulateQueuePosition(
        leg.targetPrice,
        leg.side,
        book,
        leg.targetSize
      )
      return queueState.position
    })
  }

  private estimateTotalFillTime(
    queuePositions: number[],
    legs: Leg[],
    bookStates: Map<string, BookState>
  ): number {
    if (this.config.strategy === "ioc_both") {
      return this.config.legsTTLMs
    }

    if (this.config.strategy === "simultaneous") {
      return this.config.legsTTLMs
    }

    const passiveLegIndex = this.selectPassiveLeg(legs, bookStates)
    const passiveQueuePos = queuePositions[passiveLegIndex]

    return estimateFillTime(
      passiveQueuePos,
      1,
      legs[passiveLegIndex].targetSize
    )
  }

  private selectPassiveLeg(
    legs: Leg[],
    bookStates: Map<string, BookState>
  ): number {
    let bestIndex = 0
    let bestSpread = Infinity

    for (let i = 0; i < legs.length; i++) {
      const book = bookStates.get(legs[i].marketId)
      if (!book) continue

      const spread = book.yesAsk - book.yesBid
      if (spread < bestSpread) {
        bestSpread = spread
        bestIndex = i
      }
    }

    return bestIndex
  }

  startExecution(plan: ExecutionPlan, now: number): ExecutionState {
    const state: ExecutionState = {
      opportunityId: plan.opportunityId,
      legs: plan.legs.map((l) => ({ ...l })),
      phase:
        this.config.strategy === "ioc_both" ? "hedge_active" : "passive_wait",
      startTime: now,
      elapsedMs: 0,
      remainingSize: plan.legs.reduce((sum, l) => sum + l.targetSize, 0),
      hedgeAttempts: 0,
      totalPnl: 0,
    }

    this.activeStates.set(plan.opportunityId, state)

    return state
  }

  onOrderUpdate(update: OrderUpdate, state: ExecutionState): ExecutionState {
    const legIndex = this.findLegByOrderId(state, update.orderId)
    if (legIndex === -1) {
      return state
    }

    const leg = state.legs[legIndex]
    const newFilledSize = leg.filledSize + update.filledSize
    const newAvgPrice =
      newFilledSize > 0
        ? (leg.avgPrice * leg.filledSize +
            (update.avgPrice ?? leg.targetPrice) * update.filledSize) /
          newFilledSize
        : leg.avgPrice

    const newLeg: Leg = {
      ...leg,
      filledSize: newFilledSize,
      avgPrice: newAvgPrice,
      orderId: update.orderId,
      status: this.mapOrderStatusToLegStatus(
        update.status,
        newFilledSize,
        leg.targetSize
      ),
    }

    const newLegs = [...state.legs]
    newLegs[legIndex] = newLeg

    let newPhase = state.phase
    if (this.config.strategy === "passive_then_ioc") {
      if (newLeg.status === "filled" || newLeg.status === "partial") {
        if (state.phase === "passive_wait") {
          newPhase = "hedge_active"
        }
      }
    }

    if (newLegs.every((l) => l.status === "filled")) {
      newPhase = "completed"
    }

    const newRemainingSize = newLegs.reduce(
      (sum, l) => sum + (l.targetSize - l.filledSize),
      0
    )

    const newState: ExecutionState = {
      ...state,
      legs: newLegs,
      phase: newPhase,
      remainingSize: newRemainingSize,
    }

    this.activeStates.set(state.opportunityId, newState)

    return newState
  }

  private findLegByOrderId(state: ExecutionState, orderId: string): number {
    return state.legs.findIndex((l) => l.orderId === orderId)
  }

  private mapOrderStatusToLegStatus(
    orderStatus: OrderUpdate["status"],
    filledSize: number,
    targetSize: number
  ): Leg["status"] {
    switch (orderStatus) {
      case "accepted":
        return "submitted"
      case "partial_fill":
        return filledSize >= targetSize ? "filled" : "partial"
      case "filled":
        return "filled"
      case "canceled":
        return filledSize > 0 ? "partial" : "failed"
      case "rejected":
        return "failed"
      default:
        return "pending"
    }
  }

  checkTimeout(state: ExecutionState, now: number): ExecutionState {
    const elapsedMs = now - state.startTime

    if (elapsedMs >= this.config.legsTTLMs) {
      return this.handleLegsTimeout(state, now)
    }

    if (
      state.phase === "hedge_active" &&
      elapsedMs - state.elapsedMs >= this.config.hedgeTTLMs
    ) {
      return this.handleHedgeTimeout(state, now)
    }

    return {
      ...state,
      elapsedMs,
    }
  }

  private handleLegsTimeout(
    state: ExecutionState,
    now: number
  ): ExecutionState {
    const filledLegs = state.legs.filter((l) => l.filledSize > 0)

    if (filledLegs.length === 0) {
      return {
        ...state,
        phase: "aborted",
        elapsedMs: now - state.startTime,
      }
    }

    if (filledLegs.length === state.legs.length) {
      return {
        ...state,
        phase: "completed",
        elapsedMs: now - state.startTime,
      }
    }

    return {
      ...state,
      phase: "failed",
      elapsedMs: now - state.startTime,
    }
  }

  private handleHedgeTimeout(
    state: ExecutionState,
    now: number
  ): ExecutionState {
    const action = getHedgeFailureAction(state, this.config)

    if (action === "retry") {
      return {
        ...state,
        hedgeAttempts: state.hedgeAttempts + 1,
        elapsedMs: now - state.startTime,
      }
    }

    if (action === "force_balance") {
      return {
        ...state,
        phase: "failed",
        elapsedMs: now - state.startTime,
      }
    }

    return {
      ...state,
      phase: "aborted",
      elapsedMs: now - state.startTime,
    }
  }

  hedgeLeg(state: ExecutionState, book: BookState): OrderAction | null {
    if (!shouldHedgeNow(state, book, this.config)) {
      return null
    }

    const filledLeg = state.legs.find(
      (l) => l.status === "filled" || l.status === "partial"
    )
    const pendingLeg = state.legs.find(
      (l) => l.status === "pending" || l.status === "submitted"
    )

    if (!filledLeg || !pendingLeg) {
      return null
    }

    const hedgeSize = filledLeg.filledSize - pendingLeg.filledSize
    if (hedgeSize <= 0) {
      return null
    }

    const request = {
      legIndex: state.legs.indexOf(pendingLeg),
      marketId: pendingLeg.marketId,
      side: (pendingLeg.side === "buy" ? "sell" : "buy") as "buy" | "sell",
      targetSize: hedgeSize,
      maxSlippageBps: this.config.maxSlippageBps,
      urgency: "high" as const,
      targetPrice: pendingLeg.targetPrice,
    }

    return createHedgeAction(
      request,
      book,
      this.config,
      state.hedgeAttempts,
      state.opportunityId
    )
  }

  abort(state: ExecutionState): OrderAction[] {
    const actions: OrderAction[] = []

    for (const leg of state.legs) {
      if (
        leg.orderId &&
        (leg.status === "submitted" || leg.status === "partial")
      ) {
        actions.push({
          type: "cancel",
          orderId: leg.orderId,
          legIndex: state.legs.indexOf(leg),
          order: {
            opportunityId: state.opportunityId,
            marketId: leg.marketId,
            side: leg.side,
            price: leg.targetPrice,
            size: leg.targetSize - leg.filledSize,
            tif: "IOC",
          },
        })
      }
    }

    this.activeStates.delete(state.opportunityId)

    return actions
  }

  createInitialActions(plan: ExecutionPlan): OrderAction[] {
    const actions: OrderAction[] = []

    if (this.config.strategy === "passive_then_ioc") {
      const passiveLegIndex = 0
      const passiveLeg = plan.legs[passiveLegIndex]

      actions.push({
        type: "submit",
        legIndex: passiveLegIndex,
        order: {
          opportunityId: plan.opportunityId,
          marketId: passiveLeg.marketId,
          side: passiveLeg.side,
          price: passiveLeg.targetPrice,
          size: passiveLeg.targetSize,
          tif: "GTC",
        },
      })
    } else if (this.config.strategy === "simultaneous") {
      for (let i = 0; i < plan.legs.length; i++) {
        const leg = plan.legs[i]
        actions.push({
          type: "submit",
          legIndex: i,
          order: {
            opportunityId: plan.opportunityId,
            marketId: leg.marketId,
            side: leg.side,
            price: leg.targetPrice,
            size: leg.targetSize,
            tif: "GTC",
          },
        })
      }
    } else if (this.config.strategy === "ioc_both") {
      for (let i = 0; i < plan.legs.length; i++) {
        const leg = plan.legs[i]
        actions.push({
          type: "submit",
          legIndex: i,
          order: {
            opportunityId: plan.opportunityId,
            marketId: leg.marketId,
            side: leg.side,
            price: leg.targetPrice,
            size: leg.targetSize,
            tif: "IOC",
          },
        })
      }
    }

    return actions
  }

  getResult(state: ExecutionState): TwoLegExecutionResult {
    const legsFilled = state.legs.map((l) => l.filledSize)
    const avgPrices = state.legs.map((l) => l.avgPrice)

    const filledLeg = state.legs.find((l) => l.filledSize > 0 && l.avgPrice > 0)
    let actualSlippageBps = 0
    if (filledLeg) {
      actualSlippageBps = calculateActualSlippage(
        filledLeg.targetPrice,
        filledLeg.avgPrice,
        filledLeg.side
      )
    }

    let pnlBps = 0
    if (
      state.legs.length >= 2 &&
      state.legs[0].filledSize > 0 &&
      state.legs[1].filledSize > 0
    ) {
      const size = Math.min(state.legs[0].filledSize, state.legs[1].filledSize)
      const buyCost = state.legs[0].avgPrice * size
      const sellRevenue = state.legs[1].avgPrice * size
      pnlBps = ((sellRevenue - buyCost) / buyCost) * 10000
    }

    return {
      opportunityId: state.opportunityId,
      success: state.phase === "completed",
      legsFilled,
      avgPrices,
      actualSlippageBps,
      executionTimeMs: state.elapsedMs,
      pnlBps,
      phaseReached: state.phase,
      hedgeAttemptsUsed: state.hedgeAttempts,
    }
  }

  getActiveState(opportunityId: string): ExecutionState | undefined {
    return this.activeStates.get(opportunityId)
  }

  clearState(opportunityId: string): void {
    this.activeStates.delete(opportunityId)
  }
}

export function simulateQueuePositionSimple(
  price: number,
  book: BookState
): number {
  const midPrice = (book.yesBid + book.yesAsk) / 2
  const spread = book.yesAsk - book.yesBid

  const distanceFromMid = Math.abs(price - midPrice)
  if (distanceFromMid > spread * 0.5) {
    return 0
  }

  const positionRatio = 1 - distanceFromMid / (spread * 0.5)
  return Math.floor(positionRatio * 100)
}

export function estimateFillTimeSimple(
  queuePos: number,
  tradeRate: number
): number {
  if (queuePos <= 0) return 0
  if (tradeRate <= 0) return 30000

  return Math.min(30000, (queuePos / tradeRate) * 1000)
}
