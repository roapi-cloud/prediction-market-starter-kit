import type {
  StatArbConfig,
  StatArbSignal,
  SpreadSnapshot,
  Opportunity,
} from "../contracts/types"
import { SpreadHistory } from "../data/spread-history"
import { rollingMean, rollingStd } from "../features/windows"

export function computeSpread(
  priceA: number,
  priceB: number,
  hedgeRatio: number
): number {
  return priceA - hedgeRatio * priceB
}

export function computeZScore(
  spread: number,
  mean: number,
  std: number
): number {
  if (std <= 0) return 0
  return (spread - mean) / std
}

export function computeStatArb(
  marketPrices: Map<string, number>,
  history: SpreadHistory,
  config: StatArbConfig
): StatArbSignal | null {
  const priceA = marketPrices.get(config.marketA)
  const priceB = marketPrices.get(config.marketB)

  if (priceA === undefined || priceB === undefined) {
    return null
  }

  const spread = computeSpread(priceA, priceB, config.hedgeRatio)

  const spreadValues = history.getSpreadValues(
    config.pairId,
    config.lookbackWindow
  )
  spreadValues.push(spread)

  if (spreadValues.length < 10) {
    return null
  }

  const mean = rollingMean(spreadValues, spreadValues.length)
  const std = rollingStd(spreadValues, spreadValues.length)
  const zScore = computeZScore(spread, mean, std)
  const halfLife = history.estimateHalfLife(spreadValues)

  const snapshot: SpreadSnapshot = {
    pairId: config.pairId,
    ts: Date.now(),
    spread,
    mean,
    std,
    zScore,
    halfLife,
  }

  const direction = determineDirection(zScore, config)
  const evBps = calculateEvBps(zScore, config)
  const confidence = calculateConfidence(zScore, halfLife)

  if (direction === "neutral") {
    return {
      pairId: config.pairId,
      zScore,
      direction,
      evBps: 0,
      confidence: 0,
      ttlMs: config.maxHoldingMs,
    }
  }

  return {
    pairId: config.pairId,
    zScore,
    direction,
    evBps,
    confidence,
    ttlMs: config.maxHoldingMs,
  }
}

export function determineDirection(
  zScore: number,
  config: StatArbConfig
): "long_spread" | "short_spread" | "neutral" {
  const absZ = Math.abs(zScore)

  if (absZ < config.entryZThreshold) {
    return "neutral"
  }

  return zScore > 0 ? "short_spread" : "long_spread"
}

export function calculateEvBps(zScore: number, config: StatArbConfig): number {
  const absZ = Math.abs(zScore)

  if (absZ < config.entryZThreshold) {
    return 0
  }

  const expectedReversion = absZ - config.exitZThreshold
  return expectedReversion * 10
}

export function calculateConfidence(zScore: number, halfLife?: number): number {
  const absZ = Math.abs(zScore)
  const zConfidence = Math.min(1, absZ / 3)

  let halfLifeConfidence = 0.5
  if (halfLife !== undefined) {
    if (halfLife < 30) {
      halfLifeConfidence = 1
    } else if (halfLife < 60) {
      halfLifeConfidence = 0.8
    } else if (halfLife < 120) {
      halfLifeConfidence = 0.6
    } else {
      halfLifeConfidence = 0.3
    }
  }

  return zConfidence * halfLifeConfidence
}

export function generateStatArbOpportunity(
  signal: StatArbSignal,
  config: StatArbConfig,
  now: number
): Opportunity | null {
  if (signal.direction === "neutral" || signal.evBps <= 0) {
    return null
  }

  if (Math.abs(signal.zScore) >= config.stopLossZThreshold) {
    return null
  }

  return {
    id: `${config.pairId}-${now}`,
    strategy: "stat_arb",
    marketIds: [config.marketA, config.marketB],
    evBps: signal.evBps,
    confidence: signal.confidence,
    ttlMs: signal.ttlMs,
    createdAt: now,
  }
}

export function shouldExitPosition(
  currentZScore: number,
  entryZScore: number,
  config: StatArbConfig
): boolean {
  const absCurrent = Math.abs(currentZScore)
  const absEntry = Math.abs(entryZScore)

  if (absCurrent < config.exitZThreshold) {
    return true
  }

  if (currentZScore * entryZScore < 0) {
    return true
  }

  if (absCurrent > absEntry + 1) {
    return true
  }

  return false
}

export function updateSpreadHistory(
  history: SpreadHistory,
  config: StatArbConfig,
  marketPrices: Map<string, number>,
  ts: number
): void {
  const priceA = marketPrices.get(config.marketA)
  const priceB = marketPrices.get(config.marketB)

  if (priceA !== undefined && priceB !== undefined) {
    history.add(config.pairId, ts, priceA, priceB, config.hedgeRatio)
  }
}
