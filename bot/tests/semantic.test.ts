import test from "node:test"
import assert from "node:assert/strict"
import {
  analyzeSentiment,
  computeRelevance,
  aggregateSignal,
} from "../signal/semantic-analyzer"
import {
  injectSemanticPrior,
  shouldUseSemanticSignal,
  computeSemanticContribution,
} from "../signal/semantic-prior"
import type {
  SemanticEvent,
  SemanticSignal,
  BayesianOutputEnhanced,
  BayesianOutputWithSemantic,
} from "../contracts/types"

test("analyzeSentiment returns neutral for empty text", () => {
  const result = analyzeSentiment("")
  assert.equal(result.sentiment, "neutral")
  assert.equal(result.score, 0)
})

test("analyzeSentiment detects positive sentiment", () => {
  const result = analyzeSentiment(
    "This is a success and a victory for the team"
  )
  assert.equal(result.sentiment, "positive")
  assert.ok(result.score > 0)
})

test("analyzeSentiment detects negative sentiment", () => {
  const result = analyzeSentiment("This is a failure and a loss for the team")
  assert.equal(result.sentiment, "negative")
  assert.ok(result.score < 0)
})

test("analyzeSentiment handles mixed sentiment", () => {
  const result = analyzeSentiment("Despite the failure, there was a victory")
  assert.ok(Math.abs(result.score) < 0.5)
})

test("computeRelevance returns 0.5 for no keywords", () => {
  const result = computeRelevance("some text", [])
  assert.equal(result, 0.5)
})

test("computeRelevance increases with matching keywords", () => {
  const result1 = computeRelevance("The election results are expected", [
    "election",
  ])
  const result2 = computeRelevance("Random unrelated text", ["election"])
  assert.ok(result1 > result2)
})

test("aggregateSignal handles empty events", () => {
  const result = aggregateSignal([])
  assert.equal(result.aggregatedSentiment, 0)
  assert.equal(result.signalStrength, 0)
  assert.equal(result.direction, "neutral")
  assert.equal(result.sourcesUsed.length, 0)
})

test("aggregateSignal computes weighted sentiment", () => {
  const events: SemanticEvent[] = [
    {
      eventId: "test-1",
      ts: Date.now(),
      source: "news",
      text: "Positive news",
      sentiment: "positive",
      sentimentScore: 0.5,
      relevance: 0.8,
      credibility: 0.9,
    },
    {
      eventId: "test-1",
      ts: Date.now() - 1000,
      source: "social",
      text: "Negative tweet",
      sentiment: "negative",
      sentimentScore: -0.3,
      relevance: 0.6,
      credibility: 0.5,
    },
  ]

  const result = aggregateSignal(events)
  assert.ok(result.aggregatedSentiment > 0)
  assert.ok(result.sourcesUsed.length === 2)
  assert.ok(result.confidence >= 0 && result.confidence <= 1)
})

test("aggregateSignal determines direction correctly", () => {
  const positiveEvents: SemanticEvent[] = [
    {
      eventId: "test-2",
      ts: Date.now(),
      source: "news",
      text: "Very positive",
      sentiment: "positive",
      sentimentScore: 0.8,
      relevance: 0.9,
      credibility: 0.9,
    },
  ]

  const result = aggregateSignal(positiveEvents)
  assert.equal(result.direction, "supports_yes")
})

test("injectSemanticPrior returns unchanged when signal is null", () => {
  const bayesian: BayesianOutputEnhanced = {
    pUp: 0.6,
    pDown: 0.4,
    regime: "up",
    regimeConfidence: 0.7,
    confidence: 0.5,
    nextRegimeProb: { up: 0.3, down: 0.2, range: 0.4, volatile: 0.1 },
    predictedPriceMove: "up",
    effectiveParticleCount: 100,
  }

  const result = injectSemanticPrior(bayesian, null)
  assert.equal(result.pUp, bayesian.pUp)
  assert.equal(result.semanticAdjustment, 0)
  assert.equal(result.semanticSignal, undefined)
})

test("injectSemanticPrior adjusts prior with valid signal", () => {
  const bayesian: BayesianOutputEnhanced = {
    pUp: 0.5,
    pDown: 0.5,
    regime: "range",
    regimeConfidence: 0.5,
    confidence: 0.3,
    nextRegimeProb: { up: 0.25, down: 0.25, range: 0.25, volatile: 0.25 },
    predictedPriceMove: "neutral",
    effectiveParticleCount: 50,
  }

  const signal: SemanticSignal = {
    eventId: "test-3",
    ts: Date.now(),
    aggregatedSentiment: 0.6,
    signalStrength: 0.5,
    priorAdjustment: 0.1,
    direction: "supports_yes",
    confidence: 0.8,
    sourcesUsed: ["news", "social"],
  }

  const result = injectSemanticPrior(bayesian, signal)
  assert.ok(result.pUp > bayesian.pUp)
  assert.ok(result.semanticAdjustment !== 0)
  assert.ok(result.confidence >= bayesian.confidence)
})

test("shouldUseSemanticSignal returns false for weak signal", () => {
  const weakSignal: SemanticSignal = {
    eventId: "test-4",
    ts: Date.now(),
    aggregatedSentiment: 0.1,
    signalStrength: 0.05,
    priorAdjustment: 0.01,
    direction: "neutral",
    confidence: 0.2,
    sourcesUsed: [],
  }

  assert.equal(shouldUseSemanticSignal(weakSignal), false)
})

test("shouldUseSemanticSignal returns true for strong signal", () => {
  const strongSignal: SemanticSignal = {
    eventId: "test-5",
    ts: Date.now(),
    aggregatedSentiment: 0.5,
    signalStrength: 0.4,
    priorAdjustment: 0.08,
    direction: "supports_yes",
    confidence: 0.7,
    sourcesUsed: ["news", "social"],
  }

  assert.equal(shouldUseSemanticSignal(strongSignal), true)
})

test("computeSemanticContribution calculates correct metrics", () => {
  const original: BayesianOutputEnhanced = {
    pUp: 0.5,
    pDown: 0.5,
    regime: "range",
    regimeConfidence: 0.5,
    confidence: 0.3,
    nextRegimeProb: { up: 0.25, down: 0.25, range: 0.25, volatile: 0.25 },
    predictedPriceMove: "neutral",
    effectiveParticleCount: 50,
  }

  const semanticSignal: SemanticSignal = {
    eventId: "test-6",
    ts: Date.now(),
    aggregatedSentiment: 0.5,
    signalStrength: 0.4,
    priorAdjustment: 0.05,
    direction: "supports_yes",
    confidence: 0.7,
    sourcesUsed: ["news"],
  }

  const adjusted: BayesianOutputWithSemantic = {
    ...original,
    pUp: 0.55,
    pDown: 0.45,
    confidence: 0.4,
    semanticAdjustment: 0.05,
    semanticSignal,
  }

  const contribution = computeSemanticContribution(original, adjusted)
  assert.ok(contribution.priorChange > 0)
  assert.ok(contribution.confidenceChange > 0)
  assert.equal(contribution.directionImpact, "supports_yes")
  assert.ok(contribution.contributionScore > 0)
})

test("SemanticCache stores and retrieves events", async () => {
  const { SemanticCache, resetSemanticCache } =
    await import("../data/semantic-cache")
  resetSemanticCache()

  const cache = new SemanticCache()
  const events: SemanticEvent[] = [
    {
      eventId: "cache-test",
      ts: Date.now(),
      source: "news",
      text: "Test article",
      sentiment: "neutral",
      sentimentScore: 0,
      relevance: 0.7,
      credibility: 0.8,
    },
  ]

  cache.setEvents("cache-test", events, 10000)
  const retrieved = cache.getEvents("cache-test")

  assert.ok(retrieved !== null)
  assert.equal(retrieved?.length, 1)
})

test("SemanticCache returns null after TTL expiry", async () => {
  const { SemanticCache } = await import("../data/semantic-cache")

  const cache = new SemanticCache(100)
  cache.setEvents("expire-test", [], 50)

  await new Promise((resolve) => setTimeout(resolve, 150))

  const retrieved = cache.getEvents("expire-test")
  assert.equal(retrieved, null)
})

test("SemanticConfig loads defaults", async () => {
  const {
    DEFAULT_SEMANTIC_CONFIG,
    loadSemanticConfig,
    resetSemanticConfigCache,
  } = await import("../config/semantic-config")
  resetSemanticConfigCache()

  const config = loadSemanticConfig()
  assert.ok(config.sources.length > 0)
  assert.equal(config.enabled, DEFAULT_SEMANTIC_CONFIG.enabled)
  assert.ok(config.signalTTLMs > 0)
})

test("SemanticEngine initializes with config", async () => {
  const { SemanticEngine, resetSemanticEngine } =
    await import("../signal/semantic-engine")
  resetSemanticEngine()

  const engine = new SemanticEngine({
    sources: [{ type: "news", endpoint: "", enabled: false }],
    updateIntervalMs: 60000,
    signalTTLMs: 300000,
    credibilityWeights: { news: 0.8 },
    enabled: false,
  })

  assert.equal(engine.isEnabled(), false)
  assert.ok(engine.getConfig() !== null)
})
