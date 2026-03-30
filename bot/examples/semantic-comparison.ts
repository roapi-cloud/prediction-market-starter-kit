import { computeBayesianEnhanced } from "../signal/bayesian-enhanced"
import {
  injectSemanticPrior,
  computeSemanticContribution,
} from "../signal/semantic-prior"
import type {
  FeatureSnapshot,
  SemanticSignal,
  BayesianOutputEnhanced,
} from "../contracts/types"

function createMockFeature(): FeatureSnapshot {
  return {
    marketId: "test-market-123",
    ts: Date.now(),
    imbalanceL1: 0.1,
    imbalanceL5: 0.05,
    microPrice: 0.52,
    spreadZScore: -0.5,
    volatility1s: 0.02,
  }
}

function createMockSignal(sentiment: number): SemanticSignal {
  return {
    eventId: "test-event-123",
    ts: Date.now(),
    aggregatedSentiment: sentiment,
    signalStrength: Math.abs(sentiment) * 0.5,
    priorAdjustment: sentiment * 0.1,
    direction:
      sentiment > 0.3
        ? "supports_yes"
        : sentiment < -0.3
          ? "supports_no"
          : "neutral",
    confidence: 0.7,
    sourcesUsed: ["news", "social"],
  }
}

function runComparison() {
  console.log("=== Semantic Signal Contribution Comparison ===")
  console.log("")

  const feature = createMockFeature()
  const bayesian = computeBayesianEnhanced(feature)

  console.log("Original Bayesian Output:")
  console.log(`  pUp: ${bayesian.pUp.toFixed(4)}`)
  console.log(`  pDown: ${bayesian.pDown.toFixed(4)}`)
  console.log(`  confidence: ${bayesian.confidence.toFixed(4)}`)
  console.log(`  regime: ${bayesian.regime}`)
  console.log("")

  const sentiments = [0.6, 0.3, 0.0, -0.3, -0.6]

  for (const sentiment of sentiments) {
    const signal = createMockSignal(sentiment)
    const adjusted = injectSemanticPrior(bayesian, signal)
    const contribution = computeSemanticContribution(bayesian, adjusted)

    console.log(
      `--- Sentiment: ${sentiment.toFixed(1)} (${signal.direction}) ---`
    )
    console.log(`  Adjusted pUp: ${adjusted.pUp.toFixed(4)}`)
    console.log(`  Prior change: ${contribution.priorChange.toFixed(4)}`)
    console.log(
      `  Confidence change: ${contribution.confidenceChange.toFixed(4)}`
    )
    console.log(
      `  Contribution score: ${contribution.contributionScore.toFixed(4)}`
    )
    console.log("")
  }

  console.log("=== Summary ===")
  console.log("Semantic signals provide:")
  console.log("  - Prior adjustments based on news/social sentiment")
  console.log("  - Confidence boosting when multiple sources agree")
  console.log("  - Direction indicators (supports_yes/supports_no)")
  console.log("")
  console.log("To enable semantic signals:")
  console.log("  Set SEMANTIC_ENABLED=true in environment")
  console.log("  Or configure sources in semantic-config.ts")
}

runComparison()
