import type { RiskConfigEnhanced } from "../contracts/types"

export function getDefaultRiskConfig(
  initialEquity: number = 10_000
): RiskConfigEnhanced {
  return {
    maxPositionSize: initialEquity * 0.1,
    maxMarketExposure: initialEquity * 0.2,
    maxIntradayLoss: initialEquity * 0.02,
    maxIntradayLossPct: 0.02,
    maxDrawdownPct: 0.04,
    consecutiveFailThreshold: 5,
    failCooldownMs: 300_000,
    correlationMatrix: new Map(),
    maxCombinedExposure: initialEquity * 0.3,
    slippageAlertThreshold: 100,
    slippageCalibrationWindow: 100,
  }
}

export function getConservativeRiskConfig(
  initialEquity: number = 10_000
): RiskConfigEnhanced {
  return {
    maxPositionSize: initialEquity * 0.05,
    maxMarketExposure: initialEquity * 0.1,
    maxIntradayLoss: initialEquity * 0.01,
    maxIntradayLossPct: 0.01,
    maxDrawdownPct: 0.02,
    consecutiveFailThreshold: 3,
    failCooldownMs: 600_000,
    correlationMatrix: new Map(),
    maxCombinedExposure: initialEquity * 0.15,
    slippageAlertThreshold: 50,
    slippageCalibrationWindow: 50,
  }
}

export function getAggressiveRiskConfig(
  initialEquity: number = 10_000
): RiskConfigEnhanced {
  return {
    maxPositionSize: initialEquity * 0.2,
    maxMarketExposure: initialEquity * 0.3,
    maxIntradayLoss: initialEquity * 0.05,
    maxIntradayLossPct: 0.05,
    maxDrawdownPct: 0.08,
    consecutiveFailThreshold: 8,
    failCooldownMs: 120_000,
    correlationMatrix: new Map(),
    maxCombinedExposure: initialEquity * 0.5,
    slippageAlertThreshold: 150,
    slippageCalibrationWindow: 150,
  }
}
