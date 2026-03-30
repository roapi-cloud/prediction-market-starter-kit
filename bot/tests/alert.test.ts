import test from "node:test"
import assert from "node:assert/strict"
import { AlertSystem } from "../alert/system"
import {
  DEFAULT_ALERT_RULES,
  evaluateRule,
  formatMessage,
} from "../alert/rules"
import type { MetricsSnapshot } from "../contracts/types"
import { existsSync, rmSync, mkdirSync } from "node:fs"

const TEST_LOG_DIR = "./test-logs"

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
    strategyMetrics: new Map(),
    ...overrides,
  }
}

test.before(() => {
  if (existsSync(TEST_LOG_DIR)) {
    rmSync(TEST_LOG_DIR, { recursive: true })
  }
  mkdirSync(TEST_LOG_DIR, { recursive: true })
})

test.after(() => {
  if (existsSync(TEST_LOG_DIR)) {
    rmSync(TEST_LOG_DIR, { recursive: true })
  }
})

test("AlertSystem detects intraday loss threshold", () => {
  const alertSystem = new AlertSystem({
    rules: DEFAULT_ALERT_RULES,
    channels: [{ type: "log", enabled: true }],
    cooldownMs: 0,
  })

  const snapshot = createMockSnapshot({ pnlPct: -3 })
  const alerts = alertSystem.check(snapshot)

  assert.ok(alerts.length > 0)
  assert.ok(alerts.some((a) => a.rule === "intraday_loss_threshold"))
})

test("AlertSystem detects high drawdown", () => {
  const alertSystem = new AlertSystem({
    rules: DEFAULT_ALERT_RULES,
    channels: [{ type: "log", enabled: true }],
    cooldownMs: 0,
  })

  const snapshot = createMockSnapshot({ drawdownPct: 5 })
  const alerts = alertSystem.check(snapshot)

  assert.ok(alerts.some((a) => a.rule === "drawdown_threshold"))
})

test("AlertSystem detects kill switch triggered", () => {
  const alertSystem = new AlertSystem({
    rules: DEFAULT_ALERT_RULES,
    channels: [{ type: "log", enabled: true }],
    cooldownMs: 0,
  })

  const snapshot = createMockSnapshot({ riskState: "kill_switch" })
  const alerts = alertSystem.check(snapshot)

  assert.ok(alerts.some((a) => a.rule === "kill_switch_triggered"))
})

test("AlertSystem respects cooldown period", () => {
  const alertSystem = new AlertSystem({
    rules: DEFAULT_ALERT_RULES,
    channels: [{ type: "log", enabled: true }],
    cooldownMs: 10000,
  })

  const snapshot = createMockSnapshot({ pnlPct: -3 })
  const alerts1 = alertSystem.check(snapshot)
  assert.ok(alerts1.length > 0)

  const alerts2 = alertSystem.check(snapshot)
  assert.equal(alerts2.length, 0)
})

test("AlertSystem acknowledges alerts", () => {
  const alertSystem = new AlertSystem({
    rules: DEFAULT_ALERT_RULES,
    channels: [{ type: "log", enabled: true }],
    cooldownMs: 0,
  })

  const snapshot = createMockSnapshot({ pnlPct: -3 })
  const alerts = alertSystem.check(snapshot)
  assert.ok(alerts.length > 0)

  alertSystem.acknowledge(alerts[0].id)
  const active = alertSystem.getActiveAlerts()
  assert.equal(active.length, alerts.length - 1)
})

test("AlertSystem clears cooldowns", () => {
  const alertSystem = new AlertSystem({
    rules: DEFAULT_ALERT_RULES,
    channels: [{ type: "log", enabled: true }],
    cooldownMs: 10000,
  })

  const snapshot = createMockSnapshot({ pnlPct: -3 })
  alertSystem.check(snapshot)
  alertSystem.clearCooldowns()
  const alerts = alertSystem.check(snapshot)
  assert.ok(alerts.length > 0)
})

test("AlertSystem adds custom rules", () => {
  const alertSystem = new AlertSystem({
    rules: [],
    channels: [{ type: "log", enabled: true }],
    cooldownMs: 0,
  })

  alertSystem.addCustomRule({
    name: "custom_pnl_threshold",
    metric: "pnl",
    condition: "lt",
    threshold: 0,
    severity: "warning",
    message: "PnL below zero",
  })

  const snapshot = createMockSnapshot({ pnl: -10 })
  const alerts = alertSystem.check(snapshot)
  assert.ok(alerts.some((a) => a.rule === "custom_pnl_threshold"))
})

test("evaluateRule evaluates gt condition correctly", () => {
  const rule = DEFAULT_ALERT_RULES.find((r) => r.name === "drawdown_threshold")!
  assert.equal(evaluateRule(rule, 3), false)
  assert.equal(evaluateRule(rule, 5), true)
})

test("evaluateRule evaluates lt condition correctly", () => {
  const rule = DEFAULT_ALERT_RULES.find(
    (r) => r.name === "intraday_loss_threshold"
  )!
  assert.equal(evaluateRule(rule, -1), false)
  assert.equal(evaluateRule(rule, -3), true)
})

test("formatMessage formats messages with values", () => {
  const message = formatMessage(
    "Value: {{value}}, Threshold: {{threshold}}",
    5,
    10
  )
  assert.equal(message, "Value: 5, Threshold: 10")
})
