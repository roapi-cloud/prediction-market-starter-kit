import type {
  PassCriteria,
  MetricsSnapshot,
  StrategyMetrics,
} from "../contracts/types"

export const DEFAULT_PASS_CRITERIA: PassCriteria = {
  minLegCompletionRate: 0.95,
  minAvgEvBps: 5,
  maxDrawdownPct: 4,
  maxKillSwitchTriggers: 3,
  minDurationDays: 7,
}

export function checkPaperCriteria(
  snapshots: MetricsSnapshot[],
  criteria: PassCriteria = DEFAULT_PASS_CRITERIA
): { passed: boolean; reasons: string[] } {
  const reasons: string[] = []

  if (snapshots.length === 0) {
    return { passed: false, reasons: ["No metrics data available"] }
  }

  const avgLegCompletion = avg(snapshots.map((s) => s.legCompletionRate))
  if (avgLegCompletion < criteria.minLegCompletionRate) {
    reasons.push(
      `Leg completion rate ${avgLegCompletion.toFixed(2)} below ${criteria.minLegCompletionRate}`
    )
  }

  const avgEvBps = avgStrategyEvBps(snapshots)
  if (avgEvBps < criteria.minAvgEvBps) {
    reasons.push(
      `Average EV ${avgEvBps.toFixed(1)} bps below ${criteria.minAvgEvBps} bps`
    )
  }

  const passed = reasons.length === 0
  return { passed, reasons }
}

export function checkGrayscaleCriteria(
  snapshots: MetricsSnapshot[],
  killSwitchCount: number,
  criteria: PassCriteria = DEFAULT_PASS_CRITERIA
): { passed: boolean; reasons: string[] } {
  const reasons: string[] = []

  if (snapshots.length === 0) {
    return { passed: false, reasons: ["No metrics data available"] }
  }

  const maxDrawdown = Math.max(...snapshots.map((s) => s.drawdownPct))
  if (maxDrawdown > criteria.maxDrawdownPct) {
    reasons.push(
      `Max drawdown ${maxDrawdown.toFixed(2)}% exceeds ${criteria.maxDrawdownPct}%`
    )
  }

  if (killSwitchCount > criteria.maxKillSwitchTriggers) {
    reasons.push(
      `Kill switch triggered ${killSwitchCount} times, exceeds ${criteria.maxKillSwitchTriggers}`
    )
  }

  const passed = reasons.length === 0
  return { passed, reasons }
}

export function checkProductionReady(
  paperSnapshots: MetricsSnapshot[],
  grayscaleSnapshots: MetricsSnapshot[],
  killSwitchCount: number,
  criteria: PassCriteria = DEFAULT_PASS_CRITERIA
): { ready: boolean; reasons: string[] } {
  const reasons: string[] = []

  const paperResult = checkPaperCriteria(paperSnapshots, criteria)
  if (!paperResult.passed) {
    reasons.push(`Paper trading: ${paperResult.reasons.join(", ")}`)
  }

  const grayscaleResult = checkGrayscaleCriteria(
    grayscaleSnapshots,
    killSwitchCount,
    criteria
  )
  if (!grayscaleResult.passed) {
    reasons.push(`Grayscale: ${grayscaleResult.reasons.join(", ")}`)
  }

  const paperDuration = computeDurationDays(paperSnapshots)
  if (paperDuration < criteria.minDurationDays) {
    reasons.push(
      `Paper duration ${paperDuration} days below ${criteria.minDurationDays}`
    )
  }

  const grayscaleDuration = computeDurationDays(grayscaleSnapshots)
  if (grayscaleDuration < criteria.minDurationDays) {
    reasons.push(
      `Grayscale duration ${grayscaleDuration} days below ${criteria.minDurationDays}`
    )
  }

  const ready = reasons.length === 0
  return { ready, reasons }
}

function avg(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

function avgStrategyEvBps(snapshots: MetricsSnapshot[]): number {
  const allEvBps: number[] = []
  for (const snap of snapshots) {
    for (const metrics of snap.strategyMetrics.values()) {
      allEvBps.push(metrics.avgEvBps)
    }
  }
  return avg(allEvBps)
}

function computeDurationDays(snapshots: MetricsSnapshot[]): number {
  if (snapshots.length < 2) return 0
  const first = snapshots[0].ts
  const last = snapshots[snapshots.length - 1].ts
  return (last - first) / (24 * 60 * 60 * 1000)
}

export function computeConfidenceScore(
  snapshots: MetricsSnapshot[],
  criteria: PassCriteria = DEFAULT_PASS_CRITERIA
): number {
  if (snapshots.length === 0) return 0

  let score = 0

  const avgLegCompletion = avg(snapshots.map((s) => s.legCompletionRate))
  score += Math.min(1, avgLegCompletion / criteria.minLegCompletionRate) * 0.3

  const avgEvBps = avgStrategyEvBps(snapshots)
  score += Math.min(1, avgEvBps / criteria.minAvgEvBps) * 0.2

  const maxDrawdown = Math.max(...snapshots.map((s) => s.drawdownPct))
  score += Math.max(0, 1 - maxDrawdown / criteria.maxDrawdownPct) * 0.3

  const avgWinRate = avg(snapshots.map((s) => s.winRate))
  score += avgWinRate * 0.2

  return Math.min(1, Math.max(0, score))
}
