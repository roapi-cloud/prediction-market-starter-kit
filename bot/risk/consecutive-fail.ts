import type {
  RiskStateEnhanced,
  RiskConfigEnhanced,
  ExecutionResult,
} from "../contracts/types"

export type FailReason =
  | "INCOMPLETE_LEGS"
  | "SLIPPAGE_EXCEEDED"
  | "NET_LOSS"
  | "REJECTED"
  | "TIMEOUT"

export function classifyFailReason(result: ExecutionResult): FailReason | null {
  if (result.success) return null

  if (result.reason === "incomplete_legs") return "INCOMPLETE_LEGS"
  if (result.reason === "slippage_exceeded") return "SLIPPAGE_EXCEEDED"
  if (result.reason === "rejected") return "REJECTED"
  if (result.reason === "timeout") return "TIMEOUT"
  if (result.pnl < 0) return "NET_LOSS"

  return "INCOMPLETE_LEGS"
}

export function updateConsecutiveFails(
  result: ExecutionResult,
  state: RiskStateEnhanced
): RiskStateEnhanced {
  const failReason = classifyFailReason(result)

  if (failReason === null) {
    return {
      ...state,
      consecutiveFails: 0,
      consecutiveFailsByStrategy: resetStrategyFails(
        state.consecutiveFailsByStrategy,
        result.strategy
      ),
    }
  }

  const strategyFails = new Map(state.consecutiveFailsByStrategy)
  const currentStrategyFails = strategyFails.get(result.strategy) || 0
  strategyFails.set(result.strategy, currentStrategyFails + 1)

  return {
    ...state,
    consecutiveFails: state.consecutiveFails + 1,
    consecutiveFailsByStrategy: strategyFails,
    lastFailTime: result.ts,
  }
}

export function checkConsecutiveFail(
  state: RiskStateEnhanced,
  config: RiskConfigEnhanced,
  now: number = Date.now()
): { shouldPause: boolean; strategy?: string; reason?: string } {
  if (state.killSwitch) {
    return { shouldPause: true, reason: "KILL_SWITCH_ACTIVE" }
  }

  if (state.consecutiveFails >= config.consecutiveFailThreshold) {
    const cooldownElapsed = now - state.lastFailTime >= config.failCooldownMs
    if (!cooldownElapsed) {
      return {
        shouldPause: true,
        reason: `CONSECUTIVE_FAILS_THRESHOLD:${state.consecutiveFails}/${config.consecutiveFailThreshold}`,
      }
    }
  }

  for (const [strategy, fails] of state.consecutiveFailsByStrategy) {
    if (fails >= config.consecutiveFailThreshold) {
      const cooldownElapsed = now - state.lastFailTime >= config.failCooldownMs
      if (!cooldownElapsed) {
        return {
          shouldPause: true,
          strategy,
          reason: `STRATEGY_FAIL_THRESHOLD:${strategy}:${fails}/${config.consecutiveFailThreshold}`,
        }
      }
    }
  }

  return { shouldPause: false }
}

export function resetConsecutiveFail(
  state: RiskStateEnhanced,
  strategy?: string
): RiskStateEnhanced {
  if (strategy) {
    const strategyFails = new Map(state.consecutiveFailsByStrategy)
    strategyFails.delete(strategy)
    const totalFails = Array.from(strategyFails.values()).reduce(
      (sum, f) => sum + f,
      0
    )

    return {
      ...state,
      consecutiveFails: totalFails,
      consecutiveFailsByStrategy: strategyFails,
    }
  }

  return {
    ...state,
    consecutiveFails: 0,
    consecutiveFailsByStrategy: new Map(),
  }
}

export function getRestrictedStrategies(
  state: RiskStateEnhanced,
  config: RiskConfigEnhanced,
  now: number = Date.now()
): string[] {
  const restricted: string[] = []

  for (const [strategy, fails] of state.consecutiveFailsByStrategy) {
    if (fails >= config.consecutiveFailThreshold) {
      const cooldownElapsed = now - state.lastFailTime >= config.failCooldownMs
      if (!cooldownElapsed) {
        restricted.push(strategy)
      }
    }
  }

  return restricted
}

export function isStrategyRestricted(
  strategy: string,
  state: RiskStateEnhanced,
  config: RiskConfigEnhanced,
  now: number = Date.now()
): boolean {
  const fails = state.consecutiveFailsByStrategy.get(strategy) || 0
  if (fails < config.consecutiveFailThreshold) return false

  const cooldownElapsed = now - state.lastFailTime >= config.failCooldownMs
  return !cooldownElapsed
}

function resetStrategyFails(
  failsByStrategy: Map<string, number>,
  strategy: string
): Map<string, number> {
  const newMap = new Map(failsByStrategy)
  newMap.delete(strategy)
  return newMap
}
