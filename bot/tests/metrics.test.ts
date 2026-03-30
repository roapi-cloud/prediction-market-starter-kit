import test from "node:test"
import assert from "node:assert/strict"
import { MetricsCollectorEnhanced } from "../metrics/enhanced"
import { MetricsPersistence } from "../metrics/persistence"
import type { EngineState, MetricsSnapshot } from "../contracts/types"
import { existsSync, rmSync, mkdirSync } from "node:fs"

const TEST_DATA_DIR = "./test-metrics-data"

function createMockEngineState(): EngineState {
  const strategyMetrics = new Map<
    string,
    { size: number; avgEntry: number; currentPrice: number }
  >()
  strategyMetrics.set("market1:YES", {
    size: 10,
    avgEntry: 0.5,
    currentPrice: 0.55,
  })

  return {
    equity: 10000,
    cash: 5000,
    totalPnl: 100,
    drawdownPct: 1.5,
    openNotional: 500,
    orderCount: 20,
    fillCount: 18,
    partialCount: 2,
    totalSlippageCost: 0.5,
    positions: strategyMetrics,
    orders: [
      {
        id: "order-1",
        ts: 1000,
        marketId: "market1",
        status: "FILLED",
        filledSize: 10,
        pnl: 5,
      },
      {
        id: "order-2",
        ts: 2000,
        marketId: "market2",
        status: "FILLED",
        filledSize: 8,
        pnl: -2,
      },
      {
        id: "order-3",
        ts: 3000,
        marketId: "market3",
        status: "PARTIAL",
        filledSize: 5,
        pnl: 1,
      },
    ],
    strategyEvents: [
      {
        strategy: "static_arb",
        marketId: "market1",
        ts: 1000,
        type: "opportunity",
        evBps: 10,
      },
      {
        strategy: "static_arb",
        marketId: "market1",
        ts: 1100,
        type: "executed",
        evBps: 10,
        pnl: 5,
        success: true,
      },
      {
        strategy: "stat_arb",
        marketId: "market2",
        ts: 2000,
        type: "opportunity",
        evBps: 8,
      },
      {
        strategy: "stat_arb",
        marketId: "market2",
        ts: 2100,
        type: "executed",
        evBps: 8,
        pnl: -2,
        success: false,
      },
    ],
    riskState: "normal",
  }
}

test.before(() => {
  if (existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true })
  }
  mkdirSync(TEST_DATA_DIR, { recursive: true })
})

test.after(() => {
  if (existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true })
  }
})

test("MetricsCollectorEnhanced collects metrics from engine state", () => {
  const collector = new MetricsCollectorEnhanced({
    collectionIntervalMs: 1000,
    persistenceEnabled: false,
    persistencePath: TEST_DATA_DIR,
    pushEnabled: false,
  })

  const state = createMockEngineState()
  const snapshot = collector.collect(state)

  assert.ok(snapshot.ts > 0)
  assert.equal(snapshot.pnl, 100)
  assert.ok(snapshot.pnlPct > 0)
  assert.equal(snapshot.drawdownPct, 1.5)
  assert.equal(snapshot.riskState, "normal")
  assert.ok(snapshot.strategyMetrics.size > 0)
})

test("MetricsCollectorEnhanced computes strategy metrics correctly", () => {
  const collector = new MetricsCollectorEnhanced({
    collectionIntervalMs: 1000,
    persistenceEnabled: false,
    persistencePath: TEST_DATA_DIR,
    pushEnabled: false,
  })

  const events = [
    {
      strategy: "static_arb",
      marketId: "m1",
      ts: 1000,
      type: "opportunity" as const,
      evBps: 10,
    },
    {
      strategy: "static_arb",
      marketId: "m1",
      ts: 1100,
      type: "executed" as const,
      evBps: 10,
      pnl: 5,
      success: true,
    },
    {
      strategy: "static_arb",
      marketId: "m2",
      ts: 2000,
      type: "executed" as const,
      evBps: 8,
      pnl: -2,
      success: false,
    },
  ]

  const metrics = collector.collectStrategyMetrics("static_arb", events)

  assert.equal(metrics.opportunities, 1)
  assert.equal(metrics.executed, 2)
  assert.equal(metrics.pnl, 3)
})

test("MetricsPersistence persists and loads snapshots", () => {
  const persistence = new MetricsPersistence(TEST_DATA_DIR)

  const snapshot: MetricsSnapshot = {
    ts: 1000,
    pnl: 100,
    pnlPct: 1,
    drawdown: 0,
    drawdownPct: 0,
    winRate: 0.5,
    legCompletionRate: 0.95,
    avgSlippageBps: 10,
    avgDelayMs: 100,
    orderFillRate: 0.9,
    hedgeSuccessRate: 1,
    dataLatencyMs: 50,
    eventThroughput: 10,
    activeStrategies: 2,
    riskState: "normal",
    strategyMetrics: new Map([
      [
        "static_arb",
        { opportunities: 10, executed: 8, pnl: 50, avgEvBps: 10, winRate: 0.6 },
      ],
    ]),
  }

  persistence.persist(snapshot)
  const loaded = persistence.loadRange(0, 2000)
  assert.equal(loaded.length, 1)
  assert.equal(loaded[0].pnl, 100)
})

test("MetricsCollectorEnhanced aggregates by minute", () => {
  const collector = new MetricsCollectorEnhanced({
    collectionIntervalMs: 1000,
    persistenceEnabled: false,
    persistencePath: TEST_DATA_DIR,
    pushEnabled: false,
  })

  const baseTs = 1000000
  const snapshots: MetricsSnapshot[] = []
  for (let i = 0; i < 5; i++) {
    snapshots.push({
      ts: baseTs + i * 1000,
      pnl: 100 + i * 10,
      pnlPct: 1 + i * 0.1,
      drawdown: 0,
      drawdownPct: 0,
      winRate: 0.5,
      legCompletionRate: 0.95,
      avgSlippageBps: 10,
      avgDelayMs: 100,
      orderFillRate: 0.9,
      hedgeSuccessRate: 1,
      dataLatencyMs: 50,
      eventThroughput: 10,
      activeStrategies: 2,
      riskState: "normal",
      strategyMetrics: new Map(),
    })
  }

  const aggregated = collector.aggregateByMinute(snapshots)
  assert.equal(aggregated.size, 1)
})

test("MetricsCollectorEnhanced computes Sharpe ratio", () => {
  const collector = new MetricsCollectorEnhanced({
    collectionIntervalMs: 1000,
    persistenceEnabled: false,
    persistencePath: TEST_DATA_DIR,
    pushEnabled: false,
  })

  const snapshots: MetricsSnapshot[] = []
  for (let i = 0; i < 10; i++) {
    snapshots.push({
      ts: 1000000 + i * 1000,
      pnl: 100 + Math.random() * 50,
      pnlPct: 1 + Math.random() * 0.5,
      drawdown: 0,
      drawdownPct: 0,
      winRate: 0.5,
      legCompletionRate: 0.95,
      avgSlippageBps: 10,
      avgDelayMs: 100,
      orderFillRate: 0.9,
      hedgeSuccessRate: 1,
      dataLatencyMs: 50,
      eventThroughput: 10,
      activeStrategies: 2,
      riskState: "normal",
      strategyMetrics: new Map(),
    })
  }

  const sharpe = collector.computeSharpeRatio(snapshots)
  assert.ok(typeof sharpe === "number")
})
