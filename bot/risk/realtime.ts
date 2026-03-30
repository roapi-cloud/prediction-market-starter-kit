import type { RiskStateEnhanced, RiskConfigEnhanced } from "../contracts/types"
import {
  checkDrawdown,
  checkIntradayLoss,
  shouldTriggerKillSwitch,
} from "./drawdown"

export function shouldTriggerDrawdownStop(
  intradayPnlPct: number,
  drawdownPct: number
): boolean {
  return intradayPnlPct <= -2 || drawdownPct <= -4
}

export function shouldTriggerDrawdownStopEnhanced(
  state: RiskStateEnhanced,
  config: RiskConfigEnhanced
): { shouldStop: boolean; reason?: string } {
  const result = shouldTriggerKillSwitch(state, config)
  return { shouldStop: result.trigger, reason: result.reason }
}

export function getDrawdownStatus(
  state: RiskStateEnhanced,
  config: RiskConfigEnhanced
): {
  drawdownPct: number
  isBreached: boolean
  severity: "none" | "warning" | "critical"
} {
  const drawdownPct = state.drawdown
  const check = checkDrawdown(state, config)
  return { drawdownPct, isBreached: check.isBreached, severity: check.severity }
}

export function getIntradayLossStatus(
  state: RiskStateEnhanced,
  config: RiskConfigEnhanced
): {
  lossPct: number
  lossAbs: number
  isBreached: boolean
  severity: "none" | "warning" | "critical"
} {
  const lossAbs = Math.abs(state.intradayPnl)
  const lossPct = state.equity > 0 ? lossAbs / state.equity : 0
  const check = checkIntradayLoss(state, config)
  return {
    lossPct,
    lossAbs,
    isBreached: check.isBreached,
    severity: check.severity,
  }
}
