import type {
  RiskConfigEnhanced,
  RiskStateEnhanced,
  RiskDecisionEnhanced,
  Opportunity,
  ExecutionResult,
  SlippageFeedback,
  Position,
} from "../contracts/types"
import { getDefaultRiskConfig } from "../config/risk-config"
import {
  updateConsecutiveFails,
  checkConsecutiveFail,
  resetConsecutiveFail,
  isStrategyRestricted,
  getRestrictedStrategies,
} from "./consecutive-fail"
import {
  computeCombinedExposure,
  checkCorrelationRisk,
  buildCorrelationMatrix,
  getCorrelation,
} from "./correlation-risk"
import {
  updateSlippageStats,
  getSlippageAdjustment,
  getSlippageWarnings,
} from "./slippage-calibration"
import {
  checkDrawdown,
  checkIntradayLoss,
  updateDrawdownState,
  updateIntradayPnl,
  shouldTriggerKillSwitch,
  getRiskWarnings,
} from "./drawdown"

export { buildCorrelationMatrix }

export class RiskEngineEnhanced {
  private config: RiskConfigEnhanced

  constructor(config?: Partial<RiskConfigEnhanced>) {
    this.config = { ...getDefaultRiskConfig(), ...config }
  }

  preTradeCheck(
    opportunity: Opportunity,
    state: RiskStateEnhanced
  ): RiskDecisionEnhanced {
    const warnings: string[] = []

    if (state.killSwitch) {
      return {
        allow: false,
        reason: `KILL_SWITCH:${state.killSwitchReason || "ACTIVE"}`,
        killSwitch: true,
        warnings: [
          ...warnings,
          `KILL_SWITCH_ACTIVE:${state.killSwitchReason || "ACTIVE"}`,
        ],
        slippageAdjustment: 0,
        correlationWarning: false,
      }
    }

    if (opportunity.evBps <= 0) {
      return {
        allow: false,
        reason: "NON_POSITIVE_EV",
        killSwitch: false,
        warnings,
        slippageAdjustment: 0,
        correlationWarning: false,
      }
    }

    const failCheck = checkConsecutiveFail(state, this.config)
    if (failCheck.shouldPause) {
      return {
        allow: false,
        reason: failCheck.reason,
        killSwitch: false,
        warnings: [...warnings, failCheck.reason || "CONSECUTIVE_FAILS"],
        slippageAdjustment: 0,
        correlationWarning: false,
      }
    }

    if (isStrategyRestricted(opportunity.strategy, state, this.config)) {
      return {
        allow: false,
        reason: `STRATEGY_RESTRICTED:${opportunity.strategy}`,
        killSwitch: false,
        warnings: [...warnings, `STRATEGY_RESTRICTED:${opportunity.strategy}`],
        slippageAdjustment: 0,
        correlationWarning: false,
      }
    }

    const drawdownCheck = checkDrawdown(state, this.config)
    if (drawdownCheck.isBreached) {
      return {
        allow: false,
        reason: drawdownCheck.reason,
        killSwitch: true,
        warnings: [...warnings, drawdownCheck.reason || "DRAWDOWN_BREACH"],
        slippageAdjustment: 0,
        correlationWarning: false,
      }
    }
    if (drawdownCheck.severity === "warning") {
      warnings.push(drawdownCheck.reason!)
    }

    const intradayCheck = checkIntradayLoss(state, this.config)
    if (intradayCheck.isBreached) {
      return {
        allow: false,
        reason: intradayCheck.reason,
        killSwitch: true,
        warnings: [...warnings, intradayCheck.reason || "INTRADAY_LOSS_BREACH"],
        slippageAdjustment: 0,
        correlationWarning: false,
      }
    }
    if (intradayCheck.severity === "warning") {
      warnings.push(intradayCheck.reason!)
    }

    const correlationCheck = checkCorrelationRisk(
      state,
      opportunity,
      this.config
    )
    let correlationWarning = false
    if (correlationCheck.hasRisk) {
      correlationWarning = true
      warnings.push(correlationCheck.warning!)

      if (
        correlationCheck.projectedExposure >
        this.config.maxCombinedExposure * 1.5
      ) {
        return {
          allow: false,
          reason: correlationCheck.warning,
          killSwitch: false,
          warnings,
          slippageAdjustment: 0,
          correlationWarning: true,
        }
      }
    }

    const positions = Array.from(state.positions.values())
    const currentExposure = computeCombinedExposure(
      positions,
      this.config.correlationMatrix
    )
    const remainingCapacity = Math.max(
      0,
      this.config.maxCombinedExposure - currentExposure
    )
    const maxSize = Math.min(
      this.config.maxPositionSize,
      remainingCapacity > 0 ? remainingCapacity : this.config.maxPositionSize
    )

    if (maxSize < 1) {
      return {
        allow: false,
        reason: "INSUFFICIENT_CAPACITY",
        killSwitch: false,
        warnings,
        slippageAdjustment: 0,
        correlationWarning,
      }
    }

    const slippageAdjustment = getSlippageAdjustment(
      opportunity.marketIds[0] || "",
      opportunity.strategy,
      state.slippageStats
    )

    const baseMaxSlippageBps = 30
    const maxSlippageBps = Math.max(
      baseMaxSlippageBps,
      slippageAdjustment * 1.5
    )

    warnings.push(...getRiskWarnings(state, this.config))

    return {
      allow: true,
      maxSize,
      maxSlippageBps,
      killSwitch: false,
      warnings,
      slippageAdjustment,
      correlationWarning,
    }
  }

  onTradeResult(
    result: ExecutionResult,
    state: RiskStateEnhanced
  ): RiskStateEnhanced {
    let newState = updateConsecutiveFails(result, state)

    newState = updateIntradayPnl(newState, result.pnl)

    if (
      !result.success &&
      newState.consecutiveFails >= this.config.consecutiveFailThreshold
    ) {
      const failCheck = checkConsecutiveFail(newState, this.config)
      if (failCheck.shouldPause) {
        newState = {
          ...newState,
          restrictedStrategies: getRestrictedStrategies(newState, this.config),
        }
      }
    }

    if (result.pnl < 0) {
      const shouldKill = shouldTriggerKillSwitch(newState, this.config)
      if (shouldKill.trigger) {
        newState = this.triggerKillSwitch(
          newState,
          shouldKill.reason || "AUTO_TRIGGER"
        )
      }
    }

    return newState
  }

  onSlippageFeedback(
    feedback: SlippageFeedback,
    state: RiskStateEnhanced
  ): RiskStateEnhanced {
    const newStats = updateSlippageStats(
      feedback,
      state.slippageStats,
      this.config.slippageCalibrationWindow
    )

    const warnings = getSlippageWarnings(
      feedback,
      state.slippageStats,
      this.config.slippageAlertThreshold
    )

    let newState = {
      ...state,
      slippageStats: newStats,
    }

    if (warnings.length > 0) {
      const killSwitchReason = warnings.find((w) =>
        w.startsWith("SLIPPAGE_ALERT")
      )
      if (
        killSwitchReason &&
        feedback.actualSlippageBps > this.config.slippageAlertThreshold * 2
      ) {
        newState = this.triggerKillSwitch(newState, killSwitchReason)
      }
    }

    return newState
  }

  resetConsecutiveFail(
    state: RiskStateEnhanced,
    strategy?: string
  ): RiskStateEnhanced {
    return resetConsecutiveFail(state, strategy)
  }

  computeCombinedExposure(
    positions: Position[],
    correlations: Map<string, Map<string, number>>
  ): number {
    return computeCombinedExposure(positions, correlations)
  }

  checkCorrelationRisk(
    state: RiskStateEnhanced,
    newOpportunity: Opportunity
  ): boolean {
    const result = checkCorrelationRisk(state, newOpportunity, this.config)
    return result.hasRisk
  }

  getSlippageAdjustment(
    marketId: string,
    strategy: string,
    stats: Map<string, SlippageFeedback>
  ): number {
    const slippageStats = new Map<
      string,
      {
        marketId: string
        strategy: string
        count: number
        meanBps: number
        stdBps: number
        p95Bps: number
        p99Bps: number
        lastUpdate: number
        samples: number[]
      }
    >()
    return getSlippageAdjustment(marketId, strategy, slippageStats)
  }

  checkDrawdown(state: RiskStateEnhanced): boolean {
    const result = checkDrawdown(state, this.config)
    return result.isBreached
  }

  triggerKillSwitch(
    state: RiskStateEnhanced,
    reason: string
  ): RiskStateEnhanced {
    return {
      ...state,
      killSwitch: true,
      killSwitchReason: reason,
    }
  }

  releaseKillSwitch(state: RiskStateEnhanced): RiskStateEnhanced {
    return {
      ...state,
      killSwitch: false,
      killSwitchReason: undefined,
    }
  }

  updatePositions(
    state: RiskStateEnhanced,
    positions: Map<string, Position>
  ): RiskStateEnhanced {
    const positionsArray = Array.from(positions.values())
    const openExposure = positionsArray.reduce(
      (sum, p) => sum + p.size * p.currentPrice,
      0
    )
    const combinedExposure = computeCombinedExposure(
      positionsArray,
      this.config.correlationMatrix
    )

    return {
      ...state,
      positions,
      openExposure,
      combinedExposure,
    }
  }

  updateEquity(state: RiskStateEnhanced, newEquity: number): RiskStateEnhanced {
    return updateDrawdownState(state, newEquity)
  }

  getWarnings(state: RiskStateEnhanced): string[] {
    return getRiskWarnings(state, this.config)
  }

  getConfig(): RiskConfigEnhanced {
    return this.config
  }

  updateConfig(updates: Partial<RiskConfigEnhanced>): void {
    this.config = { ...this.config, ...updates }
  }
}

export function createDefaultRiskState(
  initialEquity: number = 10_000
): RiskStateEnhanced {
  return {
    equity: initialEquity,
    intradayPnl: 0,
    peakEquity: initialEquity,
    drawdown: 0,
    openExposure: 0,
    combinedExposure: 0,
    consecutiveFails: 0,
    consecutiveFailsByStrategy: new Map(),
    killSwitch: false,
    restrictedStrategies: [],
    lastFailTime: 0,
    slippageStats: new Map(),
    positions: new Map(),
    killSwitchReason: undefined,
  }
}

export function getCorrelationRisk(
  config: RiskConfigEnhanced,
  marketA: string,
  marketB: string
): number {
  return getCorrelation(marketA, marketB, config.correlationMatrix)
}
