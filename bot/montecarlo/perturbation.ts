import type { PerturbationRanges, BacktestParams } from "../contracts/types"
import { LHSSampler } from "./lhs-sampler"

export function perturbParams(
  params: BacktestParams,
  ranges: PerturbationRanges
): BacktestParams {
  return {
    slippageMultiplier: sampleInRange(ranges.slippageMultiplier),
    delayMultiplier: sampleInRange(ranges.delayMultiplier),
    fillRate: sampleInRange(ranges.fillRateRange),
    probabilityError: sampleSymmetric(ranges.probabilityError),
    correlationDrift: sampleSymmetric(ranges.correlationDrift),
    volatilityMultiplier: sampleInRange(ranges.volatilityMultiplier),
  }
}

export function generatePerturbationSet(
  ranges: PerturbationRanges,
  count: number,
  method: "random" | "lhs" = "random"
): BacktestParams[] {
  if (method === "lhs") {
    return generateLHSPerturbations(ranges, count)
  }
  return Array.from({ length: count }, () => createRandomPerturbation(ranges))
}

function createRandomPerturbation(ranges: PerturbationRanges): BacktestParams {
  return {
    slippageMultiplier: sampleInRange(ranges.slippageMultiplier),
    delayMultiplier: sampleInRange(ranges.delayMultiplier),
    fillRate: sampleInRange(ranges.fillRateRange),
    probabilityError: sampleSymmetric(ranges.probabilityError),
    correlationDrift: sampleSymmetric(ranges.correlationDrift),
    volatilityMultiplier: sampleInRange(ranges.volatilityMultiplier),
  }
}

function generateLHSPerturbations(
  ranges: PerturbationRanges,
  count: number
): BacktestParams[] {
  const boundedRanges: Array<[number, number]> = [
    ranges.slippageMultiplier,
    ranges.delayMultiplier,
    ranges.fillRateRange,
    [-ranges.probabilityError, ranges.probabilityError],
    [-ranges.correlationDrift, ranges.correlationDrift],
    ranges.volatilityMultiplier,
  ]

  const sampler = new LHSSampler(6, count)
  const samples = sampler.sampleInRange(boundedRanges)

  return samples.map((s) => ({
    slippageMultiplier: s[0],
    delayMultiplier: s[1],
    fillRate: s[2],
    probabilityError: s[3],
    correlationDrift: s[4],
    volatilityMultiplier: s[5],
  }))
}

function sampleInRange(range: [number, number]): number {
  return range[0] + Math.random() * (range[1] - range[0])
}

function sampleSymmetric(magnitude: number): number {
  return (Math.random() - 0.5) * 2 * magnitude
}

export function createDefaultPerturbationRanges(): PerturbationRanges {
  return {
    slippageMultiplier: [0.5, 2.0],
    delayMultiplier: [0.5, 3.0],
    fillRateRange: [0.6, 1.0],
    probabilityError: 0.05,
    correlationDrift: 0.1,
    volatilityMultiplier: [0.5, 2.0],
  }
}

export function applyPerturbationToConfig(
  baseConfig: Record<string, number>,
  params: BacktestParams
): Record<string, number> {
  return {
    ...baseConfig,
    slippageBps: (baseConfig.slippageBps ?? 20) * params.slippageMultiplier,
    delayMs: (baseConfig.delayMs ?? 50) * params.delayMultiplier,
    fillRate: params.fillRate,
    probabilityAdjust: params.probabilityError,
    correlationAdjust: params.correlationDrift,
    volatilityFactor:
      (baseConfig.volatilityFactor ?? 1) * params.volatilityMultiplier,
  }
}

export function validatePerturbationRanges(
  ranges: PerturbationRanges
): boolean {
  const checks = [
    ranges.slippageMultiplier[0] >= 0 &&
      ranges.slippageMultiplier[1] >= ranges.slippageMultiplier[0],
    ranges.delayMultiplier[0] >= 0 &&
      ranges.delayMultiplier[1] >= ranges.delayMultiplier[0],
    ranges.fillRateRange[0] >= 0 &&
      ranges.fillRateRange[1] <= 1 &&
      ranges.fillRateRange[1] >= ranges.fillRateRange[0],
    ranges.probabilityError >= 0,
    ranges.correlationDrift >= 0,
    ranges.volatilityMultiplier[0] >= 0 &&
      ranges.volatilityMultiplier[1] >= ranges.volatilityMultiplier[0],
  ]

  return checks.every(Boolean)
}
