import type {
  BacktestResultEnhanced,
  BacktestReport,
  ExecutionEvent,
  RiskEventBacktest,
} from "../contracts/types"

export function generateReport(
  summary: BacktestResultEnhanced,
  pnlCurve: Array<{ ts: number; pnl: number; equity: number }>,
  executionEvents: ExecutionEvent[],
  riskEvents: RiskEventBacktest[],
  mcDistribution: Array<{ pnl: number; probability: number }>,
  strategyBreakdown: Record<string, BacktestResultEnhanced> = {},
  marketBreakdown: Record<string, BacktestResultEnhanced> = {}
): BacktestReport {
  return {
    summary,
    pnlCurve,
    strategyBreakdown,
    marketBreakdown,
    executionEvents,
    riskEvents,
    mcDistribution,
  }
}

export function generatePnlCurve(
  events: Array<{ ts: number; pnl: number }>,
  initialEquity: number
): Array<{ ts: number; pnl: number; equity: number }> {
  const curve: Array<{ ts: number; pnl: number; equity: number }> = []
  let cumulativePnl = 0

  const sortedEvents = [...events].sort((a, b) => a.ts - b.ts)

  for (const event of sortedEvents) {
    cumulativePnl += event.pnl
    curve.push({
      ts: event.ts,
      pnl: event.pnl,
      equity: initialEquity + cumulativePnl,
    })
  }

  return curve
}

export function generateMcDistribution(
  pnlValues: number[],
  bins: number = 20
): Array<{ pnl: number; probability: number }> {
  if (pnlValues.length === 0) return []

  const sorted = [...pnlValues].sort((a, b) => a - b)
  const min = sorted[0]
  const max = sorted[sorted.length - 1]
  const binWidth = (max - min) / bins

  const distribution: Array<{ pnl: number; probability: number }> = []

  for (let i = 0; i < bins; i++) {
    const binStart = min + i * binWidth
    const binEnd = binStart + binWidth
    const binMid = binStart + binWidth / 2

    const count = sorted.filter((v) => v >= binStart && v < binEnd).length
    const probability = count / sorted.length

    distribution.push({ pnl: binMid, probability })
  }

  return distribution
}

export function computeSummaryStatistics(
  pnlCurve: Array<{ pnl: number; equity: number }>
): {
  maxDrawdown: number
  maxDrawdownPct: number
  sharpeRatio: number
  sortinoRatio: number
} {
  if (pnlCurve.length === 0) {
    return {
      maxDrawdown: 0,
      maxDrawdownPct: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
    }
  }

  let peak = pnlCurve[0].equity
  let maxDrawdown = 0
  let maxDrawdownPct = 0

  for (const point of pnlCurve) {
    if (point.equity > peak) {
      peak = point.equity
    }
    const drawdown = peak - point.equity
    const drawdownPct = drawdown / peak

    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown
      maxDrawdownPct = drawdownPct
    }
  }

  const returns = pnlCurve.map((p, i) => {
    if (i === 0) return 0
    return (p.equity - pnlCurve[i - 1].equity) / pnlCurve[i - 1].equity
  })

  const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length
  const variance =
    returns.reduce((a, r) => a + (r - meanReturn) ** 2, 0) / returns.length
  const stdDev = Math.sqrt(variance)

  const negativeReturns = returns.filter((r) => r < 0)
  const downVariance =
    negativeReturns.length > 0
      ? negativeReturns.reduce((a, r) => a + r ** 2, 0) / negativeReturns.length
      : 0
  const downDev = Math.sqrt(downVariance)

  const annualizationFactor = 252
  const sharpeRatio =
    stdDev > 0
      ? (meanReturn * annualizationFactor) /
        (stdDev * Math.sqrt(annualizationFactor))
      : 0
  const sortinoRatio =
    downDev > 0
      ? (meanReturn * annualizationFactor) /
        (downDev * Math.sqrt(annualizationFactor))
      : 0

  return { maxDrawdown, maxDrawdownPct, sharpeRatio, sortinoRatio }
}

export function computeExecutionStatistics(events: ExecutionEvent[]): {
  avgSlippageBps: number
  p95SlippageBps: number
  avgDelayMs: number
  p99DelayMs: number
  legCompletionRate: number
} {
  if (events.length === 0) {
    return {
      avgSlippageBps: 0,
      p95SlippageBps: 0,
      avgDelayMs: 0,
      p99DelayMs: 0,
      legCompletionRate: 0,
    }
  }

  const slippages = events.map((e) => e.slippageBps)
  const delays = events.map((e) => e.delayMs)
  const filledCount = events.filter((e) => e.status === "filled").length

  const sortedSlippages = [...slippages].sort((a, b) => a - b)
  const sortedDelays = [...delays].sort((a, b) => a - b)

  const avgSlippageBps = slippages.reduce((a, b) => a + b, 0) / slippages.length
  const p95SlippageBps =
    sortedSlippages[Math.floor(sortedSlippages.length * 0.95)] ?? 0

  const avgDelayMs = delays.reduce((a, b) => a + b, 0) / delays.length
  const p99DelayMs = sortedDelays[Math.floor(sortedDelays.length * 0.99)] ?? 0

  const legCompletionRate = filledCount / events.length

  return {
    avgSlippageBps,
    p95SlippageBps,
    avgDelayMs,
    p99DelayMs,
    legCompletionRate,
  }
}

export function computeRiskStatistics(events: RiskEventBacktest[]): {
  killSwitchTriggered: number
  riskLimitBreaches: number
  consecutiveFailEvents: number
} {
  return {
    killSwitchTriggered: events.filter((e) => e.type === "kill_switch").length,
    riskLimitBreaches: events.filter((e) => e.type === "limit_breach").length,
    consecutiveFailEvents: events.filter((e) => e.type === "consecutive_fail")
      .length,
  }
}

export function formatReportAsJson(report: BacktestReport): string {
  return JSON.stringify(report, null, 2)
}

export function exportReportToFile(report: BacktestReport, path: string): void {
  const fs = require("fs")
  fs.writeFileSync(path, formatReportAsJson(report))
}

export function createEmptyReport(): BacktestReport {
  return {
    summary: createEmptySummary(),
    pnlCurve: [],
    strategyBreakdown: {},
    marketBreakdown: {},
    executionEvents: [],
    riskEvents: [],
    mcDistribution: [],
  }
}

function createEmptySummary(): BacktestResultEnhanced {
  return {
    totalPnl: 0,
    totalPnlBps: 0,
    sharpeRatio: 0,
    sortinoRatio: 0,
    maxDrawdown: 0,
    maxDrawdownPct: 0,
    totalOpportunities: 0,
    totalExecuted: 0,
    winRate: 0,
    avgEvBps: 0,
    avgHoldingTimeMs: 0,
    avgSlippageBps: 0,
    p95SlippageBps: 0,
    avgDelayMs: 0,
    p99DelayMs: 0,
    legCompletionRate: 0,
    killSwitchTriggered: 0,
    riskLimitBreaches: 0,
    consecutiveFailEvents: 0,
    signalPnl: 0,
    executionLoss: 0,
    inventoryLoss: 0,
    riskControlLoss: 0,
    mcPnLMean: 0,
    mcPnLP05: 0,
    mcPnLP95: 0,
    mcMaxDdMean: 0,
    mcMaxDdP95: 0,
    mcRuinProbability: 0,
    sensitivityAnalysis: {},
  }
}
