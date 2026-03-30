import type {
  BayesianOutputEnhanced,
  FeatureSnapshot,
} from "../contracts/types"
import { ParticleFilter, createParticleFilter } from "./particle-filter"

let globalFilter: ParticleFilter | null = null
const filterRegistry: Map<string, ParticleFilter> = new Map()

export function getOrCreateFilter(
  marketId: string,
  reset = false
): ParticleFilter {
  if (reset && filterRegistry.has(marketId)) {
    filterRegistry.delete(marketId)
  }

  if (!filterRegistry.has(marketId)) {
    filterRegistry.set(marketId, createParticleFilter())
  }

  return filterRegistry.get(marketId)!
}

export function getGlobalFilter(reset = false): ParticleFilter {
  if (reset || !globalFilter) {
    globalFilter = createParticleFilter()
  }
  return globalFilter
}

export function computeBayesianEnhanced(
  feature: FeatureSnapshot,
  filter?: ParticleFilter
): BayesianOutputEnhanced {
  const pf = filter ?? getGlobalFilter()
  pf.predict()
  pf.update(feature)
  return pf.getEstimate()
}

export function computeBayesianEnhancedForMarket(
  feature: FeatureSnapshot,
  marketId?: string
): BayesianOutputEnhanced {
  const mid = marketId ?? feature.marketId
  const filter = getOrCreateFilter(mid)
  return computeBayesianEnhanced(feature, filter)
}

export function resetFilter(marketId?: string): void {
  if (marketId) {
    const filter = filterRegistry.get(marketId)
    if (filter) {
      filter.reset()
    }
  } else {
    globalFilter?.reset()
    filterRegistry.forEach((f) => f.reset())
  }
}

export function clearFilterRegistry(): void {
  filterRegistry.clear()
  globalFilter = null
}

export { ParticleFilter, createParticleFilter }
