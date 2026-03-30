import type { RiskStateEnhanced, RiskConfigEnhanced } from "../contracts/types"

export function checkDrawdown(
  state: RiskStateEnhanced,
  config: RiskConfigEnhanced
): {
  isBreached: boolean
  reason?: string
  severity: "none" | "warning" | "critical"
} {
  const drawdownPct =
    state.peakEquity > 0
      ? (state.peakEquity - state.equity) / state.peakEquity
      : 0

  if (drawdownPct >= config.maxDrawdownPct) {
    return {
      isBreached: true,
      reason: `DRAWDOWN_BREACH:${(drawdownPct * 100).toFixed(2)}%>=${(config.maxDrawdownPct * 100).toFixed(2)}%`,
      severity: "critical",
    }
  }

  if (drawdownPct >= config.maxDrawdownPct * 0.75) {
    return {
      isBreached: false,
      reason: `DRAWDOWN_WARNING:${(drawdownPct * 100).toFixed(2)}%>=${(config.maxDrawdownPct * 75).toFixed(2)}%`,
      severity: "warning",
    }
  }

  return { isBreached: false, severity: "none" }
}

export function checkIntradayLoss(
  state: RiskStateEnhanced,
  config: RiskConfigEnhanced
): {
  isBreached: boolean
  reason?: string
  severity: "none" | "warning" | "critical"
} {
  const lossPct =
    state.equity > 0 ? Math.abs(state.intradayPnl) / state.equity : 0
  const lossAbs = Math.abs(state.intradayPnl)

  if (
    lossPct >= config.maxIntradayLossPct ||
    lossAbs >= config.maxIntradayLoss
  ) {
    return {
      isBreached: true,
      reason: `INTRADAY_LOSS_BREACH:${lossAbs.toFixed(2)}(@${(lossPct * 100).toFixed(2)}%)`,
      severity: "critical",
    }
  }

  if (
    lossPct >= config.maxIntradayLossPct * 0.75 ||
    lossAbs >= config.maxIntradayLoss * 0.75
  ) {
    return {
      isBreached: false,
      reason: `INTRADAY_LOSS_WARNING:${lossAbs.toFixed(2)}(@${(lossPct * 100).toFixed(2)}%)`,
      severity: "warning",
    }
  }

  return { isBreached: false, severity: "none" }
}

export function updateDrawdownState(
  state: RiskStateEnhanced,
  newEquity: number
): RiskStateEnhanced {
  const peakEquity = Math.max(state.peakEquity, newEquity)
  const drawdown = peakEquity > 0 ? (peakEquity - newEquity) / peakEquity : 0

  return {
    ...state,
    equity: newEquity,
    peakEquity,
    drawdown,
  }
}

export function updateIntradayPnl(
  state: RiskStateEnhanced,
  pnl: number
): RiskStateEnhanced {
  return {
    ...state,
    intradayPnl: state.intradayPnl + pnl,
  }
}

export function shouldTriggerKillSwitch(
  state: RiskStateEnhanced,
  config: RiskConfigEnhanced
): { trigger: boolean; reason?: string } {
  const drawdownCheck = checkDrawdown(state, config)
  if (drawdownCheck.isBreached) {
    return { trigger: true, reason: drawdownCheck.reason }
  }

  const intradayCheck = checkIntradayLoss(state, config)
  if (intradayCheck.isBreached) {
    return { trigger: true, reason: intradayCheck.reason }
  }

  if (state.killSwitch) {
    return {
      trigger: true,
      reason: state.killSwitchReason || "KILL_SWITCH_ACTIVE",
    }
  }

  return { trigger: false }
}

export function calculateRiskMetrics(state: RiskStateEnhanced): {
  drawdownPct: number
  intradayLossPct: number
  openExposurePct: number
  riskScore: number
} {
  const drawdownPct = state.drawdown
  const intradayLossPct =
    state.equity > 0 ? Math.abs(state.intradayPnl) / state.equity : 0
  const openExposurePct =
    state.equity > 0 ? state.openExposure / state.equity : 0

  const riskScore = Math.min(
    1,
    drawdownPct * 0.4 + intradayLossPct * 0.3 + openExposurePct * 0.3
  )

  return {
    drawdownPct,
    intradayLossPct,
    openExposurePct,
    riskScore,
  }
}

export function getRiskWarnings(
  state: RiskStateEnhanced,
  config: RiskConfigEnhanced
): string[] {
  const warnings: string[] = []

  const drawdownCheck = checkDrawdown(state, config)
  if (drawdownCheck.reason) {
    warnings.push(drawdownCheck.reason)
  }

  const intradayCheck = checkIntradayLoss(state, config)
  if (intradayCheck.reason) {
    warnings.push(intradayCheck.reason)
  }

  const metrics = calculateRiskMetrics(state)
  if (metrics.riskScore > 0.7) {
    warnings.push(`HIGH_RISK_SCORE:${(metrics.riskScore * 100).toFixed(1)}%`)
  }

  if (state.consecutiveFails >= config.consecutiveFailThreshold * 0.6) {
    warnings.push(
      `CONSECUTIVE_FAILS_WARNING:${state.consecutiveFails}/${config.consecutiveFailThreshold}`
    )
  }

  if (state.restrictedStrategies.length > 0) {
    warnings.push(
      `RESTRICTED_STRATEGIES:${state.restrictedStrategies.join(",")}`
    )
  }

  return warnings
}
