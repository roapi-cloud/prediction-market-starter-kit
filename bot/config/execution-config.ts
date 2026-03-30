import type { TwoLegExecutionConfig } from "../contracts/types"

export const DEFAULT_EXECUTION_CONFIG: TwoLegExecutionConfig = {
  strategy: "passive_then_ioc",
  legsTTLMs: 30000,
  hedgeTTLMs: 5000,
  maxSlippageBps: 50,
  maxHedgeAttempts: 3,
  partialFillThreshold: 0.5,
  queuePositionSimulation: true,
}

export function createExecutionConfig(
  overrides?: Partial<TwoLegExecutionConfig>
): TwoLegExecutionConfig {
  return { ...DEFAULT_EXECUTION_CONFIG, ...overrides }
}

export function validateExecutionConfig(
  config: TwoLegExecutionConfig
): string[] {
  const errors: string[] = []

  if (config.legsTTLMs <= 0) {
    errors.push("legsTTLMs must be positive")
  }
  if (config.hedgeTTLMs <= 0) {
    errors.push("hedgeTTLMs must be positive")
  }
  if (config.hedgeTTLMs >= config.legsTTLMs) {
    errors.push("hedgeTTLMs must be less than legsTTLMs")
  }
  if (config.maxSlippageBps <= 0) {
    errors.push("maxSlippageBps must be positive")
  }
  if (config.maxHedgeAttempts <= 0) {
    errors.push("maxHedgeAttempts must be positive")
  }
  if (config.partialFillThreshold <= 0 || config.partialFillThreshold > 1) {
    errors.push(
      "partialFillThreshold must be between 0 (exclusive) and 1 (inclusive)"
    )
  }

  return errors
}

export function getConfigForStrategy(
  strategy: TwoLegExecutionConfig["strategy"]
): TwoLegExecutionConfig {
  switch (strategy) {
    case "passive_then_ioc":
      return createExecutionConfig({
        strategy: "passive_then_ioc",
        legsTTLMs: 30000,
        hedgeTTLMs: 5000,
      })
    case "simultaneous":
      return createExecutionConfig({
        strategy: "simultaneous",
        legsTTLMs: 15000,
        hedgeTTLMs: 0,
      })
    case "ioc_both":
      return createExecutionConfig({
        strategy: "ioc_both",
        legsTTLMs: 5000,
        hedgeTTLMs: 0,
      })
    default:
      return DEFAULT_EXECUTION_CONFIG
  }
}
