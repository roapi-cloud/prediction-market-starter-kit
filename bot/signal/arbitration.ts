import type {
  RoutedOpportunity,
  RejectedOpportunity,
  ArbitrationResult,
  ResourceClaim,
  RouterState,
} from "../contracts/types"

export function checkResourceConflict(
  claim1: ResourceClaim,
  claim2: ResourceClaim
): boolean {
  const markets1 = new Set(claim1.marketIds)
  for (const marketId of claim2.marketIds) {
    if (markets1.has(marketId)) {
      return true
    }
  }
  return false
}

export function checkMarketConflict(
  claim: ResourceClaim,
  lockedMarkets: Map<string, string>
): string | null {
  for (const marketId of claim.marketIds) {
    const lockedBy = lockedMarkets.get(marketId)
    if (lockedBy) {
      return lockedBy
    }
  }
  return null
}

export function arbitrateByPriority(
  opportunities: RoutedOpportunity[]
): RoutedOpportunity | null {
  if (opportunities.length === 0) return null

  return opportunities.reduce((best, current) => {
    if (!best) return current
    return current.priority > best.priority ? current : best
  }) as RoutedOpportunity | null
}

export function arbitrateByEV(
  opportunities: RoutedOpportunity[]
): RoutedOpportunity | null {
  if (opportunities.length === 0) return null

  return opportunities.reduce((best, current) => {
    if (!best) return current
    return current.opportunity.evBps > best.opportunity.evBps ? current : best
  }) as RoutedOpportunity | null
}

export function arbitrateByConfidence(
  opportunities: RoutedOpportunity[]
): RoutedOpportunity | null {
  if (opportunities.length === 0) return null

  return opportunities.reduce((best, current) => {
    if (!best) return current
    return current.opportunity.confidence > best.opportunity.confidence
      ? current
      : best
  }) as RoutedOpportunity | null
}

export interface ArbitrationConfig {
  preferHigherPriority: boolean
  preferHigherEV: boolean
  preferHigherConfidence: boolean
  allowMergeOpportunities: boolean
  maxExposureTotal: number
  minEvBps: number
}

export const DEFAULT_ARBITRATION_CONFIG: ArbitrationConfig = {
  preferHigherPriority: true,
  preferHigherEV: true,
  preferHigherConfidence: false,
  allowMergeOpportunities: false,
  maxExposureTotal: 1.0,
  minEvBps: 5,
}

export function arbitrate(
  opportunities: RoutedOpportunity[],
  state: RouterState,
  config: ArbitrationConfig = DEFAULT_ARBITRATION_CONFIG
): ArbitrationResult {
  const rejected: RejectedOpportunity[] = []
  const eligible: RoutedOpportunity[] = []

  for (const opp of opportunities) {
    const conflictStrategy = checkMarketConflict(
      opp.resourceClaim,
      state.lockedMarkets
    )
    if (conflictStrategy) {
      rejected.push({
        opportunity: opp,
        reason: `Market conflict with strategy: ${conflictStrategy}`,
      })
      continue
    }

    if (opp.opportunity.evBps < config.minEvBps) {
      rejected.push({
        opportunity: opp,
        reason: `EV too low: ${opp.opportunity.evBps} < ${config.minEvBps}`,
      })
      continue
    }

    if (
      opp.resourceClaim.estimatedExposure + state.totalExposure >
      config.maxExposureTotal * state.totalEquity
    ) {
      rejected.push({
        opportunity: opp,
        reason: `Exposure limit exceeded`,
      })
      continue
    }

    eligible.push(opp)
  }

  if (eligible.length === 0) {
    return {
      selected: null,
      rejected,
      reason: "No eligible opportunities",
    }
  }

  let selected: RoutedOpportunity | null = null

  const sorted = [...eligible].sort((a, b) => {
    if (config.preferHigherPriority && a.priority !== b.priority) {
      return b.priority - a.priority
    }
    if (config.preferHigherEV && a.opportunity.evBps !== b.opportunity.evBps) {
      return b.opportunity.evBps - a.opportunity.evBps
    }
    if (
      config.preferHigherConfidence &&
      a.opportunity.confidence !== b.opportunity.confidence
    ) {
      return b.opportunity.confidence - a.opportunity.confidence
    }
    return 0
  })

  selected = sorted[0]

  for (let i = 1; i < sorted.length; i++) {
    rejected.push({
      opportunity: sorted[i],
      reason: "Lower priority than selected opportunity",
    })
  }

  return {
    selected,
    rejected,
    reason: selected
      ? `Selected ${selected.sourceStrategy} (priority: ${selected.priority}, EV: ${selected.opportunity.evBps} bps)`
      : "No opportunity selected",
  }
}

export function mergeOpportunities(
  opportunities: RoutedOpportunity[]
): RoutedOpportunity | null {
  if (opportunities.length === 0) return null
  if (opportunities.length === 1) return opportunities[0]

  const allMarketIds = new Set<string>()
  let totalExposure = 0
  let totalDuration = 0
  let weightedEV = 0
  let weightedConfidence = 0
  let totalWeight = 0

  for (const opp of opportunities) {
    for (const marketId of opp.resourceClaim.marketIds) {
      allMarketIds.add(marketId)
    }
    totalExposure += opp.resourceClaim.estimatedExposure
    totalDuration += opp.resourceClaim.estimatedDurationMs

    const weight = opp.priority + 1
    weightedEV += opp.opportunity.evBps * weight
    weightedConfidence += opp.opportunity.confidence * weight
    totalWeight += weight
  }

  const mergedId = opportunities.map((o) => o.opportunity.id).join("+")
  const highestPriority = Math.max(...opportunities.map((o) => o.priority))

  return {
    opportunity: {
      id: mergedId,
      strategy: opportunities[0].opportunity.strategy,
      marketIds: Array.from(allMarketIds),
      evBps: weightedEV / totalWeight,
      confidence: weightedConfidence / totalWeight,
      ttlMs: Math.min(...opportunities.map((o) => o.opportunity.ttlMs)),
      createdAt: Math.min(...opportunities.map((o) => o.opportunity.createdAt)),
    },
    sourceStrategy: opportunities.map((o) => o.sourceStrategy).join("+"),
    priority: highestPriority,
    resourceClaim: {
      marketIds: Array.from(allMarketIds),
      estimatedExposure: totalExposure,
      estimatedDurationMs: totalDuration / opportunities.length,
    },
  }
}

export function checkCrossStrategyConflict(
  opportunities: RoutedOpportunity[]
): Map<string, string[]> {
  const conflicts = new Map<string, string[]>()

  for (let i = 0; i < opportunities.length; i++) {
    for (let j = i + 1; j < opportunities.length; j++) {
      if (
        checkResourceConflict(
          opportunities[i].resourceClaim,
          opportunities[j].resourceClaim
        )
      ) {
        const key1 = opportunities[i].sourceStrategy
        const key2 = opportunities[j].sourceStrategy

        if (!conflicts.has(key1)) conflicts.set(key1, [])
        if (!conflicts.has(key2)) conflicts.set(key2, [])

        conflicts.get(key1)!.push(key2)
        conflicts.get(key2)!.push(key1)
      }
    }
  }

  return conflicts
}
