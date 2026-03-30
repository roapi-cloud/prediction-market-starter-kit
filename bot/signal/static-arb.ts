import type {
  Opportunity,
  FeatureSnapshot,
  ResourceClaim,
} from "../contracts/types"
import type { BookState } from "../ingest/orderbook"
import { computeBayesian } from "./bayesian"
import { computeEdge } from "./edge"

export type StaticArbConfig = {
  costBps: number
  minEvBps: number
  minConfidence: number
  ttlMs: number
}

export const DEFAULT_STATIC_ARB_CONFIG: StaticArbConfig = {
  costBps: 20,
  minEvBps: 5,
  minConfidence: 0.1,
  ttlMs: 3_000,
}

export function generateStaticArbOpportunity(
  feature: FeatureSnapshot,
  book: BookState,
  now: number,
  config: StaticArbConfig = DEFAULT_STATIC_ARB_CONFIG
): Opportunity | null {
  const bayesian = computeBayesian(feature)
  const edge = computeEdge(book, config.costBps, config.minEvBps)

  if (!edge.shouldTrade) return null
  if (bayesian.confidence < config.minConfidence) return null

  return {
    id: `${feature.marketId}-${now}`,
    strategy: "static_arb",
    marketIds: [feature.marketId],
    evBps: edge.evBps,
    confidence: bayesian.confidence,
    ttlMs: config.ttlMs,
    createdAt: now,
  }
}

export function generateStaticArbResourceClaim(
  opportunity: Opportunity
): ResourceClaim {
  return {
    marketIds: opportunity.marketIds,
    estimatedExposure: 100,
    estimatedDurationMs: opportunity.ttlMs,
  }
}
