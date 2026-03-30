import { computeBayesian } from "../signal/bayesian"
import {
  computeBayesianEnhanced,
  clearFilterRegistry,
  createParticleFilter,
} from "../signal/bayesian-enhanced"
import type { FeatureSnapshot } from "../contracts/types"
import { ParticleFilter } from "../signal/particle-filter"

type ComparisonResult = {
  simple: { pUp: number; confidence: number }
  enhanced: {
    pUp: number
    confidence: number
    regime: string
    regimeConfidence: number
    predictedPriceMove: string
    effectiveParticleCount: number
  }
  timestamp: number
}

type AccuracyMetrics = {
  simpleAccuracy: number
  enhancedAccuracy: number
  simpleMse: number
  enhancedMse: number
  regimeAccuracy: number
  totalSamples: number
}

function simulatePriceMove(feature: FeatureSnapshot): number {
  const base = 0.5
  const noise = (Math.random() - 0.5) * 0.2
  const trend = feature.imbalanceL1 * 0.15
  return base + trend + noise
}

function generateSyntheticFeatures(count: number): FeatureSnapshot[] {
  const features: FeatureSnapshot[] = []
  const baseTs = Date.now()

  for (let i = 0; i < count; i++) {
    const regimeRandom = Math.random()
    let imbalance: number
    let zScore: number
    let volatility: number

    if (regimeRandom < 0.3) {
      imbalance = 0.3 + Math.random() * 0.3
      zScore = -0.5 + Math.random() * -0.5
      volatility = 0.005 + Math.random() * 0.005
    } else if (regimeRandom < 0.6) {
      imbalance = -0.3 - Math.random() * 0.3
      zScore = 0.5 + Math.random() * 0.5
      volatility = 0.005 + Math.random() * 0.005
    } else if (regimeRandom < 0.85) {
      imbalance = (Math.random() - 0.5) * 0.1
      zScore = (Math.random() - 0.5) * 0.2
      volatility = 0.002 + Math.random() * 0.003
    } else {
      imbalance = (Math.random() - 0.5) * 0.5
      zScore = (Math.random() - 0.5) * 2
      volatility = 0.02 + Math.random() * 0.03
    }

    features.push({
      marketId: "synthetic-test",
      ts: baseTs + i * 100,
      imbalanceL1: imbalance,
      imbalanceL5: imbalance * 0.9,
      microPrice: 0.5 + imbalance * 0.1,
      spreadZScore: zScore,
      volatility1s: volatility,
    })
  }

  return features
}

function compareVersions(features: FeatureSnapshot[]): ComparisonResult[] {
  clearFilterRegistry()
  const results: ComparisonResult[] = []

  for (const feature of features) {
    const simpleResult = computeBayesian(feature)
    const enhancedResult = computeBayesianEnhanced(feature)

    results.push({
      simple: {
        pUp: simpleResult.pUp,
        confidence: simpleResult.confidence,
      },
      enhanced: {
        pUp: enhancedResult.pUp,
        confidence: enhancedResult.confidence,
        regime: enhancedResult.regime,
        regimeConfidence: enhancedResult.regimeConfidence,
        predictedPriceMove: enhancedResult.predictedPriceMove,
        effectiveParticleCount: enhancedResult.effectiveParticleCount,
      },
      timestamp: feature.ts,
    })
  }

  return results
}

function computeAccuracyMetrics(
  results: ComparisonResult[],
  features: FeatureSnapshot[]
): AccuracyMetrics {
  let simpleCorrect = 0
  let enhancedCorrect = 0
  let simpleMseSum = 0
  let enhancedMseSum = 0
  let regimeCorrect = 0

  for (let i = 0; i < results.length; i++) {
    const actualPUp = simulatePriceMove(features[i])
    const actualUp = actualPUp > 0.5

    const simplePred = results[i].simple.pUp > 0.5
    const enhancedPred = results[i].enhanced.pUp > 0.5

    if (simplePred === actualUp) simpleCorrect++
    if (enhancedPred === actualUp) enhancedCorrect++

    simpleMseSum += (results[i].simple.pUp - actualPUp) ** 2
    enhancedMseSum += (results[i].enhanced.pUp - actualPUp) ** 2

    const feature = features[i]
    const vol = feature.volatility1s ?? 0
    if (feature.imbalanceL1 > 0.2 && results[i].enhanced.regime === "up") {
      regimeCorrect++
    } else if (
      feature.imbalanceL1 < -0.2 &&
      results[i].enhanced.regime === "down"
    ) {
      regimeCorrect++
    } else if (
      Math.abs(feature.imbalanceL1) < 0.1 &&
      vol < 0.01 &&
      results[i].enhanced.regime === "range"
    ) {
      regimeCorrect++
    } else if (vol > 0.02 && results[i].enhanced.regime === "volatile") {
      regimeCorrect++
    }
  }

  return {
    simpleAccuracy: simpleCorrect / results.length,
    enhancedAccuracy: enhancedCorrect / results.length,
    simpleMse: simpleMseSum / results.length,
    enhancedMse: enhancedMseSum / results.length,
    regimeAccuracy: regimeCorrect / results.length,
    totalSamples: results.length,
  }
}

export function runComparison(sampleCount: number = 100): {
  results: ComparisonResult[]
  metrics: AccuracyMetrics
  summary: string
} {
  const features = generateSyntheticFeatures(sampleCount)
  const results = compareVersions(features)
  const metrics = computeAccuracyMetrics(results, features)

  const summary = `
Comparison Results (${sampleCount} samples):
====================

Simple Version:
  - Accuracy: ${metrics.simpleAccuracy.toFixed(4)} (${(metrics.simpleAccuracy * 100).toFixed(1)}%)
  - MSE: ${metrics.simpleMse.toFixed(6)}

Enhanced Version (Particle Filter):
  - Accuracy: ${metrics.enhancedAccuracy.toFixed(4)} (${(metrics.enhancedAccuracy * 100).toFixed(1)}%)
  - MSE: ${metrics.enhancedMse.toFixed(6)}
  - Regime Classification Accuracy: ${metrics.regimeAccuracy.toFixed(4)} (${(metrics.regimeAccuracy * 100).toFixed(1)}%)

Improvement:
  - Accuracy delta: ${((metrics.enhancedAccuracy - metrics.simpleAccuracy) * 100).toFixed(2)}%
  - MSE reduction: ${(((metrics.simpleMse - metrics.enhancedMse) / metrics.simpleMse) * 100).toFixed(2)}%

Note: These are synthetic results. For real validation, use historical market data.
`.trim()

  return { results, metrics, summary }
}

export function printComparison(sampleCount: number = 100): void {
  const { summary } = runComparison(sampleCount)
  console.log(summary)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const count = parseInt(process.argv[2] || "100", 10)
  printComparison(count)
}
