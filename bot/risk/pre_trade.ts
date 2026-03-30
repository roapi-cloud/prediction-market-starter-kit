import type {
  Opportunity,
  RiskDecision,
  RiskStateEnhanced,
  RiskDecisionEnhanced,
  RiskConfigEnhanced,
} from "../contracts/types"
import { RiskEngineEnhanced, createDefaultRiskState } from "./engine-enhanced"

export function preTradeCheck(
  opportunity: Opportunity,
  openNotional: number,
  maxOpenNotional: number
): RiskDecision {
  if (openNotional >= maxOpenNotional) {
    return { allow: false, reason: "MAX_OPEN_NOTIONAL", killSwitch: false }
  }
  if (opportunity.evBps <= 0) {
    return { allow: false, reason: "NON_POSITIVE_EV", killSwitch: false }
  }
  return { allow: true, maxSize: 100, maxSlippageBps: 30, killSwitch: false }
}

export function preTradeCheckEnhanced(
  opportunity: Opportunity,
  state: RiskStateEnhanced,
  config: RiskConfigEnhanced
): RiskDecisionEnhanced {
  const engine = new RiskEngineEnhanced(config)
  return engine.preTradeCheck(opportunity, state)
}

export { createDefaultRiskState }
