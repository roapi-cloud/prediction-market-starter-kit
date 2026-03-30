import type {
  MonteCarloResult,
  BacktestParams,
  PerturbationRanges,
} from "../contracts/types"
import { perturbParams, generatePerturbationSet } from "./perturbation"

export function monteCarloPnl(
  basePnl: number,
  runs = 200
): { mean: number; p05: number } {
  const results: number[] = []
  for (let i = 0; i < runs; i += 1) {
    const shock = 1 + (Math.random() - 0.5) * 0.4
    results.push(basePnl * shock)
  }
  results.sort((a, b) => a - b)
  const mean = results.reduce((acc, v) => acc + v, 0) / results.length
  const p05 = results[Math.floor(results.length * 0.05)]
  return { mean, p05 }
}

export function monteCarloEnhanced(
  basePnl: number,
  baseDrawdown: number,
  runs: number,
  ranges: PerturbationRanges,
  method: "random" | "lhs" = "random"
): MonteCarloResult {
  const perturbations = generatePerturbationSet(ranges, runs, method)

  const pnlDistribution: number[] = []
  const maxDrawdowns: number[] = []

  for (const params of perturbations) {
    const pnlShock =
      1 + (params.slippageMultiplier - 1) * 0.3 + (params.fillRate - 0.85) * 0.5
    const ddShock = 1 + (params.volatilityMultiplier - 1) * 0.4

    const perturbedPnl = basePnl * pnlShock
    const perturbedDd = baseDrawdown * ddShock

    pnlDistribution.push(perturbedPnl)
    maxDrawdowns.push(perturbedDd)
  }

  pnlDistribution.sort((a, b) => a - b)
  maxDrawdowns.sort((a, b) => a - b)

  const meanPnl =
    pnlDistribution.reduce((a, b) => a + b, 0) / pnlDistribution.length
  const p05Pnl = percentile(pnlDistribution, 5)
  const p95Pnl = percentile(pnlDistribution, 95)

  const meanMaxDd =
    maxDrawdowns.reduce((a, b) => a + b, 0) / maxDrawdowns.length
  const p95MaxDd = percentile(maxDrawdowns, 95)

  const ruinThreshold = -basePnl * 0.5
  const ruinCount = pnlDistribution.filter((p) => p < ruinThreshold).length
  const ruinProbability = ruinCount / pnlDistribution.length

  return {
    pnlDistribution,
    maxDrawdowns,
    meanPnl,
    p05Pnl,
    p95Pnl,
    meanMaxDd,
    p95MaxDd,
    ruinProbability,
  }
}

export function monteCarloWithCustomModel(
  model: (params: BacktestParams) => { pnl: number; maxDrawdown: number },
  ranges: PerturbationRanges,
  runs: number,
  method: "random" | "lhs" = "random"
): MonteCarloResult {
  const perturbations = generatePerturbationSet(ranges, runs, method)

  const pnlDistribution: number[] = []
  const maxDrawdowns: number[] = []

  for (const params of perturbations) {
    const result = model(params)
    pnlDistribution.push(result.pnl)
    maxDrawdowns.push(result.maxDrawdown)
  }

  pnlDistribution.sort((a, b) => a - b)
  maxDrawdowns.sort((a, b) => a - b)

  const meanPnl =
    pnlDistribution.reduce((a, b) => a + b, 0) / pnlDistribution.length
  const p05Pnl = percentile(pnlDistribution, 5)
  const p95Pnl = percentile(pnlDistribution, 95)

  const meanMaxDd =
    maxDrawdowns.reduce((a, b) => a + b, 0) / maxDrawdowns.length
  const p95MaxDd = percentile(maxDrawdowns, 95)

  const ruinThreshold = meanPnl * -2
  const ruinCount = pnlDistribution.filter((p) => p < ruinThreshold).length
  const ruinProbability = ruinCount / pnlDistribution.length

  return {
    pnlDistribution,
    maxDrawdowns,
    meanPnl,
    p05Pnl,
    p95Pnl,
    meanMaxDd,
    p95MaxDd,
    ruinProbability,
  }
}

export function percentile(sortedArray: number[], p: number): number {
  if (sortedArray.length === 0) return 0
  const index = Math.floor((sortedArray.length - 1) * (p / 100))
  return sortedArray[index]
}

export function computeConfidenceInterval(
  distribution: number[],
  confidence: number = 0.95
): { lower: number; upper: number; mean: number } {
  if (distribution.length === 0) {
    return { lower: 0, upper: 0, mean: 0 }
  }

  const sorted = [...distribution].sort((a, b) => a - b)
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length

  const alpha = 1 - confidence
  const lowerP = (alpha / 2) * 100
  const upperP = (1 - alpha / 2) * 100

  const lower = percentile(sorted, lowerP)
  const upper = percentile(sorted, upperP)

  return { lower, upper, mean }
}

export function bootstrapMonteCarlo(
  baseResults: number[],
  bootstrapSamples: number = 1000
): {
  meanEstimate: number
  confidenceInterval: { lower: number; upper: number }
} {
  if (baseResults.length === 0) {
    return { meanEstimate: 0, confidenceInterval: { lower: 0, upper: 0 } }
  }

  const bootstrapMeans: number[] = []

  for (let i = 0; i < bootstrapSamples; i++) {
    const sample: number[] = []
    for (let j = 0; j < baseResults.length; j++) {
      const randomIndex = Math.floor(Math.random() * baseResults.length)
      sample.push(baseResults[randomIndex])
    }
    bootstrapMeans.push(sample.reduce((a, b) => a + b, 0) / sample.length)
  }

  const sortedMeans = bootstrapMeans.sort((a, b) => a - b)
  const meanEstimate =
    sortedMeans.reduce((a, b) => a + b, 0) / sortedMeans.length

  const lower = percentile(sortedMeans, 2.5)
  const upper = percentile(sortedMeans, 97.5)

  return { meanEstimate, confidenceInterval: { lower, upper } }
}

export function simulateTradeSequence(
  trades: Array<{ evBps: number; confidence: number }>,
  runs: number,
  slippageRange: [number, number] = [0.5, 2.0],
  fillRateRange: [number, number] = [0.6, 1.0]
): { pnlDistribution: number[]; avgWinRate: number; avgReturn: number } {
  const pnlDistribution: number[] = []
  let totalWins = 0

  for (let i = 0; i < runs; i++) {
    let cumulativePnl = 0
    let wins = 0

    for (const trade of trades) {
      const slippageMult =
        slippageRange[0] + Math.random() * (slippageRange[1] - slippageRange[0])
      const fillRate =
        fillRateRange[0] + Math.random() * (fillRateRange[1] - fillRateRange[0])

      const actualEv = trade.evBps * (fillRate - (slippageMult - 1) * 0.1)
      const pnl = (actualEv / 10000) * 100
      cumulativePnl += pnl

      if (pnl > 0) wins += 1
    }

    pnlDistribution.push(cumulativePnl)
    totalWins += wins
  }

  const avgWinRate = trades.length > 0 ? totalWins / (runs * trades.length) : 0
  const avgReturn =
    pnlDistribution.reduce((a, b) => a + b, 0) / pnlDistribution.length

  return { pnlDistribution, avgWinRate, avgReturn }
}
