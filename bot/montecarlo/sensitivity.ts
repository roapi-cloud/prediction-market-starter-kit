import type {
  BacktestParams,
  PerturbationRanges,
  BacktestResultEnhanced,
} from "../contracts/types"
import { generatePerturbationSet } from "./perturbation"

export type SensitivityResult = {
  parameter: string
  sensitivity: number
  contribution: number
  direction: "positive" | "negative" | "neutral"
}

export class SensitivityAnalyzer {
  private baseParams: BacktestParams
  private ranges: PerturbationRanges
  private results: Map<string, SensitivityResult> = new Map()

  constructor(baseParams: BacktestParams, ranges: PerturbationRanges) {
    this.baseParams = baseParams
    this.ranges = ranges
  }

  analyzeOneParameter(
    parameter: keyof BacktestParams,
    stepCount: number,
    evaluateFn: (params: BacktestParams) => number
  ): SensitivityResult {
    const baseResult = evaluateFn(this.baseParams)
    const values: number[] = []
    const results: number[] = []

    const range = this.getParameterRange(parameter)
    const stepSize = (range[1] - range[0]) / stepCount

    for (let i = 0; i <= stepCount; i++) {
      const value = range[0] + i * stepSize
      const perturbedParams = { ...this.baseParams, [parameter]: value }
      const result = evaluateFn(perturbedParams)

      values.push(value)
      results.push(result)
    }

    const sensitivities: number[] = []
    for (let i = 1; i < results.length; i++) {
      const deltaResult = results[i] - results[i - 1]
      const deltaValue = values[i] - values[i - 1]
      sensitivities.push(deltaResult / Math.max(0.0001, deltaValue))
    }

    const avgSensitivity =
      sensitivities.reduce((a, b) => a + b, 0) / sensitivities.length
    const maxResult = Math.max(...results)
    const minResult = Math.min(...results)
    const contribution = maxResult - minResult

    const direction =
      avgSensitivity > 0.001
        ? "positive"
        : avgSensitivity < -0.001
          ? "negative"
          : "neutral"

    const result: SensitivityResult = {
      parameter,
      sensitivity: avgSensitivity,
      contribution,
      direction,
    }

    this.results.set(parameter, result)
    return result
  }

  analyzeAllParameters(
    stepCount: number,
    evaluateFn: (params: BacktestParams) => number
  ): Record<string, SensitivityResult> {
    const parameters: (keyof BacktestParams)[] = [
      "slippageMultiplier",
      "delayMultiplier",
      "fillRate",
      "probabilityError",
      "correlationDrift",
      "volatilityMultiplier",
    ]

    for (const param of parameters) {
      this.analyzeOneParameter(param, stepCount, evaluateFn)
    }

    return Object.fromEntries(this.results)
  }

  private getParameterRange(parameter: keyof BacktestParams): [number, number] {
    switch (parameter) {
      case "slippageMultiplier":
        return this.ranges.slippageMultiplier
      case "delayMultiplier":
        return this.ranges.delayMultiplier
      case "fillRate":
        return this.ranges.fillRateRange
      case "probabilityError":
        return [-this.ranges.probabilityError, this.ranges.probabilityError]
      case "correlationDrift":
        return [-this.ranges.correlationDrift, this.ranges.correlationDrift]
      case "volatilityMultiplier":
        return this.ranges.volatilityMultiplier
      default:
        return [0, 1]
    }
  }

  getMostSensitiveParameters(threshold: number): SensitivityResult[] {
    return Array.from(this.results.values())
      .filter((r) => Math.abs(r.sensitivity) > threshold)
      .sort((a, b) => Math.abs(b.sensitivity) - Math.abs(a.sensitivity))
  }

  getTotalContribution(): number {
    return Array.from(this.results.values()).reduce(
      (a, r) => a + Math.abs(r.contribution),
      0
    )
  }

  getRelativeContributions(): Record<string, number> {
    const total = this.getTotalContribution()
    if (total === 0) return {}

    const contributions: Record<string, number> = {}
    for (const [param, result] of Array.from(this.results)) {
      contributions[param] = Math.abs(result.contribution) / total
    }

    return contributions
  }
}

export function computeSensitivityFromMonteCarlo(
  baseResult: BacktestResultEnhanced,
  perturbedResults: BacktestResultEnhanced[],
  perturbations: BacktestParams[]
): Record<string, number> {
  const sensitivities: Record<string, number> = {}

  const parameters: (keyof BacktestParams)[] = [
    "slippageMultiplier",
    "delayMultiplier",
    "fillRate",
    "probabilityError",
    "correlationDrift",
    "volatilityMultiplier",
  ]

  for (const param of parameters) {
    const correlations: number[] = []
    const values = perturbations.map((p) => p[param])
    const pnlValues = perturbedResults.map((r) => r.totalPnl)

    const meanValue = values.reduce((a, b) => a + b, 0) / values.length
    const meanPnl = pnlValues.reduce((a, b) => a + b, 0) / pnlValues.length

    for (let i = 0; i < values.length; i++) {
      const valueDiff = values[i] - meanValue
      const pnlDiff = pnlValues[i] - meanPnl
      correlations.push(valueDiff * pnlDiff)
    }

    const varValue =
      values.reduce((a, v) => a + (v - meanValue) ** 2, 0) / values.length
    const varPnl =
      pnlValues.reduce((a, p) => a + (p - meanPnl) ** 2, 0) / values.length

    if (varValue > 0 && varPnl > 0) {
      const covariance = correlations.reduce((a, b) => a + b, 0) / values.length
      sensitivities[param] =
        covariance / (Math.sqrt(varValue) * Math.sqrt(varPnl))
    } else {
      sensitivities[param] = 0
    }
  }

  return sensitivities
}

export function createDefaultBaseParams(): BacktestParams {
  return {
    slippageMultiplier: 1.0,
    delayMultiplier: 1.0,
    fillRate: 0.85,
    probabilityError: 0,
    correlationDrift: 0,
    volatilityMultiplier: 1.0,
  }
}
