import type { StrategyConfig, StrategyType } from "../contracts/types"

export const DEFAULT_STRATEGY_CONFIGS: Record<StrategyType, StrategyConfig> = {
  static_arb: {
    name: "static_arb",
    type: "static_arb",
    enabled: true,
    priority: 1,
    weight: 0.25,
    maxCapitalAllocation: 0.25,
    maxExposurePerMarket: 0.1,
    riskBudgetPct: 0.25,
    cooldownAfterFailMs: 60_000,
  },
  stat_arb: {
    name: "stat_arb",
    type: "stat_arb",
    enabled: true,
    priority: 2,
    weight: 0.3,
    maxCapitalAllocation: 0.3,
    maxExposurePerMarket: 0.15,
    riskBudgetPct: 0.3,
    cooldownAfterFailMs: 120_000,
  },
  microstructure: {
    name: "microstructure",
    type: "microstructure",
    enabled: true,
    priority: 3,
    weight: 0.25,
    maxCapitalAllocation: 0.2,
    maxExposurePerMarket: 0.05,
    riskBudgetPct: 0.2,
    cooldownAfterFailMs: 30_000,
  },
  term_structure: {
    name: "term_structure",
    type: "term_structure",
    enabled: true,
    priority: 4,
    weight: 0.2,
    maxCapitalAllocation: 0.15,
    maxExposurePerMarket: 0.1,
    riskBudgetPct: 0.15,
    cooldownAfterFailMs: 180_000,
  },
}

export function createStrategyConfig(
  name: string,
  type: StrategyType,
  overrides: Partial<StrategyConfig> = {}
): StrategyConfig {
  return {
    ...DEFAULT_STRATEGY_CONFIGS[type],
    name,
    ...overrides,
  }
}

export function validateStrategyConfig(config: StrategyConfig): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []

  if (!config.name || config.name.trim() === "") {
    errors.push("Strategy name is required")
  }

  if (config.weight < 0 || config.weight > 1) {
    errors.push("Weight must be between 0 and 1")
  }

  if (config.maxCapitalAllocation < 0 || config.maxCapitalAllocation > 1) {
    errors.push("Max capital allocation must be between 0 and 1")
  }

  if (config.maxExposurePerMarket < 0 || config.maxExposurePerMarket > 1) {
    errors.push("Max exposure per market must be between 0 and 1")
  }

  if (config.riskBudgetPct < 0 || config.riskBudgetPct > 1) {
    errors.push("Risk budget percentage must be between 0 and 1")
  }

  if (config.cooldownAfterFailMs < 0) {
    errors.push("Cooldown after fail must be non-negative")
  }

  if (config.priority < 0) {
    errors.push("Priority must be non-negative")
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

export function adjustStrategyWeightsForRisk(
  configs: Map<string, StrategyConfig>,
  riskFactor: number
): Map<string, number> {
  const adjustedWeights = new Map<string, number>()

  for (const [name, config] of configs) {
    const adjustedWeight = config.weight * riskFactor
    const cappedWeight = Math.min(adjustedWeight, config.maxCapitalAllocation)
    adjustedWeights.set(name, cappedWeight)
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

export type StrategyProfile = "conservative" | "balanced" | "aggressive"

export const STRATEGY_PROFILES: Record<
  StrategyProfile,
  Partial<Record<StrategyType, Partial<StrategyConfig>>>
> = {
  conservative: {
    static_arb: { weight: 0.4, maxCapitalAllocation: 0.3, riskBudgetPct: 0.15 },
    stat_arb: { weight: 0.2, maxCapitalAllocation: 0.15, riskBudgetPct: 0.1 },
    microstructure: {
      weight: 0.15,
      maxCapitalAllocation: 0.1,
      riskBudgetPct: 0.05,
    },
    term_structure: {
      weight: 0.25,
      maxCapitalAllocation: 0.2,
      riskBudgetPct: 0.15,
    },
  },
  balanced: {
    static_arb: {
      weight: 0.25,
      maxCapitalAllocation: 0.25,
      riskBudgetPct: 0.25,
    },
    stat_arb: { weight: 0.3, maxCapitalAllocation: 0.3, riskBudgetPct: 0.3 },
    microstructure: {
      weight: 0.25,
      maxCapitalAllocation: 0.2,
      riskBudgetPct: 0.2,
    },
    term_structure: {
      weight: 0.2,
      maxCapitalAllocation: 0.15,
      riskBudgetPct: 0.15,
    },
  },
  aggressive: {
    static_arb: { weight: 0.15, maxCapitalAllocation: 0.2, riskBudgetPct: 0.2 },
    stat_arb: { weight: 0.35, maxCapitalAllocation: 0.4, riskBudgetPct: 0.4 },
    microstructure: {
      weight: 0.3,
      maxCapitalAllocation: 0.3,
      riskBudgetPct: 0.25,
    },
    term_structure: {
      weight: 0.2,
      maxCapitalAllocation: 0.2,
      riskBudgetPct: 0.2,
    },
  },
}

export function applyStrategyProfile(
  profile: StrategyProfile
): Map<string, StrategyConfig> {
  const profileOverrides = STRATEGY_PROFILES[profile]
  const configs = new Map<string, StrategyConfig>()

  for (const type of Object.keys(DEFAULT_STRATEGY_CONFIGS) as StrategyType[]) {
    const overrides = profileOverrides[type] ?? {}
    configs.set(type, createStrategyConfig(type, type, overrides))
  }

  return configs
}

export function getEnabledStrategies(
  configs: Map<string, StrategyConfig>
): StrategyConfig[] {
  return Array.from(configs.values()).filter((c) => c.enabled)
}

export function getHighPriorityStrategies(
  configs: Map<string, StrategyConfig>,
  minPriority: number
): StrategyConfig[] {
  return Array.from(configs.values()).filter(
    (c) => c.enabled && c.priority >= minPriority
  )
}

export function calculateTotalWeight(
  configs: Map<string, StrategyConfig>
): number {
  return Array.from(configs.values())
    .filter((c) => c.enabled)
    .reduce((sum, c) => sum + c.weight, 0)
}

export function normalizeWeights(configs: Map<string, StrategyConfig>): void {
  const enabledConfigs = Array.from(configs.values()).filter((c) => c.enabled)
  const totalWeight = enabledConfigs.reduce((sum, c) => sum + c.weight, 0)

  if (totalWeight === 0 || totalWeight === 1) return

  for (const config of enabledConfigs) {
    config.weight = config.weight / totalWeight
  }
}
