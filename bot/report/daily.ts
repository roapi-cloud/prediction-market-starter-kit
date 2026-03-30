import type {
  MetricsSnapshot,
  StrategyMetrics,
  DailyReport,
  MarketMetrics,
  RiskEventSummary,
  AlertEvent,
} from "../contracts/types"

export function generateDailyReport(
  snapshots: MetricsSnapshot[],
  date: string,
  alerts: AlertEvent[] = [],
  riskEvents: RiskEventSummary[] = []
): DailyReport {
  if (snapshots.length === 0) {
    return createEmptyReport(date)
  }

  const dayStart = new Date(date).getTime()
  const dayEnd = dayStart + 24 * 60 * 60 * 1000
  const daySnapshots = snapshots.filter(
    (s) => s.ts >= dayStart && s.ts < dayEnd
  )

  if (daySnapshots.length === 0) {
    return createEmptyReport(date)
  }

  const first = daySnapshots[0]
  const last = daySnapshots[daySnapshots.length - 1]

  const pnl = last.pnl - first.pnl
  const pnlPct = last.pnlPct - first.pnlPct
  const opportunities = sumOpportunities(daySnapshots)
  const executed = sumExecuted(daySnapshots)
  const winRate = avgWinRate(daySnapshots)
  const maxDrawdown = Math.max(...daySnapshots.map((s) => s.drawdown))

  const strategyBreakdown = aggregateStrategies(daySnapshots)
  const marketBreakdown = new Map<string, MarketMetrics>()

  const executionQuality = {
    legCompletionRate: avg(daySnapshots.map((s) => s.legCompletionRate)),
    avgSlippageBps: avg(daySnapshots.map((s) => s.avgSlippageBps)),
    avgDelayMs: avg(daySnapshots.map((s) => s.avgDelayMs)),
  }

  const comparison = computeComparison(snapshots, date)

  return {
    date,
    summary: {
      pnl,
      pnlPct,
      opportunities,
      executed,
      winRate,
      maxDrawdown,
    },
    strategyBreakdown,
    marketBreakdown,
    executionQuality,
    riskEvents,
    alerts: alerts.filter((a) => {
      const alertDate = new Date(a.ts).toISOString().slice(0, 10)
      return alertDate === date
    }),
    comparison,
  }
}

function createEmptyReport(date: string): DailyReport {
  return {
    date,
    summary: {
      pnl: 0,
      pnlPct: 0,
      opportunities: 0,
      executed: 0,
      winRate: 0,
      maxDrawdown: 0,
    },
    strategyBreakdown: new Map(),
    marketBreakdown: new Map(),
    executionQuality: {
      legCompletionRate: 1,
      avgSlippageBps: 0,
      avgDelayMs: 0,
    },
    riskEvents: [],
    alerts: [],
    comparison: {
      vsYesterday: 0,
      vsWeeklyAvg: 0,
    },
  }
}

function sumOpportunities(snapshots: MetricsSnapshot[]): number {
  let total = 0
  for (const snap of snapshots) {
    for (const metrics of snap.strategyMetrics.values()) {
      total += metrics.opportunities
    }
  }
  return total
}

function sumExecuted(snapshots: MetricsSnapshot[]): number {
  let total = 0
  for (const snap of snapshots) {
    for (const metrics of snap.strategyMetrics.values()) {
      total += metrics.executed
    }
  }
  return total
}

function avgWinRate(snapshots: MetricsSnapshot[]): number {
  if (snapshots.length === 0) return 0
  return avg(snapshots.map((s) => s.winRate))
}

function avg(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

function aggregateStrategies(
  snapshots: MetricsSnapshot[]
): Map<string, StrategyMetrics> {
  const result = new Map<string, StrategyMetrics>()

  for (const snap of snapshots) {
    for (const [strategy, metrics] of snap.strategyMetrics) {
      const existing = result.get(strategy)
      if (existing) {
        existing.opportunities += metrics.opportunities
        existing.executed += metrics.executed
        existing.pnl += metrics.pnl
        existing.avgEvBps = (existing.avgEvBps + metrics.avgEvBps) / 2
        existing.winRate = (existing.winRate + metrics.winRate) / 2
      } else {
        result.set(strategy, { ...metrics })
      }
    }
  }

  return result
}

function computeComparison(
  allSnapshots: MetricsSnapshot[],
  date: string
): { vsYesterday: number; vsWeeklyAvg: number } {
  const currentTs = new Date(date).getTime()
  const yesterdayTs = currentTs - 24 * 60 * 60 * 1000
  const weekStartTs = currentTs - 7 * 24 * 60 * 60 * 1000

  const yesterdaySnapshots = allSnapshots.filter(
    (s) => s.ts >= yesterdayTs && s.ts < currentTs
  )
  const weekSnapshots = allSnapshots.filter(
    (s) => s.ts >= weekStartTs && s.ts < currentTs
  )

  const yesterdayPnl =
    yesterdaySnapshots.length > 0
      ? yesterdaySnapshots[yesterdaySnapshots.length - 1].pnl -
        yesterdaySnapshots[0].pnl
      : 0

  const weeklyPnl =
    weekSnapshots.length > 0
      ? weekSnapshots[weekSnapshots.length - 1].pnl - weekSnapshots[0].pnl
      : 0

  const weeklyAvg = weekSnapshots.length > 0 ? weeklyPnl / 7 : 0

  const currentPnl = allSnapshots.filter((s) => {
    const snapDate = new Date(s.ts).toISOString().slice(0, 10)
    return snapDate === date
  })

  const todayPnl =
    currentPnl.length > 0
      ? currentPnl[currentPnl.length - 1].pnl - currentPnl[0].pnl
      : 0

  return {
    vsYesterday: todayPnl - yesterdayPnl,
    vsWeeklyAvg: todayPnl - weeklyAvg,
  }
}

export function formatDailyReport(report: DailyReport): string {
  const lines: string[] = []
  lines.push(`Daily Report: ${report.date}`)
  lines.push("=".repeat(50))
  lines.push("")
  lines.push("Summary:")
  lines.push(
    `  PnL: $${report.summary.pnl.toFixed(2)} (${report.summary.pnlPct.toFixed(2)}%)`
  )
  lines.push(`  Opportunities: ${report.summary.opportunities}`)
  lines.push(`  Executed: ${report.summary.executed}`)
  lines.push(`  Win Rate: ${(report.summary.winRate * 100).toFixed(1)}%`)
  lines.push(`  Max Drawdown: $${report.summary.maxDrawdown.toFixed(2)}`)
  lines.push("")
  lines.push("Execution Quality:")
  lines.push(
    `  Leg Completion: ${(report.executionQuality.legCompletionRate * 100).toFixed(1)}%`
  )
  lines.push(
    `  Avg Slippage: ${report.executionQuality.avgSlippageBps.toFixed(1)} bps`
  )
  lines.push(`  Avg Delay: ${report.executionQuality.avgDelayMs.toFixed(0)} ms`)
  lines.push("")
  lines.push("Strategy Breakdown:")
  for (const [strategy, metrics] of report.strategyBreakdown) {
    lines.push(`  ${strategy}:`)
    lines.push(`    PnL: $${metrics.pnl.toFixed(2)}`)
    lines.push(`    Executed: ${metrics.executed}/${metrics.opportunities}`)
    lines.push(`    Win Rate: ${(metrics.winRate * 100).toFixed(1)}%`)
  }
  lines.push("")
  lines.push("Comparison:")
  lines.push(`  vs Yesterday: $${report.comparison.vsYesterday.toFixed(2)}`)
  lines.push(`  vs Weekly Avg: $${report.comparison.vsWeeklyAvg.toFixed(2)}`)
  lines.push("")
  if (report.alerts.length > 0) {
    lines.push("Alerts:")
    for (const alert of report.alerts) {
      lines.push(`  [${alert.severity}] ${alert.rule}: ${alert.message}`)
    }
  }
  if (report.riskEvents.length > 0) {
    lines.push("Risk Events:")
    for (const event of report.riskEvents) {
      lines.push(`  ${event.type}: ${event.description}`)
    }
  }
  return lines.join("\n")
}
