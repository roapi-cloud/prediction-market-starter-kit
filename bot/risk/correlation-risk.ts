import type {
  Position,
  RiskStateEnhanced,
  RiskConfigEnhanced,
  Opportunity,
  CorrelationGroup,
} from "../contracts/types"

export function buildCorrelationMatrix(
  priceHistory: Map<string, number[]>
): Map<string, Map<string, number>> {
  const marketIds = Array.from(priceHistory.keys())
  const matrix = new Map<string, Map<string, number>>()

  for (const marketA of marketIds) {
    const pricesA = priceHistory.get(marketA)!
    const correlations = new Map<string, number>()

    for (const marketB of marketIds) {
      if (marketA === marketB) {
        correlations.set(marketB, 1.0)
        continue
      }

      const pricesB = priceHistory.get(marketB)!
      const correlation = calculateCorrelation(pricesA, pricesB)
      correlations.set(marketB, correlation)
    }

    matrix.set(marketA, correlations)
  }

  return matrix
}

export function calculateCorrelation(
  pricesA: number[],
  pricesB: number[]
): number {
  const n = Math.min(pricesA.length, pricesB.length)
  if (n < 2) return 0

  const returnsA = calculateReturns(pricesA.slice(0, n))
  const returnsB = calculateReturns(pricesB.slice(0, n))

  if (returnsA.length < 2) return 0

  const meanA = returnsA.reduce((s, v) => s + v, 0) / returnsA.length
  const meanB = returnsB.reduce((s, v) => s + v, 0) / returnsB.length

  let numerator = 0
  let denomA = 0
  let denomB = 0

  for (let i = 0; i < returnsA.length; i++) {
    const diffA = returnsA[i] - meanA
    const diffB = returnsB[i] - meanB
    numerator += diffA * diffB
    denomA += diffA * diffA
    denomB += diffB * diffB
  }

  const denominator = Math.sqrt(denomA * denomB)
  if (denominator === 0) return 0

  return Math.max(-1, Math.min(1, numerator / denominator))
}

function calculateReturns(prices: number[]): number[] {
  if (prices.length < 2) return []

  const returns: number[] = []
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] !== 0) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1])
    }
  }
  return returns
}

export function computeCombinedExposure(
  positions: Position[],
  correlations: Map<string, Map<string, number>>
): number {
  if (positions.length === 0) return 0

  const marketExposures = new Map<string, number>()
  for (const pos of positions) {
    const exposure = pos.size * pos.currentPrice
    const existing = marketExposures.get(pos.marketId) || 0
    marketExposures.set(pos.marketId, existing + exposure)
  }

  let combinedExposure = 0
  const marketIds = Array.from(marketExposures.keys())

  for (const marketA of marketIds) {
    const expA = marketExposures.get(marketA)!
    combinedExposure += expA

    const correlationsA = correlations.get(marketA)
    if (!correlationsA) continue

    for (const marketB of marketIds) {
      if (marketA >= marketB) continue

      const expB = marketExposures.get(marketB)!
      const corr = correlationsA.get(marketB) || 0

      combinedExposure += 2 * Math.sqrt(expA * expB) * Math.abs(corr)
    }
  }

  return combinedExposure
}

export function checkCorrelationRisk(
  state: RiskStateEnhanced,
  newOpportunity: Opportunity,
  config: RiskConfigEnhanced
): { hasRisk: boolean; warning?: string; projectedExposure: number } {
  if (newOpportunity.marketIds.length === 0) {
    return { hasRisk: false, projectedExposure: state.combinedExposure }
  }

  const positions = Array.from(state.positions.values())
  const currentExposure = computeCombinedExposure(
    positions,
    config.correlationMatrix
  )

  const estimatedNewExposure =
    config.maxPositionSize * newOpportunity.confidence
  const projectedExposure = currentExposure + estimatedNewExposure

  if (projectedExposure > config.maxCombinedExposure) {
    return {
      hasRisk: true,
      warning: `COMBINED_EXPOSURE_EXCEEDED:${projectedExposure.toFixed(2)}>${config.maxCombinedExposure}`,
      projectedExposure,
    }
  }

  const correlatedMarkets = findCorrelatedMarkets(
    newOpportunity.marketIds,
    state.positions,
    config.correlationMatrix,
    0.5
  )

  if (correlatedMarkets.length > 0) {
    return {
      hasRisk: true,
      warning: `CORRELATED_POSITIONS:${newOpportunity.marketIds.join(",")}->${correlatedMarkets.join(",")}`,
      projectedExposure,
    }
  }

  return { hasRisk: false, projectedExposure }
}

export function identifyCorrelationGroups(
  positions: Position[],
  correlations: Map<string, Map<string, number>>,
  threshold: number = 0.3
): CorrelationGroup[] {
  const groups: CorrelationGroup[] = []
  const processed = new Set<string>()

  for (const posA of positions) {
    if (processed.has(posA.marketId)) continue

    const groupMarkets = [posA.marketId]
    let totalCorr = 0
    let corrCount = 0

    for (const posB of positions) {
      if (posA.marketId === posB.marketId) continue

      const corr = getCorrelation(posA.marketId, posB.marketId, correlations)
      if (Math.abs(corr) >= threshold) {
        groupMarkets.push(posB.marketId)
        totalCorr += Math.abs(corr)
        corrCount++
        processed.add(posB.marketId)
      }
    }

    if (groupMarkets.length > 1) {
      const groupExposure = groupMarkets.reduce((sum, mId) => {
        const pos = positions.find((p) => p.marketId === mId)
        return sum + (pos ? pos.size * pos.currentPrice : 0)
      }, 0)

      groups.push({
        groupId: `group_${groups.length}`,
        markets: groupMarkets,
        avgCorrelation: corrCount > 0 ? totalCorr / corrCount : 0,
        combinedExposure: groupExposure,
        maxAllowedExposure: 0,
      })
    }

    processed.add(posA.marketId)
  }

  return groups
}

export function getCorrelation(
  marketA: string,
  marketB: string,
  correlations: Map<string, Map<string, number>>
): number {
  const corrA = correlations.get(marketA)
  if (corrA) {
    const corr = corrA.get(marketB)
    if (corr !== undefined) return corr
  }

  const corrB = correlations.get(marketB)
  if (corrB) {
    const corr = corrB.get(marketA)
    if (corr !== undefined) return corr
  }

  return 0
}

function findCorrelatedMarkets(
  newMarketIds: string[],
  positions: Map<string, Position>,
  correlations: Map<string, Map<string, number>>,
  threshold: number
): string[] {
  const correlated: string[] = []

  for (const position of positions.values()) {
    for (const newMarketId of newMarketIds) {
      const corr = getCorrelation(position.marketId, newMarketId, correlations)
      if (Math.abs(corr) >= threshold) {
        correlated.push(position.marketId)
        break
      }
    }
  }

  return correlated
}

export function updateCorrelationMatrix(
  existing: Map<string, Map<string, number>>,
  newPrices: Map<string, number[]>,
  decay: number = 0.9
): Map<string, Map<string, number>> {
  const newCorrelations = buildCorrelationMatrix(newPrices)
  const updated = new Map<string, Map<string, number>>()

  const allMarkets = new Set([...existing.keys(), ...newCorrelations.keys()])

  for (const marketA of allMarkets) {
    const correlations = new Map<string, number>()
    const existingCorrA = existing.get(marketA)
    const newCorrA = newCorrelations.get(marketA)

    for (const marketB of allMarkets) {
      const existingVal = existingCorrA?.get(marketB) ?? 0
      const newVal = newCorrA?.get(marketB) ?? 0

      if (newCorrA?.has(marketB)) {
        correlations.set(marketB, decay * existingVal + (1 - decay) * newVal)
      } else if (existingCorrA?.has(marketB)) {
        correlations.set(marketB, existingVal)
      }
    }

    updated.set(marketA, correlations)
  }

  return updated
}
