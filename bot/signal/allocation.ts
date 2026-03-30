import type {
  AllocationDecision,
  AllocationConstraint,
  StrategyConfig,
  StrategyState,
  RouterState,
} from "../contracts/types"

export interface AllocationConfig {
  reserveCapitalPct: number
  maxSingleStrategyPct: number
  maxMarketExposurePct: number
  minStrategyAllocation: number
}

export const DEFAULT_ALLOCATION_CONFIG: AllocationConfig = {
  reserveCapitalPct: 0.1,
  maxSingleStrategyPct: 0.4,
  maxMarketExposurePct: 0.15,
  minStrategyAllocation: 100,
}

export function allocateCapital(
  totalEquity: number,
  strategies: Map<string, StrategyConfig>,
  states: Map<string, StrategyState>,
  routerState: RouterState,
  config: AllocationConfig = DEFAULT_ALLOCATION_CONFIG
): AllocationDecision {
  const constraints: AllocationConstraint[] = []
  const strategyAllocations = new Map<string, number>()

  const availableCapital =
    totalEquity * (1 - config.reserveCapitalPct) - routerState.totalExposure
  constraints.push({
    type: "capital",
    limit: totalEquity * (1 - config.reserveCapitalPct),
    current: routerState.totalExposure,
    available: availableCapital,
  })

  const activeStrategies = Array.from(strategies.values()).filter(
    (s) => s.enabled && states.get(s.name)?.status === "active"
  )

  const totalWeight = activeStrategies.reduce((sum, s) => sum + s.weight, 0)

  for (const strategy of activeStrategies) {
    const state = states.get(strategy.name)
    if (!state) continue

    let allocation = (strategy.weight / totalWeight) * availableCapital

    allocation = Math.min(
      allocation,
      strategy.maxCapitalAllocation * totalEquity
    )
    allocation = Math.min(allocation, config.maxSingleStrategyPct * totalEquity)

    const currentExposure = state.currentExposure
    allocation = Math.max(0, allocation - currentExposure)

    if (allocation < config.minStrategyAllocation && allocation > 0) {
      allocation = 0
    }

    strategyAllocations.set(strategy.name, allocation)

    constraints.push({
      type: "capital",
      strategy: strategy.name,
      limit: strategy.maxCapitalAllocation * totalEquity,
      current: currentExposure,
      available: allocation,
    })

    constraints.push({
      type: "risk_budget",
      strategy: strategy.name,
      limit: strategy.riskBudgetPct * totalEquity,
      current: Math.abs(state.intradayPnl),
      available:
        strategy.riskBudgetPct * totalEquity - Math.abs(state.intradayPnl),
    })
  }

  return {
    strategyAllocations,
    totalAvailable: availableCapital,
    constraints,
  }
}

export function allocateRiskBudget(
  totalRiskBudget: number,
  strategies: Map<string, StrategyConfig>,
  states: Map<string, StrategyState>
): Map<string, number> {
  const allocations = new Map<string, number>()

  const activeStrategies = Array.from(strategies.values()).filter(
    (s) => s.enabled && states.get(s.name)?.status === "active"
  )

  const totalWeight = activeStrategies.reduce((sum, s) => sum + s.weight, 0)

  for (const strategy of activeStrategies) {
    const state = states.get(strategy.name)
    if (!state) continue

    const baseAllocation = (strategy.weight / totalWeight) * totalRiskBudget
    const cappedAllocation = Math.min(
      baseAllocation,
      strategy.riskBudgetPct * totalRiskBudget
    )

    const usedBudget = Math.abs(state.intradayPnl)
    const remainingBudget = Math.max(0, cappedAllocation - usedBudget)

    allocations.set(strategy.name, remainingBudget)
  }

  return allocations
}

export function checkExposureConstraint(
  strategyName: string,
  marketId: string,
  estimatedExposure: number,
  strategies: Map<string, StrategyConfig>,
  states: Map<string, StrategyState>,
  routerState: RouterState,
  totalEquity: number
): { allowed: boolean; reason?: string; maxSize: number } {
  const strategy = strategies.get(strategyName)
  const state = states.get(strategyName)

  if (!strategy || !state) {
    return { allowed: false, reason: "Strategy not found", maxSize: 0 }
  }

  const maxPerMarket = strategy.maxExposurePerMarket * totalEquity
  const currentMarketExposure =
    routerState.strategyExposures.get(strategyName) ?? 0
  const remainingPerMarket = maxPerMarket - currentMarketExposure

  if (remainingPerMarket <= 0) {
    return {
      allowed: false,
      reason: "Market exposure limit reached",
      maxSize: 0,
    }
  }

  if (estimatedExposure > remainingPerMarket) {
    return {
      allowed: true,
      reason: "Exposure capped",
      maxSize: remainingPerMarket,
    }
  }

  return { allowed: true, maxSize: estimatedExposure }
}

export function calculateDynamicWeight(
  strategy: StrategyConfig,
  state: StrategyState,
  _performanceWindow: number = 20
): number {
  if (state.consecutiveFails >= 3) {
    return strategy.weight * 0.5
  }

  const winRate =
    state.opportunitiesExecuted > 0
      ? state.opportunitiesExecuted / Math.max(1, state.opportunitiesFound)
      : 0

  if (winRate < 0.3) {
    return strategy.weight * 0.7
  }

  if (winRate > 0.7 && state.intradayPnl > 0) {
    return strategy.weight * 1.2
  }

  return strategy.weight
}

export function rebalanceWeights(
  strategies: Map<string, StrategyConfig>,
  states: Map<string, StrategyState>
): Map<string, number> {
  const adjustedWeights = new Map<string, number>()

  for (const [name, strategy] of strategies) {
    const state = states.get(name)
    if (!state || !strategy.enabled) {
      adjustedWeights.set(name, 0)
      continue
    }

    if (state.status !== "active") {
      adjustedWeights.set(name, 0)
      continue
    }

    const dynamicWeight = calculateDynamicWeight(strategy, state)
    adjustedWeights.set(name, dynamicWeight)
  }

  const totalWeight = Array.from(adjustedWeights.values()).reduce(
    (sum, w) => sum + w,
    0
  )

  if (totalWeight === 0) return adjustedWeights

  for (const [name, weight] of adjustedWeights) {
    adjustedWeights.set(name, weight / totalWeight)
  }

  return adjustedWeights
}

export function checkDailyLimits(
  state: StrategyState,
  maxDailyLossPct: number = 0.05,
  maxDailyTrades: number = 100
): { allowed: boolean; reason?: string } {
  if (state.intradayPnl < -maxDailyLossPct) {
    return { allowed: false, reason: "Daily loss limit exceeded" }
  }

  if (state.opportunitiesExecuted >= maxDailyTrades) {
    return { allowed: false, reason: "Daily trade limit exceeded" }
  }

  return { allowed: true }
}

export function getPortfolioMetrics(
  strategies: Map<string, StrategyConfig>,
  states: Map<string, StrategyState>
): {
  totalPnl: number
  totalExposure: number
  activeStrategies: number
  avgWinRate: number
  avgEvBps: number
} {
  let totalPnl = 0
  let totalExposure = 0
  let activeCount = 0
  let weightedWinRate = 0
  let weightedEvBps = 0
  let totalOpportunities = 0

  for (const [name, strategy] of strategies) {
    const state = states.get(name)
    if (!state) continue

    totalPnl += state.intradayPnl
    totalExposure += state.currentExposure

    if (strategy.enabled && state.status === "active") {
      activeCount++
    }

    if (state.opportunitiesFound > 0) {
      totalOpportunities += state.opportunitiesFound
      weightedWinRate +=
        (state.opportunitiesExecuted / state.opportunitiesFound) *
        state.opportunitiesFound
      weightedEvBps += state.avgEvBps * state.opportunitiesFound
    }
  }

  return {
    totalPnl,
    totalExposure,
    activeStrategies: activeCount,
    avgWinRate:
      totalOpportunities > 0 ? weightedWinRate / totalOpportunities : 0,
    avgEvBps: totalOpportunities > 0 ? weightedEvBps / totalOpportunities : 0,
  }
}
