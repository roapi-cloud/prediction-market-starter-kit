import test from "node:test"
import assert from "node:assert/strict"
import {
  RiskEngineEnhanced,
  createDefaultRiskState,
  buildCorrelationMatrix,
} from "../risk/engine-enhanced"
import {
  getDefaultRiskConfig,
  getConservativeRiskConfig,
} from "../config/risk-config"
import {
  updateConsecutiveFails,
  checkConsecutiveFail,
  resetConsecutiveFail,
} from "../risk/consecutive-fail"
import {
  computeCombinedExposure,
  calculateCorrelation,
  checkCorrelationRisk,
} from "../risk/correlation-risk"
import {
  updateSlippageStats,
  getSlippageAdjustment,
  checkSlippageAnomaly,
} from "../risk/slippage-calibration"
import {
  checkDrawdown,
  checkIntradayLoss,
  shouldTriggerKillSwitch,
} from "../risk/drawdown"
import type {
  Opportunity,
  ExecutionResult,
  SlippageFeedback,
  Position,
  RiskStateEnhanced,
} from "../contracts/types"

test("RiskEngineEnhanced - basic preTradeCheck allows valid opportunity", () => {
  const state = createDefaultRiskState(10_000)
  const config = getDefaultRiskConfig(10_000)
  const engine = new RiskEngineEnhanced(config)

  const opp: Opportunity = {
    id: "test-1",
    strategy: "static_arb",
    marketIds: ["market-a"],
    evBps: 50,
    confidence: 0.8,
    ttlMs: 10_000,
    createdAt: Date.now(),
  }

  const decision = engine.preTradeCheck(opp, state)
  assert.equal(decision.allow, true)
  assert.ok(decision.maxSize! > 0)
  assert.equal(decision.killSwitch, false)
})

test("RiskEngineEnhanced - rejects when kill switch active", () => {
  const state = createDefaultRiskState(10_000)
  state.killSwitch = true
  state.killSwitchReason = "TEST_KILL"
  const config = getDefaultRiskConfig(10_000)
  const engine = new RiskEngineEnhanced(config)

  const opp: Opportunity = {
    id: "test-2",
    strategy: "static_arb",
    marketIds: ["market-a"],
    evBps: 50,
    confidence: 0.8,
    ttlMs: 10_000,
    createdAt: Date.now(),
  }

  const decision = engine.preTradeCheck(opp, state)
  assert.equal(decision.allow, false)
  assert.ok(decision.reason?.includes("KILL_SWITCH"))
  assert.equal(decision.killSwitch, true)
})

test("RiskEngineEnhanced - rejects negative EV", () => {
  const state = createDefaultRiskState(10_000)
  const config = getDefaultRiskConfig(10_000)
  const engine = new RiskEngineEnhanced(config)

  const opp: Opportunity = {
    id: "test-3",
    strategy: "static_arb",
    marketIds: ["market-a"],
    evBps: -10,
    confidence: 0.8,
    ttlMs: 10_000,
    createdAt: Date.now(),
  }

  const decision = engine.preTradeCheck(opp, state)
  assert.equal(decision.allow, false)
  assert.equal(decision.reason, "NON_POSITIVE_EV")
})

test("consecutive-fail - counts consecutive failures", () => {
  let state = createDefaultRiskState(10_000)

  const failResult: ExecutionResult = {
    opportunityId: "opp-1",
    marketId: "market-a",
    strategy: "static_arb",
    success: false,
    pnl: -10,
    slippageBps: 100,
    ts: Date.now(),
    reason: "incomplete_legs",
  }

  state = updateConsecutiveFails(failResult, state)
  assert.equal(state.consecutiveFails, 1)

  const strategyFails = state.consecutiveFailsByStrategy.get("static_arb")
  assert.equal(strategyFails, 1)

  state = updateConsecutiveFails(failResult, state)
  state = updateConsecutiveFails(failResult, state)
  assert.equal(state.consecutiveFails, 3)
})

test("consecutive-fail - resets on success", () => {
  let state = createDefaultRiskState(10_000)

  const failResult: ExecutionResult = {
    opportunityId: "opp-1",
    marketId: "market-a",
    strategy: "static_arb",
    success: false,
    pnl: -10,
    slippageBps: 100,
    ts: Date.now(),
    reason: "incomplete_legs",
  }

  state = updateConsecutiveFails(failResult, state)
  state = updateConsecutiveFails(failResult, state)
  assert.equal(state.consecutiveFails, 2)

  const successResult: ExecutionResult = {
    opportunityId: "opp-2",
    marketId: "market-a",
    strategy: "static_arb",
    success: true,
    pnl: 50,
    slippageBps: 20,
    ts: Date.now(),
  }

  state = updateConsecutiveFails(successResult, state)
  assert.equal(state.consecutiveFails, 0)
  assert.equal(state.consecutiveFailsByStrategy.has("static_arb"), false)
})

test("consecutive-fail - triggers pause at threshold", () => {
  const config = getDefaultRiskConfig(10_000)
  const state = createDefaultRiskState(10_000)
  state.consecutiveFails = 5
  state.lastFailTime = Date.now() - 1000

  const check = checkConsecutiveFail(state, config)
  assert.equal(check.shouldPause, true)
  assert.ok(check.reason?.includes("CONSECUTIVE_FAILS"))
})

test("consecutive-fail - resets after cooldown", () => {
  const config = getDefaultRiskConfig(10_000)
  const state = createDefaultRiskState(10_000)
  state.consecutiveFails = 5
  state.lastFailTime = Date.now() - config.failCooldownMs - 1000

  const check = checkConsecutiveFail(state, config, Date.now())
  assert.equal(check.shouldPause, false)
})

test("consecutive-fail - manual reset", () => {
  let state = createDefaultRiskState(10_000)
  state.consecutiveFails = 10
  state.consecutiveFailsByStrategy.set("static_arb", 10)

  state = resetConsecutiveFail(state)
  assert.equal(state.consecutiveFails, 0)
  assert.equal(state.consecutiveFailsByStrategy.size, 0)
})

test("correlation-risk - builds correlation matrix", () => {
  const priceHistory = new Map<string, number[]>()
  priceHistory.set("market-a", [0.5, 0.52, 0.51, 0.53, 0.55])
  priceHistory.set("market-b", [0.3, 0.32, 0.31, 0.33, 0.35])
  priceHistory.set("market-c", [0.5, 0.48, 0.49, 0.47, 0.45])

  const matrix = buildCorrelationMatrix(priceHistory)

  assert.ok(matrix.has("market-a"))
  assert.ok(matrix.has("market-b"))
  assert.ok(matrix.has("market-c"))

  assert.equal(matrix.get("market-a")?.get("market-a"), 1.0)

  const corrAB = matrix.get("market-a")?.get("market-b") || 0
  assert.ok(corrAB >= -1 && corrAB <= 1)
})

test("correlation-risk - computes combined exposure", () => {
  const positions: Position[] = [
    {
      marketId: "market-a",
      side: "YES",
      size: 100,
      avgEntry: 0.5,
      currentPrice: 0.52,
      unrealizedPnl: 2,
    },
    {
      marketId: "market-b",
      side: "YES",
      size: 50,
      avgEntry: 0.3,
      currentPrice: 0.35,
      unrealizedPnl: 2.5,
    },
  ]

  const correlations = new Map<string, Map<string, number>>()
  correlations.set("market-a", new Map([["market-b", 0.8]]))
  correlations.set("market-b", new Map([["market-a", 0.8]]))

  const exposure = computeCombinedExposure(positions, correlations)
  assert.ok(exposure > 0)

  const simpleSum = 100 * 0.52 + 50 * 0.35
  assert.ok(exposure >= simpleSum)
})

test("correlation-risk - detects correlated positions", () => {
  const state = createDefaultRiskState(10_000)
  state.positions.set("market-a", {
    marketId: "market-a",
    side: "YES",
    size: 100,
    avgEntry: 0.5,
    currentPrice: 0.52,
    unrealizedPnl: 2,
  })

  const config = getDefaultRiskConfig(10_000)
  config.correlationMatrix.set("market-a", new Map([["market-b", 0.8]]))
  config.correlationMatrix.set("market-b", new Map([["market-a", 0.8]]))

  const opp: Opportunity = {
    id: "test-corr",
    strategy: "stat_arb",
    marketIds: ["market-b"],
    evBps: 30,
    confidence: 0.6,
    ttlMs: 5_000,
    createdAt: Date.now(),
  }

  const result = checkCorrelationRisk(state, opp, config)
  assert.equal(result.hasRisk, true)
  assert.ok(result.warning?.includes("CORRELATED"))
})

test("slippage-calibration - updates stats", () => {
  const stats = new Map<string, SlippageStats>()

  const feedback: SlippageFeedback = {
    marketId: "market-a",
    strategy: "static_arb",
    expectedSlippageBps: 30,
    actualSlippageBps: 50,
    ts: Date.now(),
  }

  const updated = updateSlippageStats(feedback, stats)
  const key = "market-a:static_arb"
  assert.ok(updated.has(key))

  const stat = updated.get(key)!
  assert.equal(stat.count, 1)
  assert.equal(stat.meanBps, 50)
})

test("slippage-calibration - accumulates samples", () => {
  let stats = new Map<string, SlippageStats>()

  for (let i = 0; i < 50; i++) {
    const feedback: SlippageFeedback = {
      marketId: "market-a",
      strategy: "static_arb",
      expectedSlippageBps: 30,
      actualSlippageBps: 30 + Math.random() * 40,
      ts: Date.now() + i,
    }
    stats = updateSlippageStats(feedback, stats)
  }

  const key = "market-a:static_arb"
  const stat = stats.get(key)!
  assert.equal(stat.count, 50)
  assert.ok(stat.meanBps > 30)
  assert.ok(stat.stdBps > 0)
  assert.ok(stat.p95Bps >= stat.meanBps)
  assert.ok(stat.p99Bps >= stat.p95Bps)
})

test("slippage-calibration - returns adjustment", () => {
  const stats = new Map<string, SlippageStats>()
  stats.set("market-a:static_arb", {
    marketId: "market-a",
    strategy: "static_arb",
    count: 100,
    meanBps: 40,
    stdBps: 15,
    p95Bps: 65,
    p99Bps: 80,
    lastUpdate: Date.now(),
    samples: Array.from({ length: 100 }, () => 40),
  })

  const adjustment = getSlippageAdjustment("market-a", "static_arb", stats)
  assert.equal(adjustment, 65)

  const noData = getSlippageAdjustment("unknown", "unknown", stats)
  assert.equal(noData, 0)
})

test("slippage-calibration - detects anomaly", () => {
  const stats = new Map<string, SlippageStats>()
  stats.set("market-a:static_arb", {
    marketId: "market-a",
    strategy: "static_arb",
    count: 100,
    meanBps: 40,
    stdBps: 10,
    p95Bps: 60,
    p99Bps: 70,
    lastUpdate: Date.now(),
    samples: Array.from({ length: 100 }, () => 40),
  })

  const normalFeedback: SlippageFeedback = {
    marketId: "market-a",
    strategy: "static_arb",
    expectedSlippageBps: 30,
    actualSlippageBps: 45,
    ts: Date.now(),
  }
  const normalCheck = checkSlippageAnomaly(normalFeedback, stats)
  assert.equal(normalCheck.isAnomaly, false)

  const anomalyFeedback: SlippageFeedback = {
    marketId: "market-a",
    strategy: "static_arb",
    expectedSlippageBps: 30,
    actualSlippageBps: 100,
    ts: Date.now(),
  }
  const anomalyCheck = checkSlippageAnomaly(anomalyFeedback, stats)
  assert.equal(anomalyCheck.isAnomaly, true)
})

test("drawdown - detects breach", () => {
  const config = getDefaultRiskConfig(10_000)

  const normalState = createDefaultRiskState(10_000)
  const normalCheck = checkDrawdown(normalState, config)
  assert.equal(normalCheck.isBreached, false)

  const breachedState = createDefaultRiskState(10_000)
  breachedState.equity = 9_500
  breachedState.peakEquity = 10_000
  breachedState.drawdown = 0.05
  const breachedCheck = checkDrawdown(breachedState, config)
  assert.equal(breachedCheck.isBreached, true)
  assert.equal(breachedCheck.severity, "critical")
})

test("drawdown - detects warning", () => {
  const config = getDefaultRiskConfig(10_000)

  const warningState = createDefaultRiskState(10_000)
  warningState.equity = 9_700
  warningState.peakEquity = 10_000
  warningState.drawdown = 0.03

  const check = checkDrawdown(warningState, config)
  assert.equal(check.isBreached, false)
  assert.equal(check.severity, "warning")
})

test("intraday-loss - detects breach", () => {
  const config = getDefaultRiskConfig(10_000)

  const breachedState = createDefaultRiskState(10_000)
  breachedState.intradayPnl = -300

  const check = checkIntradayLoss(breachedState, config)
  assert.equal(check.isBreached, true)
})

test("kill-switch - triggers on combined checks", () => {
  const config = getDefaultRiskConfig(10_000)

  const safeState = createDefaultRiskState(10_000)
  const safeCheck = shouldTriggerKillSwitch(safeState, config)
  assert.equal(safeCheck.trigger, false)

  const dangerState = createDefaultRiskState(10_000)
  dangerState.equity = 9_500
  dangerState.peakEquity = 10_000
  dangerState.drawdown = 0.05
  dangerState.killSwitch = true

  const dangerCheck = shouldTriggerKillSwitch(dangerState, config)
  assert.equal(dangerCheck.trigger, true)
})

test("RiskEngineEnhanced - onTradeResult updates state", () => {
  const config = getDefaultRiskConfig(10_000)
  const engine = new RiskEngineEnhanced(config)
  let state = createDefaultRiskState(10_000)

  const result: ExecutionResult = {
    opportunityId: "opp-1",
    marketId: "market-a",
    strategy: "static_arb",
    success: false,
    pnl: -50,
    slippageBps: 80,
    ts: Date.now(),
    reason: "incomplete_legs",
  }

  state = engine.onTradeResult(result, state)

  assert.equal(state.consecutiveFails, 1)
  assert.equal(state.intradayPnl, -50)
})

test("RiskEngineEnhanced - onSlippageFeedback updates stats", () => {
  const config = getDefaultRiskConfig(10_000)
  const engine = new RiskEngineEnhanced(config)
  let state = createDefaultRiskState(10_000)

  const feedback: SlippageFeedback = {
    marketId: "market-a",
    strategy: "static_arb",
    expectedSlippageBps: 30,
    actualSlippageBps: 60,
    ts: Date.now(),
  }

  state = engine.onSlippageFeedback(feedback, state)

  const key = "market-a:static_arb"
  assert.ok(state.slippageStats.has(key))
  assert.equal(state.slippageStats.get(key)?.count, 1)
})

test("RiskEngineEnhanced - trigger and release kill switch", () => {
  const config = getDefaultRiskConfig(10_000)
  const engine = new RiskEngineEnhanced(config)
  let state = createDefaultRiskState(10_000)

  state = engine.triggerKillSwitch(state, "TEST_TRIGGER")
  assert.equal(state.killSwitch, true)
  assert.equal(state.killSwitchReason, "TEST_TRIGGER")

  state = engine.releaseKillSwitch(state)
  assert.equal(state.killSwitch, false)
  assert.equal(state.killSwitchReason, undefined)
})

test("RiskEngineEnhanced - consecutive fail triggers restriction", () => {
  const config = getConservativeRiskConfig(10_000)
  config.consecutiveFailThreshold = 3
  const engine = new RiskEngineEnhanced(config)
  let state = createDefaultRiskState(10_000)

  for (let i = 0; i < 4; i++) {
    const failResult: ExecutionResult = {
      opportunityId: `opp-${i}`,
      marketId: "market-a",
      strategy: "static_arb",
      success: false,
      pnl: -10,
      slippageBps: 100,
      ts: Date.now(),
      reason: "incomplete_legs",
    }
    state = engine.onTradeResult(failResult, state)
  }

  const opp: Opportunity = {
    id: "test-restricted",
    strategy: "static_arb",
    marketIds: ["market-a"],
    evBps: 50,
    confidence: 0.8,
    ttlMs: 10_000,
    createdAt: Date.now(),
  }

  const decision = engine.preTradeCheck(opp, state)
  assert.equal(decision.allow, false)
  assert.ok(decision.reason?.includes("CONSECUTIVE"))
})

test("RiskEngineEnhanced - position exposure update", () => {
  const config = getDefaultRiskConfig(10_000)
  const engine = new RiskEngineEnhanced(config)
  let state = createDefaultRiskState(10_000)

  const positions = new Map<string, Position>()
  positions.set("market-a:YES", {
    marketId: "market-a",
    side: "YES",
    size: 100,
    avgEntry: 0.5,
    currentPrice: 0.52,
    unrealizedPnl: 2,
  })

  state = engine.updatePositions(state, positions)

  assert.equal(state.openExposure, 52)
  assert.ok(state.positions.size === 1)
})

test("RiskEngineEnhanced - equity update", () => {
  const config = getDefaultRiskConfig(10_000)
  const engine = new RiskEngineEnhanced(config)
  let state = createDefaultRiskState(10_000)

  state = engine.updateEquity(state, 10_500)
  assert.equal(state.equity, 10_500)
  assert.equal(state.peakEquity, 10_500)
  assert.equal(state.drawdown, 0)

  state = engine.updateEquity(state, 9_800)
  assert.equal(state.equity, 9_800)
  assert.equal(state.peakEquity, 10_500)
  assert.ok(state.drawdown > 0)
})

test("correlation-risk - calculateCorrelation", () => {
  const pricesA = [0.5, 0.52, 0.51, 0.53, 0.55]
  const pricesB = [0.5, 0.52, 0.51, 0.53, 0.55]

  const corr = calculateCorrelation(pricesA, pricesB)
  assert.ok(Math.abs(corr - 1) < 0.01)

  const pricesC = [0.5, 0.48, 0.49, 0.47, 0.45]
  const corrNeg = calculateCorrelation(pricesA, pricesC)
  assert.ok(corrNeg < 0)
})

test("integration - multi-market scenario", () => {
  const config = getDefaultRiskConfig(10_000)
  config.maxCombinedExposure = 3_000

  const correlations = new Map<string, Map<string, number>>()
  correlations.set("market-a", new Map([["market-b", 0.9]]))
  correlations.set("market-b", new Map([["market-a", 0.9]]))
  config.correlationMatrix = correlations

  const engine = new RiskEngineEnhanced(config)
  let state = createDefaultRiskState(10_000)

  state.positions.set("market-a:YES", {
    marketId: "market-a",
    side: "YES",
    size: 100,
    avgEntry: 0.5,
    currentPrice: 0.55,
    unrealizedPnl: 5,
  })
  state.openExposure = 55

  const opp: Opportunity = {
    id: "multi-test",
    strategy: "stat_arb",
    marketIds: ["market-b"],
    evBps: 40,
    confidence: 0.7,
    ttlMs: 10_000,
    createdAt: Date.now(),
  }

  const decision = engine.preTradeCheck(opp, state)
  assert.ok(decision.correlationWarning === true)
  assert.ok(decision.warnings.some((w) => w.includes("CORRELATED")))
})

test("edge case - empty positions", () => {
  const config = getDefaultRiskConfig(10_000)
  const positions: Position[] = []

  const exposure = computeCombinedExposure(positions, new Map())
  assert.equal(exposure, 0)
})

test("edge case - no slippage data", () => {
  const stats = new Map<string, SlippageStats>()

  const adjustment = getSlippageAdjustment("unknown", "unknown", stats)
  assert.equal(adjustment, 0)
})

test("edge case - single price point", () => {
  const corr = calculateCorrelation([0.5], [0.3])
  assert.equal(corr, 0)
})

type SlippageStats = {
  marketId: string
  strategy: string
  count: number
  meanBps: number
  stdBps: number
  p95Bps: number
  p99Bps: number
  lastUpdate: number
  samples: number[]
}
