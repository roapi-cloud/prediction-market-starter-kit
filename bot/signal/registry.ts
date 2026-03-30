import type {
  StrategyConfig,
  StrategyState,
  StrategyStats,
  StrategyRegistry,
  StrategyType,
  StrategyExecutionResult,
} from "../contracts/types"

export function createDefaultStrategyConfig(
  name: string,
  type: StrategyType,
  overrides: Partial<StrategyConfig> = {}
): StrategyConfig {
  const defaults: Record<StrategyType, Partial<StrategyConfig>> = {
    static_arb: {
      priority: 1,
      weight: 0.25,
      maxCapitalAllocation: 0.25,
      maxExposurePerMarket: 0.1,
      riskBudgetPct: 0.25,
      cooldownAfterFailMs: 60_000,
    },
    stat_arb: {
      priority: 2,
      weight: 0.3,
      maxCapitalAllocation: 0.3,
      maxExposurePerMarket: 0.15,
      riskBudgetPct: 0.3,
      cooldownAfterFailMs: 120_000,
    },
    microstructure: {
      priority: 3,
      weight: 0.25,
      maxCapitalAllocation: 0.2,
      maxExposurePerMarket: 0.05,
      riskBudgetPct: 0.2,
      cooldownAfterFailMs: 30_000,
    },
    term_structure: {
      priority: 4,
      weight: 0.2,
      maxCapitalAllocation: 0.15,
      maxExposurePerMarket: 0.1,
      riskBudgetPct: 0.15,
      cooldownAfterFailMs: 180_000,
    },
  }

  return {
    name,
    type,
    enabled: true,
    priority: defaults[type].priority ?? 0,
    weight: defaults[type].weight ?? 0.25,
    maxCapitalAllocation: defaults[type].maxCapitalAllocation ?? 0.2,
    maxExposurePerMarket: defaults[type].maxExposurePerMarket ?? 0.1,
    riskBudgetPct: defaults[type].riskBudgetPct ?? 0.2,
    cooldownAfterFailMs: defaults[type].cooldownAfterFailMs ?? 60_000,
    ...overrides,
  }
}

export function createDefaultStrategyState(
  name: string,
  type: StrategyType
): StrategyState {
  return {
    name,
    type,
    status: "active",
    currentExposure: 0,
    intradayPnl: 0,
    opportunitiesFound: 0,
    opportunitiesExecuted: 0,
    consecutiveFails: 0,
    avgEvBps: 0,
    winRate: 0,
    lockedMarkets: new Set(),
  }
}

export class StrategyRegistryManager {
  private registry: StrategyRegistry

  constructor() {
    this.registry = {
      strategies: new Map(),
      states: new Map(),
    }
  }

  registerStrategy(config: StrategyConfig): void {
    this.registry.strategies.set(config.name, config)
    if (!this.registry.states.has(config.name)) {
      this.registry.states.set(
        config.name,
        createDefaultStrategyState(config.name, config.type)
      )
    }
  }

  unregisterStrategy(name: string): void {
    this.registry.strategies.delete(name)
    this.registry.states.delete(name)
  }

  enableStrategy(name: string): void {
    const config = this.registry.strategies.get(name)
    if (config) {
      config.enabled = true
    }
    const state = this.registry.states.get(name)
    if (state && state.status === "disabled") {
      state.status = "active"
    }
  }

  disableStrategy(name: string): void {
    const config = this.registry.strategies.get(name)
    if (config) {
      config.enabled = false
    }
    const state = this.registry.states.get(name)
    if (state) {
      state.status = "disabled"
    }
  }

  pauseStrategy(name: string): void {
    const state = this.registry.states.get(name)
    if (state) {
      state.status = "paused"
    }
  }

  resumeStrategy(name: string): void {
    const state = this.registry.states.get(name)
    if (state) {
      state.status = "active"
    }
  }

  updateStrategyWeight(name: string, weight: number): void {
    const config = this.registry.strategies.get(name)
    if (config) {
      config.weight = Math.max(0, Math.min(1, weight))
    }
  }

  getStrategyConfig(name: string): StrategyConfig | undefined {
    return this.registry.strategies.get(name)
  }

  getStrategyState(name: string): StrategyState | undefined {
    return this.registry.states.get(name)
  }

  getRegistry(): StrategyRegistry {
    return this.registry
  }

  getActiveStrategies(): StrategyConfig[] {
    return Array.from(this.registry.strategies.values()).filter(
      (config) => config.enabled
    )
  }

  updateStrategyState(name: string, result: StrategyExecutionResult): void {
    const state = this.registry.states.get(name)
    if (!state) return

    if (result.success) {
      state.consecutiveFails = 0
      if (result.pnl !== undefined) {
        state.intradayPnl += result.pnl
      }
      state.opportunitiesExecuted += 1
    } else {
      state.consecutiveFails += 1
      state.lastFailTime = result.ts
      state.status = "cooldown"
    }

    if (result.exposure !== undefined) {
      state.currentExposure = result.exposure
    }

    for (const marketId of result.marketIds) {
      if (result.success) {
        state.lockedMarkets.delete(marketId)
      } else {
        state.lockedMarkets.add(marketId)
      }
    }
  }

  checkCooldown(name: string, now: number): boolean {
    const config = this.registry.strategies.get(name)
    const state = this.registry.states.get(name)

    if (!config || !state) return false

    if (state.status !== "cooldown") return state.status === "active"

    if (state.lastFailTime !== undefined) {
      const elapsed = now - state.lastFailTime
      if (elapsed >= config.cooldownAfterFailMs) {
        state.status = "active"
        return true
      }
    }

    return false
  }

  resetIntradayStats(): void {
    for (const state of this.registry.states.values()) {
      state.intradayPnl = 0
      state.opportunitiesFound = 0
      state.opportunitiesExecuted = 0
    }
  }

  incrementOpportunitiesFound(name: string): void {
    const state = this.registry.states.get(name)
    if (state) {
      state.opportunitiesFound += 1
      state.lastOpportunityTime = Date.now()
    }
  }

  lockMarket(name: string, marketId: string): void {
    const state = this.registry.states.get(name)
    if (state) {
      state.lockedMarkets.add(marketId)
    }
  }

  unlockMarket(name: string, marketId: string): void {
    const state = this.registry.states.get(name)
    if (state) {
      state.lockedMarkets.delete(marketId)
    }
  }

  isMarketLocked(name: string, marketId: string): boolean {
    const state = this.registry.states.get(name)
    return state?.lockedMarkets.has(marketId) ?? false
  }

  getStrategyStats(name: string): StrategyStats | null {
    const config = this.registry.strategies.get(name)
    const state = this.registry.states.get(name)

    if (!config || !state) return null

    const winRate =
      state.opportunitiesExecuted > 0
        ? state.opportunitiesExecuted / Math.max(1, state.opportunitiesFound)
        : 0

    return {
      name: state.name,
      type: state.type,
      totalOpportunities: state.opportunitiesFound,
      executedOpportunities: state.opportunitiesExecuted,
      totalPnl: state.intradayPnl,
      avgEvBps: state.avgEvBps,
      winRate,
      avgHoldTimeMs: 0,
    }
  }

  getAllStrategyStats(): Map<string, StrategyStats> {
    const stats = new Map<string, StrategyStats>()
    for (const name of this.registry.strategies.keys()) {
      const stat = this.getStrategyStats(name)
      if (stat) {
        stats.set(name, stat)
      }
    }
    return stats
  }

  normalizeWeights(): void {
    const activeStrategies = this.getActiveStrategies()
    const totalWeight = activeStrategies.reduce((sum, s) => sum + s.weight, 0)

    if (totalWeight === 0) return

    for (const strategy of activeStrategies) {
      strategy.weight = strategy.weight / totalWeight
    }
  }
}
