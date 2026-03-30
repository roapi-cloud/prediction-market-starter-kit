import test from "node:test"
import assert from "node:assert/strict"
import {
  ExecutionOrchestrator,
  simulateQueuePositionSimple,
  estimateFillTimeSimple,
} from "../execution/orchestrator"
import {
  DEFAULT_EXECUTION_CONFIG,
  createExecutionConfig,
  validateExecutionConfig,
  getConfigForStrategy,
} from "../config/execution-config"
import {
  simulateQueuePosition,
  estimateFillTime,
  createQueueTracker,
  updateQueuePosition,
  updateTradeRate,
} from "../execution/queue-simulator"
import {
  createPartialFillState,
  updatePartialFill,
  isPartialFill,
  isFullyFilled,
  needsHedge,
  makePartialFillDecision,
} from "../execution/partial-fill"
import {
  createHedgeState,
  createHedgeRequest,
  calculateHedgePrice,
  calculateActualSlippage,
  isSlippageAcceptable,
} from "../execution/hedge-handler"
import type {
  Opportunity,
  Leg,
  ExecutionState,
  OrderUpdate,
  ExecutionPlan,
} from "../contracts/types"
import type { BookState } from "../ingest/orderbook"

test("DEFAULT_EXECUTION_CONFIG has correct defaults", () => {
  assert.equal(DEFAULT_EXECUTION_CONFIG.strategy, "passive_then_ioc")
  assert.equal(DEFAULT_EXECUTION_CONFIG.legsTTLMs, 30000)
  assert.equal(DEFAULT_EXECUTION_CONFIG.hedgeTTLMs, 5000)
  assert.equal(DEFAULT_EXECUTION_CONFIG.maxSlippageBps, 50)
  assert.equal(DEFAULT_EXECUTION_CONFIG.maxHedgeAttempts, 3)
  assert.equal(DEFAULT_EXECUTION_CONFIG.partialFillThreshold, 0.5)
  assert.equal(DEFAULT_EXECUTION_CONFIG.queuePositionSimulation, true)
})

test("createExecutionConfig merges overrides", () => {
  const config = createExecutionConfig({ legsTTLMs: 60000 })
  assert.equal(config.legsTTLMs, 60000)
  assert.equal(config.strategy, "passive_then_ioc")
})

test("validateExecutionConfig returns errors for invalid config", () => {
  const invalidConfig = {
    strategy: "passive_then_ioc",
    legsTTLMs: -1,
    hedgeTTLMs: 0,
    maxSlippageBps: 0,
    maxHedgeAttempts: 0,
    partialFillThreshold: 0,
    queuePositionSimulation: true,
  }
  const errors = validateExecutionConfig(invalidConfig as any)
  assert.ok(errors.length > 0)
})

test("validateExecutionConfig passes for valid config", () => {
  const errors = validateExecutionConfig(DEFAULT_EXECUTION_CONFIG)
  assert.equal(errors.length, 0)
})

test("getConfigForStrategy returns correct config for each strategy", () => {
  const passiveConfig = getConfigForStrategy("passive_then_ioc")
  assert.equal(passiveConfig.strategy, "passive_then_ioc")

  const simultaneousConfig = getConfigForStrategy("simultaneous")
  assert.equal(simultaneousConfig.strategy, "simultaneous")

  const iocConfig = getConfigForStrategy("ioc_both")
  assert.equal(iocConfig.strategy, "ioc_both")
})

test("simulateQueuePositionSimple returns position within spread", () => {
  const book: BookState = {
    yesBid: 0.49,
    yesAsk: 0.51,
    noBid: 0.49,
    noAsk: 0.51,
  }
  const posAtMid = simulateQueuePositionSimple(0.5, book)
  assert.ok(posAtMid >= 0 && posAtMid <= 100)

  const posOutside = simulateQueuePositionSimple(0.4, book)
  assert.equal(posOutside, 0)
})

test("estimateFillTimeSimple returns reasonable time", () => {
  const zeroPos = estimateFillTimeSimple(0, 1)
  assert.equal(zeroPos, 0)

  const zeroRate = estimateFillTimeSimple(100, 0)
  assert.equal(zeroRate, 30000)

  const normal = estimateFillTimeSimple(100, 10)
  assert.ok(normal > 0 && normal <= 30000)
})

test("createPartialFillState initializes correctly", () => {
  const leg: Leg = {
    marketId: "m1",
    side: "buy",
    targetPrice: 0.5,
    targetSize: 100,
    filledSize: 0,
    avgPrice: 0,
    status: "pending",
  }
  const state = createPartialFillState(leg, 0)
  assert.equal(state.originalSize, 100)
  assert.equal(state.filledSize, 0)
  assert.equal(state.remainingSize, 100)
  assert.equal(state.fillRatio, 0)
})

test("updatePartialFill updates state correctly", () => {
  const leg: Leg = {
    marketId: "m1",
    side: "buy",
    targetPrice: 0.5,
    targetSize: 100,
    filledSize: 0,
    avgPrice: 0,
    status: "pending",
  }
  const state = createPartialFillState(leg, 0)
  const update: OrderUpdate = {
    orderId: "o1",
    status: "partial_fill",
    filledSize: 50,
    avgPrice: 0.48,
    ts: 1000,
  }
  const newState = updatePartialFill(state, update, 0.5)
  assert.equal(newState.filledSize, 50)
  assert.equal(newState.remainingSize, 50)
  assert.equal(newState.fillRatio, 0.5)
  assert.equal(newState.avgPrice, 0.48)
})

test("isPartialFill detects threshold correctly", () => {
  const state = { fillRatio: 0.5 } as any
  assert.equal(isPartialFill(state, 0.5), true)

  const belowThreshold = { fillRatio: 0.3 } as any
  assert.equal(isPartialFill(belowThreshold, 0.5), false)

  const aboveThreshold = { fillRatio: 0.7 } as any
  assert.equal(isPartialFill(aboveThreshold, 0.5), true)
})

test("isFullyFilled detects complete fill", () => {
  const filled = { fillRatio: 1 } as any
  assert.equal(isFullyFilled(filled), true)

  const partial = { fillRatio: 0.8 } as any
  assert.equal(isFullyFilled(partial), false)
})

test("needsHedge detects when hedge is required", () => {
  const needsHedgeState = { remainingSize: 50, filledSize: 50 } as any
  assert.equal(needsHedge(needsHedgeState), true)

  const noFill = { remainingSize: 100, filledSize: 0 } as any
  assert.equal(needsHedge(noFill), false)
})

test("makePartialFillDecision returns correct action", () => {
  const filledState = { fillRatio: 1, filledSize: 100 } as any
  const decision = makePartialFillDecision(filledState, 0, 30000, 0.5)
  assert.equal(decision.action, "complete")

  const timeoutNoFill = { fillRatio: 0, filledSize: 0 } as any
  const timeoutDecision = makePartialFillDecision(
    timeoutNoFill,
    30000,
    30000,
    0.5
  )
  assert.equal(timeoutDecision.action, "cancel")

  const partialFill = {
    fillRatio: 0.6,
    filledSize: 60,
    remainingSize: 40,
  } as any
  const partialDecision = makePartialFillDecision(
    partialFill,
    10000,
    30000,
    0.5
  )
  assert.equal(partialDecision.action, "hedge_partial")
})

test("calculateHedgePrice computes price with slippage", () => {
  const book: BookState = {
    yesBid: 0.49,
    yesAsk: 0.51,
    noBid: 0.49,
    noAsk: 0.51,
  }
  const buyRequest = { side: "buy", maxSlippageBps: 50 } as any
  const buyPrice = calculateHedgePrice(buyRequest, book, 50, 0)
  assert.ok(buyPrice >= book.yesAsk)

  const sellRequest = { side: "sell", maxSlippageBps: 50 } as any
  const sellPrice = calculateHedgePrice(sellRequest, book, 50, 0)
  assert.ok(sellPrice <= book.yesBid)
})

test("calculateActualSlippage computes correct bps", () => {
  const buySlippage = calculateActualSlippage(0.5, 0.505, "buy")
  assert.ok(buySlippage > 0)

  const sellSlippage = calculateActualSlippage(0.5, 0.495, "sell")
  assert.ok(sellSlippage > 0)

  const noSlippage = calculateActualSlippage(0.5, 0.5, "buy")
  assert.equal(noSlippage, 0)
})

test("isSlippageAcceptable validates slippage", () => {
  assert.equal(isSlippageAcceptable(30, 50), true)
  assert.equal(isSlippageAcceptable(60, 50), false)
})

test("ExecutionOrchestrator creates correct plan", () => {
  const orchestrator = new ExecutionOrchestrator(DEFAULT_EXECUTION_CONFIG)
  const opportunity: Opportunity = {
    id: "opp1",
    strategy: "static_arb",
    marketIds: ["m1", "m2"],
    evBps: 100,
    confidence: 0.8,
    ttlMs: 30000,
    createdAt: Date.now(),
  }
  const bookStates = new Map<string, BookState>()
  bookStates.set("m1", { yesBid: 0.49, yesAsk: 0.51, noBid: 0.49, noAsk: 0.51 })
  bookStates.set("m2", { yesBid: 0.48, yesAsk: 0.52, noBid: 0.48, noAsk: 0.52 })

  const plan = orchestrator.createPlan(opportunity, bookStates, 10000, 0)
  assert.equal(plan.opportunityId, "opp1")
  assert.equal(plan.legs.length, 2)
  assert.equal(plan.config.strategy, "passive_then_ioc")
})

test("ExecutionOrchestrator starts execution correctly", () => {
  const orchestrator = new ExecutionOrchestrator(DEFAULT_EXECUTION_CONFIG)
  const plan: ExecutionPlan = {
    opportunityId: "opp1",
    legs: [
      {
        marketId: "m1",
        side: "buy" as const,
        targetPrice: 0.5,
        targetSize: 100,
        filledSize: 0,
        avgPrice: 0,
        status: "pending" as const,
      },
      {
        marketId: "m2",
        side: "sell" as const,
        targetPrice: 0.5,
        targetSize: 100,
        filledSize: 0,
        avgPrice: 0,
        status: "pending" as const,
      },
    ],
    config: DEFAULT_EXECUTION_CONFIG,
    estimatedFillTime: 10000,
    queuePositions: [0, 0],
  }

  const state = orchestrator.startExecution(plan, 1000)
  assert.equal(state.opportunityId, "opp1")
  assert.equal(state.phase, "passive_wait")
  assert.equal(state.startTime, 1000)
  assert.equal(state.remainingSize, 200)
})

test("ExecutionOrchestrator handles order update", () => {
  const orchestrator = new ExecutionOrchestrator(DEFAULT_EXECUTION_CONFIG)
  const state: ExecutionState = {
    opportunityId: "opp1",
    legs: [
      {
        marketId: "m1",
        side: "buy",
        targetPrice: 0.5,
        targetSize: 100,
        filledSize: 0,
        avgPrice: 0,
        orderId: "o1",
        status: "submitted",
      },
      {
        marketId: "m2",
        side: "sell",
        targetPrice: 0.5,
        targetSize: 100,
        filledSize: 0,
        avgPrice: 0,
        status: "pending",
      },
    ],
    phase: "passive_wait",
    startTime: 1000,
    elapsedMs: 0,
    remainingSize: 200,
    hedgeAttempts: 0,
    totalPnl: 0,
  }

  const update: OrderUpdate = {
    orderId: "o1",
    status: "filled",
    filledSize: 100,
    avgPrice: 0.49,
    ts: 2000,
  }

  const newState = orchestrator.onOrderUpdate(update, state)
  assert.equal(newState.legs[0].filledSize, 100)
  assert.equal(newState.legs[0].status, "filled")
  assert.equal(newState.phase, "hedge_active")
})

test("ExecutionOrchestrator handles partial fill", () => {
  const orchestrator = new ExecutionOrchestrator(DEFAULT_EXECUTION_CONFIG)
  const state: ExecutionState = {
    opportunityId: "opp1",
    legs: [
      {
        marketId: "m1",
        side: "buy",
        targetPrice: 0.5,
        targetSize: 100,
        filledSize: 0,
        avgPrice: 0,
        orderId: "o1",
        status: "submitted",
      },
      {
        marketId: "m2",
        side: "sell",
        targetPrice: 0.5,
        targetSize: 100,
        filledSize: 0,
        avgPrice: 0,
        status: "pending",
      },
    ],
    phase: "passive_wait",
    startTime: 1000,
    elapsedMs: 0,
    remainingSize: 200,
    hedgeAttempts: 0,
    totalPnl: 0,
  }

  const update: OrderUpdate = {
    orderId: "o1",
    status: "partial_fill",
    filledSize: 50,
    avgPrice: 0.49,
    ts: 2000,
  }

  const newState = orchestrator.onOrderUpdate(update, state)
  assert.equal(newState.legs[0].filledSize, 50)
  assert.equal(newState.legs[0].status, "partial")
  assert.equal(newState.phase, "hedge_active")
})

test("ExecutionOrchestrator handles timeout", () => {
  const orchestrator = new ExecutionOrchestrator(DEFAULT_EXECUTION_CONFIG)
  const state: ExecutionState = {
    opportunityId: "opp1",
    legs: [
      {
        marketId: "m1",
        side: "buy",
        targetPrice: 0.5,
        targetSize: 100,
        filledSize: 0,
        avgPrice: 0,
        orderId: "o1",
        status: "submitted",
      },
      {
        marketId: "m2",
        side: "sell",
        targetPrice: 0.5,
        targetSize: 100,
        filledSize: 0,
        avgPrice: 0,
        status: "pending",
      },
    ],
    phase: "passive_wait",
    startTime: 1000,
    elapsedMs: 0,
    remainingSize: 200,
    hedgeAttempts: 0,
    totalPnl: 0,
  }

  const timeoutState = orchestrator.checkTimeout(state, 35000)
  assert.equal(timeoutState.phase, "aborted")
})

test("ExecutionOrchestrator creates abort actions", () => {
  const orchestrator = new ExecutionOrchestrator(DEFAULT_EXECUTION_CONFIG)
  const state: ExecutionState = {
    opportunityId: "opp1",
    legs: [
      {
        marketId: "m1",
        side: "buy",
        targetPrice: 0.5,
        targetSize: 100,
        filledSize: 50,
        avgPrice: 0.49,
        orderId: "o1",
        status: "partial",
      },
      {
        marketId: "m2",
        side: "sell",
        targetPrice: 0.5,
        targetSize: 100,
        filledSize: 0,
        avgPrice: 0,
        status: "pending",
      },
    ],
    phase: "hedge_active",
    startTime: 1000,
    elapsedMs: 5000,
    remainingSize: 150,
    hedgeAttempts: 3,
    totalPnl: 0,
  }

  const actions = orchestrator.abort(state)
  assert.ok(actions.length > 0)
  assert.equal(actions[0].type, "cancel")
})

test("ExecutionOrchestrator generates correct result", () => {
  const orchestrator = new ExecutionOrchestrator(DEFAULT_EXECUTION_CONFIG)
  const state: ExecutionState = {
    opportunityId: "opp1",
    legs: [
      {
        marketId: "m1",
        side: "buy",
        targetPrice: 0.5,
        targetSize: 100,
        filledSize: 100,
        avgPrice: 0.49,
        status: "filled",
      },
      {
        marketId: "m2",
        side: "sell",
        targetPrice: 0.51,
        targetSize: 100,
        filledSize: 100,
        avgPrice: 0.51,
        status: "filled",
      },
    ],
    phase: "completed",
    startTime: 1000,
    elapsedMs: 5000,
    remainingSize: 0,
    hedgeAttempts: 1,
    totalPnl: 2,
  }

  const result = orchestrator.getResult(state)
  assert.equal(result.success, true)
  assert.equal(result.phaseReached, "completed")
  assert.equal(result.legsFilled[0], 100)
  assert.equal(result.legsFilled[1], 100)
  assert.ok(result.pnlBps > 0)
})

test("queue simulator tracks positions", () => {
  const tracker = createQueueTracker()
  assert.equal(tracker.orders.size, 0)
  assert.equal(tracker.tradeRates.size, 0)

  const newState = updateQueuePosition(tracker, "o1", {
    position: 5,
    totalSize: 100,
    aheadSize: 500,
    behindSize: 0,
    estimatedFillTimeMs: 5000,
  })
  assert.equal(newState.orders.size, 1)
})

test("queue simulator updates trade rate", () => {
  const tracker = createQueueTracker()
  const updated = updateTradeRate(tracker, "m1", 100, "buy", 1000)
  assert.equal(updated.tradeRates.size, 1)
  assert.ok(updated.tradeRates.get("m1")!.buyRate > 0)
})
