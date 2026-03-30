import type {
  SlippageStats,
  SlippageFeedback,
  RiskStateEnhanced,
} from "../contracts/types"

export function createEmptySlippageStats(
  marketId: string,
  strategy: string
): SlippageStats {
  return {
    marketId,
    strategy,
    count: 0,
    meanBps: 0,
    stdBps: 0,
    p95Bps: 0,
    p99Bps: 0,
    lastUpdate: Date.now(),
    samples: [],
  }
}

export function updateSlippageStats(
  feedback: SlippageFeedback,
  stats: Map<string, SlippageStats>,
  windowSize: number = 100
): Map<string, SlippageStats> {
  const key = `${feedback.marketId}:${feedback.strategy}`
  const existing =
    stats.get(key) ||
    createEmptySlippageStats(feedback.marketId, feedback.strategy)

  const newSamples = [...existing.samples, feedback.actualSlippageBps]
  if (newSamples.length > windowSize) {
    newSamples.shift()
  }

  const updated: SlippageStats = {
    marketId: feedback.marketId,
    strategy: feedback.strategy,
    count: newSamples.length,
    meanBps: calculateMean(newSamples),
    stdBps: calculateStd(newSamples),
    p95Bps: calculatePercentile(newSamples, 95),
    p99Bps: calculatePercentile(newSamples, 99),
    lastUpdate: feedback.ts,
    samples: newSamples,
  }

  const newStats = new Map(stats)
  newStats.set(key, updated)
  return newStats
}

export function getSlippageAdjustment(
  marketId: string,
  strategy: string,
  stats: Map<string, SlippageStats>
): number {
  const key = `${marketId}:${strategy}`
  const stat = stats.get(key)

  if (!stat || stat.count < 10) {
    return 0
  }

  return stat.p95Bps
}

export function checkSlippageAnomaly(
  feedback: SlippageFeedback,
  stats: Map<string, SlippageStats>,
  thresholdMultiplier: number = 3
): { isAnomaly: boolean; deviation: number } {
  const key = `${feedback.marketId}:${feedback.strategy}`
  const stat = stats.get(key)

  if (!stat || stat.count < 10) {
    return { isAnomaly: false, deviation: 0 }
  }

  const deviation =
    Math.abs(feedback.actualSlippageBps - stat.meanBps) /
    Math.max(1, stat.stdBps)
  const isAnomaly = deviation > thresholdMultiplier

  return { isAnomaly, deviation }
}

export function aggregateSlippageByMarket(
  stats: Map<string, SlippageStats>
): Map<string, { meanBps: number; count: number }> {
  const byMarket = new Map<string, { totalBps: number; count: number }>()

  for (const stat of stats.values()) {
    const existing = byMarket.get(stat.marketId) || { totalBps: 0, count: 0 }
    byMarket.set(stat.marketId, {
      totalBps: existing.totalBps + stat.meanBps * stat.count,
      count: existing.count + stat.count,
    })
  }

  const result = new Map<string, { meanBps: number; count: number }>()
  for (const [marketId, data] of byMarket) {
    result.set(marketId, {
      meanBps: data.count > 0 ? data.totalBps / data.count : 0,
      count: data.count,
    })
  }

  return result
}

export function aggregateSlippageByStrategy(
  stats: Map<string, SlippageStats>
): Map<string, { meanBps: number; p95Bps: number; count: number }> {
  const byStrategy = new Map<string, { samples: number[] }>()

  for (const stat of stats.values()) {
    const existing = byStrategy.get(stat.strategy) || { samples: [] }
    byStrategy.set(stat.strategy, {
      samples: [...existing.samples, ...stat.samples],
    })
  }

  const result = new Map<
    string,
    { meanBps: number; p95Bps: number; count: number }
  >()
  for (const [strategy, data] of byStrategy) {
    result.set(strategy, {
      meanBps: calculateMean(data.samples),
      p95Bps: calculatePercentile(data.samples, 95),
      count: data.samples.length,
    })
  }

  return result
}

export function getSlippageWarnings(
  feedback: SlippageFeedback,
  stats: Map<string, SlippageStats>,
  alertThresholdBps: number
): string[] {
  const warnings: string[] = []

  if (feedback.actualSlippageBps > alertThresholdBps) {
    warnings.push(
      `SLIPPAGE_ALERT:${feedback.marketId}:${feedback.actualSlippageBps.toFixed(1)}bps>${alertThresholdBps}bps`
    )
  }

  const { isAnomaly, deviation } = checkSlippageAnomaly(feedback, stats)
  if (isAnomaly) {
    warnings.push(
      `SLIPPAGE_ANOMALY:${feedback.marketId}:${deviation.toFixed(1)}std`
    )
  }

  const adjustment = getSlippageAdjustment(
    feedback.marketId,
    feedback.strategy,
    stats
  )
  if (adjustment > 0 && feedback.expectedSlippageBps < adjustment * 0.5) {
    warnings.push(
      `SLIPPAGE_UNDERESTIMATED:${feedback.marketId}:expected=${feedback.expectedSlippageBps.toFixed(1)}vs_p95=${adjustment.toFixed(1)}`
    )
  }

  return warnings
}

function calculateMean(samples: number[]): number {
  if (samples.length === 0) return 0
  return samples.reduce((s, v) => s + v, 0) / samples.length
}

function calculateStd(samples: number[]): number {
  if (samples.length < 2) return 0

  const mean = calculateMean(samples)
  const squaredDiffs = samples.map((s) => Math.pow(s - mean, 2))
  return Math.sqrt(squaredDiffs.reduce((s, v) => s + v, 0) / samples.length)
}

function calculatePercentile(samples: number[], percentile: number): number {
  if (samples.length === 0) return 0

  const sorted = [...samples].sort((a, b) => a - b)
  const index = Math.ceil((percentile / 100) * sorted.length) - 1
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))]
}

export function updateStateWithSlippage(
  state: RiskStateEnhanced,
  feedback: SlippageFeedback,
  windowSize: number
): RiskStateEnhanced {
  const newStats = updateSlippageStats(
    feedback,
    state.slippageStats,
    windowSize
  )
  return {
    ...state,
    slippageStats: newStats,
  }
}
