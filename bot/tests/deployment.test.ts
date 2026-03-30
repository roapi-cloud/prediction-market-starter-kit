import test from "node:test"
import assert from "node:assert/strict"
import { DeploymentManager } from "../deployment/manager"
import {
  checkPaperCriteria,
  checkGrayscaleCriteria,
  computeConfidenceScore,
  DEFAULT_PASS_CRITERIA,
} from "../deployment/criteria"
import type { MetricsSnapshot } from "../contracts/types"
import { existsSync, rmSync, mkdirSync } from "node:fs"

const TEST_DATA_DIR = "./test-deployment-data"

function createMockSnapshot(
  overrides: Partial<MetricsSnapshot> = {}
): MetricsSnapshot {
  return {
    ts: Date.now(),
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
        { opportunities: 10, executed: 9, pnl: 50, avgEvBps: 10, winRate: 0.6 },
      ],
    ]),
    ...overrides,
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

test("DeploymentManager starts in paper stage by default", () => {
  const manager = new DeploymentManager({}, `${TEST_DATA_DIR}/state1.json`)
  assert.equal(manager.getStage(), "paper")
})

test("DeploymentManager returns zero capital for paper stage", () => {
  const manager = new DeploymentManager({}, `${TEST_DATA_DIR}/state2.json`)
  assert.equal(manager.getCapitalLimitPct(), 0)
})

test("DeploymentManager returns grayscale capital for grayscale stage", () => {
  const manager = new DeploymentManager(
    { stage: "grayscale" },
    `${TEST_DATA_DIR}/state3.json`
  )
  assert.equal(manager.getCapitalLimitPct(), 0.05)
})

test("DeploymentManager records kill switch triggers", () => {
  const manager = new DeploymentManager({}, `${TEST_DATA_DIR}/state4.json`)
  manager.recordKillSwitch()
  manager.recordKillSwitch()
  const status = manager.getStatus()
  assert.equal(status.criteriaMet, false)
})

test("DeploymentManager can rollback to grayscale from production", () => {
  const manager = new DeploymentManager(
    { stage: "production" },
    `${TEST_DATA_DIR}/state5.json`
  )
  manager.rollbackToGrayscale()
  assert.equal(manager.getStage(), "grayscale")
})

test("DeploymentManager can rollback to paper from grayscale", () => {
  const manager = new DeploymentManager(
    { stage: "grayscale" },
    `${TEST_DATA_DIR}/state6.json`
  )
  manager.rollbackToPaper()
  assert.equal(manager.getStage(), "paper")
})

test("DeploymentManager updates capital limit", () => {
  const manager = new DeploymentManager({}, `${TEST_DATA_DIR}/state7.json`)
  manager.updateCapitalLimit(0.5)
  manager.forceAdvance("production")
  assert.equal(manager.getCapitalLimitPct(), 0.5)
})

test("DeploymentManager computes confidence score", () => {
  const manager = new DeploymentManager({}, `${TEST_DATA_DIR}/state8.json`)
  for (let i = 0; i < 10; i++) {
    manager.addSnapshot(createMockSnapshot({ legCompletionRate: 0.97 }))
  }
  const score = manager.getConfidenceScore()
  assert.ok(score >= 0)
  assert.ok(score <= 1)
})

test("checkPaperCriteria passes with good metrics", () => {
  const snapshots = [
    createMockSnapshot({ legCompletionRate: 0.97 }),
    createMockSnapshot({ legCompletionRate: 0.98 }),
    createMockSnapshot({ legCompletionRate: 0.96 }),
  ]
  const result = checkPaperCriteria(snapshots, DEFAULT_PASS_CRITERIA)
  assert.equal(result.passed, true)
  assert.equal(result.reasons.length, 0)
})

test("checkPaperCriteria fails with low leg completion", () => {
  const snapshots = [
    createMockSnapshot({ legCompletionRate: 0.8 }),
    createMockSnapshot({ legCompletionRate: 0.85 }),
  ]
  const result = checkPaperCriteria(snapshots, DEFAULT_PASS_CRITERIA)
  assert.equal(result.passed, false)
  assert.ok(result.reasons.length > 0)
})

test("checkGrayscaleCriteria passes with good metrics", () => {
  const snapshots = [
    createMockSnapshot({ drawdownPct: 2 }),
    createMockSnapshot({ drawdownPct: 3 }),
  ]
  const result = checkGrayscaleCriteria(snapshots, 0, DEFAULT_PASS_CRITERIA)
  assert.equal(result.passed, true)
})

test("checkGrayscaleCriteria fails with too many kill switches", () => {
  const snapshots = [createMockSnapshot()]
  const result = checkGrayscaleCriteria(snapshots, 5, DEFAULT_PASS_CRITERIA)
  assert.equal(result.passed, false)
  assert.ok(result.reasons.some((r) => r.includes("Kill switch")))
})

test("computeConfidenceScore computes correctly", () => {
  const snapshots = [
    createMockSnapshot({
      legCompletionRate: 0.97,
      winRate: 0.6,
      drawdownPct: 1,
    }),
    createMockSnapshot({
      legCompletionRate: 0.98,
      winRate: 0.7,
      drawdownPct: 2,
    }),
  ]
  const score = computeConfidenceScore(snapshots, DEFAULT_PASS_CRITERIA)
  assert.ok(score > 0.5)
})
