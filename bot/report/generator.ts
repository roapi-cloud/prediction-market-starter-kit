import type {
  MetricsSnapshot,
  DailyReport,
  WeeklyReport,
  StrategyMetrics,
  AlertEvent,
  RiskEventSummary,
} from "../contracts/types"
import { generateDailyReport, formatDailyReport } from "./daily"
import { writeFileSync } from "node:fs"

export class ReportGenerator {
  private snapshots: MetricsSnapshot[] = []
  private alerts: AlertEvent[] = []
  private riskEvents: RiskEventSummary[] = []

  addSnapshot(snapshot: MetricsSnapshot): void {
    this.snapshots.push(snapshot)
  }

  addAlert(alert: AlertEvent): void {
    this.alerts.push(alert)
  }

  addRiskEvent(event: RiskEventSummary): void {
    this.riskEvents.push(event)
  }

  generateDaily(date: string): DailyReport {
    return generateDailyReport(
      this.snapshots,
      date,
      this.alerts,
      this.riskEvents
    )
  }

  generateWeekly(startDate: string, endDate: string): WeeklyReport {
    const dailyReports: DailyReport[] = []
    const start = new Date(startDate)
    const end = new Date(endDate)

    while (start <= end) {
      const dateStr = start.toISOString().slice(0, 10)
      dailyReports.push(this.generateDaily(dateStr))
      start.setDate(start.getDate() + 1)
    }

    const summary = this.computeWeeklySummary(dailyReports)
    const strategyBreakdown = this.aggregateWeeklyStrategies(dailyReports)

    return {
      startDate,
      endDate,
      summary,
      dailyReports,
      strategyBreakdown,
    }
  }

  private computeWeeklySummary(
    dailyReports: DailyReport[]
  ): WeeklyReport["summary"] {
    if (dailyReports.length === 0) {
      return {
        pnl: 0,
        pnlPct: 0,
        totalOpportunities: 0,
        totalExecuted: 0,
        winRate: 0,
        maxDrawdown: 0,
        avgDailyPnl: 0,
        bestDay: "",
        worstDay: "",
      }
    }

    const pnl = dailyReports.reduce((sum, r) => sum + r.summary.pnl, 0)
    const pnlPct = dailyReports.reduce((sum, r) => sum + r.summary.pnlPct, 0)
    const totalOpportunities = dailyReports.reduce(
      (sum, r) => sum + r.summary.opportunities,
      0
    )
    const totalExecuted = dailyReports.reduce(
      (sum, r) => sum + r.summary.executed,
      0
    )
    const winRate = avg(dailyReports.map((r) => r.summary.winRate))
    const maxDrawdown = Math.max(
      ...dailyReports.map((r) => r.summary.maxDrawdown)
    )
    const avgDailyPnl = pnl / dailyReports.length

    const sortedByPnl = dailyReports.sort(
      (a, b) => b.summary.pnl - a.summary.pnl
    )
    const bestDay = sortedByPnl[0]?.date ?? ""
    const worstDay = sortedByPnl[sortedByPnl.length - 1]?.date ?? ""

    return {
      pnl,
      pnlPct,
      totalOpportunities,
      totalExecuted,
      winRate,
      maxDrawdown,
      avgDailyPnl,
      bestDay,
      worstDay,
    }
  }

  private aggregateWeeklyStrategies(
    dailyReports: DailyReport[]
  ): Map<string, StrategyMetrics> {
    const result = new Map<string, StrategyMetrics>()

    for (const report of dailyReports) {
      for (const [strategy, metrics] of report.strategyBreakdown) {
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

  exportReport(report: DailyReport, format: "json" | "html" | "csv"): string {
    switch (format) {
      case "json":
        return this.toJson(report)
      case "html":
        return this.toHtml(report)
      case "csv":
        return this.toCsv(report)
      default:
        return this.toJson(report)
    }
  }

  private toJson(report: DailyReport): string {
    const strategyObj: Record<string, StrategyMetrics> = {}
    for (const [key, value] of report.strategyBreakdown) {
      strategyObj[key] = value
    }
    const marketObj: Record<
      string,
      {
        opportunities: number
        executed: number
        pnl: number
        avgSpread: number
      }
    > = {}
    for (const [key, value] of report.marketBreakdown) {
      marketObj[key] = value
    }
    return JSON.stringify(
      {
        ...report,
        strategyBreakdown: strategyObj,
        marketBreakdown: marketObj,
      },
      null,
      2
    )
  }

  private toHtml(report: DailyReport): string {
    return `<!DOCTYPE html>
<html>
<head><title>Daily Report - ${report.date}</title></head>
<body>
<h1>Daily Report: ${report.date}</h1>
<h2>Summary</h2>
<ul>
<li>PnL: $${report.summary.pnl.toFixed(2)} (${report.summary.pnlPct.toFixed(2)}%)</li>
<li>Opportunities: ${report.summary.opportunities}</li>
<li>Executed: ${report.summary.executed}</li>
<li>Win Rate: ${(report.summary.winRate * 100).toFixed(1)}%</li>
<li>Max Drawdown: $${report.summary.maxDrawdown.toFixed(2)}</li>
</ul>
<h2>Execution Quality</h2>
<ul>
<li>Leg Completion: ${(report.executionQuality.legCompletionRate * 100).toFixed(1)}%</li>
<li>Avg Slippage: ${report.executionQuality.avgSlippageBps.toFixed(1)} bps</li>
<li>Avg Delay: ${report.executionQuality.avgDelayMs.toFixed(0)} ms</li>
</ul>
<h2>Strategy Breakdown</h2>
${Array.from(report.strategyBreakdown)
  .map(
    ([s, m]) =>
      `<h3>${s}</h3><ul><li>PnL: $${m.pnl.toFixed(2)}</li><li>Executed: ${m.executed}/${m.opportunities}</li><li>Win Rate: ${(m.winRate * 100).toFixed(1)}%</li></ul>`
  )
  .join("\n")}
<h2>Comparison</h2>
<ul>
<li>vs Yesterday: $${report.comparison.vsYesterday.toFixed(2)}</li>
<li>vs Weekly Avg: $${report.comparison.vsWeeklyAvg.toFixed(2)}</li>
</ul>
</body>
</html>`
  }

  private toCsv(report: DailyReport): string {
    const lines: string[] = []
    lines.push("metric,value")
    lines.push(`date,${report.date}`)
    lines.push(`pnl,${report.summary.pnl}`)
    lines.push(`pnl_pct,${report.summary.pnlPct}`)
    lines.push(`opportunities,${report.summary.opportunities}`)
    lines.push(`executed,${report.summary.executed}`)
    lines.push(`win_rate,${report.summary.winRate}`)
    lines.push(`max_drawdown,${report.summary.maxDrawdown}`)
    lines.push(
      `leg_completion_rate,${report.executionQuality.legCompletionRate}`
    )
    lines.push(`avg_slippage_bps,${report.executionQuality.avgSlippageBps}`)
    lines.push(`avg_delay_ms,${report.executionQuality.avgDelayMs}`)
    lines.push(`vs_yesterday,${report.comparison.vsYesterday}`)
    lines.push(`vs_weekly_avg,${report.comparison.vsWeeklyAvg}`)
    lines.push("")
    lines.push("strategy,pnl,executed,opportunities,win_rate")
    for (const [strategy, metrics] of report.strategyBreakdown) {
      lines.push(
        `${strategy},${metrics.pnl},${metrics.executed},${metrics.opportunities},${metrics.winRate}`
      )
    }
    return lines.join("\n")
  }

  saveReport(
    report: DailyReport,
    path: string,
    format: "json" | "html" | "csv"
  ): void {
    const content = this.exportReport(report, format)
    writeFileSync(path, content, "utf8")
  }

  clear(): void {
    this.snapshots = []
    this.alerts = []
    this.riskEvents = []
  }
}

function avg(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, v) => sum + v, 0) / values.length
}
