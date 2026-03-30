import test from "node:test"
import assert from "node:assert/strict"
import { ReportGenerator } from "../report/generator"
import { generateDailyReport, formatDailyReport } from "../report/daily"
import type {
  MetricsSnapshot,
  AlertEvent,
  RiskEventSummary,
} from "../contracts/types"
import { existsSync, rmSync, mkdirSync } from "node:fs"

const TEST_DATA_DIR = "./test-report-data"

function createMockSnapshot(
  overrides: Partial<MetricsSnapshot> = {}
): MetricsSnapshot {
  const strategyMetrics = new Map<
    string,
    {
      opportunities: number
      executed: number
      pnl: number
      avgEvBps: number
      winRate: number
    }
  >()
  strategyMetrics.set("static_arb", {
    opportunities: 10,
    executed: 8,
    pnl: 50,
    avgEvBps: 10,
    winRate: 0.6,
  })
  strategyMetrics.set("stat_arb", {
    opportunities: 5,
    executed: 4,
    pnl: 30,
    avgEvBps: 8,
    winRate: 0.5,
  })

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
    strategyMetrics,
    ...overrides,
  }
}

function createMockAlert(): AlertEvent {
  return {
    id: "alert-1",
    rule: "intraday_loss_threshold",
    severity: "warning",
    message: "Test alert",
    ts: Date.now(),
    value: -3,
    threshold: -2,
    acknowledged: false,
  }
}

function createMockRiskEvent(): RiskEventSummary {
  return {
    ts: Date.now(),
    type: "kill_switch",
    description: "Kill switch triggered",
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

test("ReportGenerator generates daily report from snapshots", () => {
  const generator = new ReportGenerator()
  for (let i = 0; i < 5; i++) {
    generator.addSnapshot(
      createMockSnapshot({ pnl: 100 + i * 10, pnlPct: 1 + i * 0.1 })
    )
  }
  const date = new Date().toISOString().slice(0, 10)
  const report = generator.generateDaily(date)
  assert.equal(report.date, date)
  assert.ok(report.summary.pnl > 0)
  assert.ok(report.strategyBreakdown.size > 0)
})

test("ReportGenerator includes alerts in daily report", () => {
  const generator = new ReportGenerator()
  generator.addSnapshot(createMockSnapshot())
  generator.addAlert(createMockAlert())
  const date = new Date().toISOString().slice(0, 10)
  const report = generator.generateDaily(date)
  assert.ok(report.alerts.length > 0)
})

test("ReportGenerator includes risk events in daily report", () => {
  const generator = new ReportGenerator()
  generator.addSnapshot(createMockSnapshot())
  generator.addRiskEvent(createMockRiskEvent())
  const date = new Date().toISOString().slice(0, 10)
  const report = generator.generateDaily(date)
  assert.ok(report.riskEvents.length > 0)
})

test("ReportGenerator exports report as JSON", () => {
  const generator = new ReportGenerator()
  generator.addSnapshot(createMockSnapshot())
  const date = new Date().toISOString().slice(0, 10)
  const report = generator.generateDaily(date)
  const json = generator.exportReport(report, "json")
  assert.ok(json.includes('"date"'))
  assert.ok(json.includes('"summary"'))
})

test("ReportGenerator exports report as HTML", () => {
  const generator = new ReportGenerator()
  generator.addSnapshot(createMockSnapshot())
  const date = new Date().toISOString().slice(0, 10)
  const report = generator.generateDaily(date)
  const html = generator.exportReport(report, "html")
  assert.ok(html.includes("<!DOCTYPE html>"))
  assert.ok(html.includes("<h1>"))
})

test("ReportGenerator exports report as CSV", () => {
  const generator = new ReportGenerator()
  generator.addSnapshot(createMockSnapshot())
  const date = new Date().toISOString().slice(0, 10)
  const report = generator.generateDaily(date)
  const csv = generator.exportReport(report, "csv")
  assert.ok(csv.includes("metric,value"))
  assert.ok(csv.includes("pnl,"))
})

test("generateDailyReport handles empty snapshots", () => {
  const date = new Date().toISOString().slice(0, 10)
  const report = generateDailyReport([], date)
  assert.equal(report.summary.pnl, 0)
  assert.equal(report.strategyBreakdown.size, 0)
})

test("formatDailyReport formats report as text", () => {
  const strategyMetrics = new Map<
    string,
    {
      opportunities: number
      executed: number
      pnl: number
      avgEvBps: number
      winRate: number
    }
  >()
  strategyMetrics.set("static_arb", {
    opportunities: 10,
    executed: 8,
    pnl: 50,
    avgEvBps: 10,
    winRate: 0.6,
  })

  const snapshot: MetricsSnapshot = {
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
    strategyMetrics,
  }

  const date = new Date().toISOString().slice(0, 10)
  const report = generateDailyReport([snapshot], date)
  const formatted = formatDailyReport(report)
  assert.ok(formatted.includes("Daily Report"))
  assert.ok(formatted.includes("Summary:"))
})
