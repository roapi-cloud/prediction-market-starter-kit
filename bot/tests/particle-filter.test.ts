import test from "node:test"
import assert from "node:assert/strict"
import { ParticleFilter, createParticleFilter } from "../signal/particle-filter"
import {
  computeBayesianEnhanced,
  clearFilterRegistry,
} from "../signal/bayesian-enhanced"
import {
  sampleInitialParams,
  clampParams,
  computeObservationLikelihood,
  sampleNextRegime,
  getRegimeDirection,
} from "../signal/regime-model"
import type {
  BayesianConfig,
  FeatureSnapshot,
  MarketRegime,
} from "../contracts/types"

test("ParticleFilter initializes with correct particle count", () => {
  const config: Partial<BayesianConfig> = { particleCount: 50 }
  const filter = createParticleFilter(config)
  const particles = filter.getParticles()
  assert.equal(particles.length, 50)
})

test("Particle weights are normalized after initialization", () => {
  const filter = createParticleFilter({ particleCount: 100 })
  const particles = filter.getParticles()
  const totalWeight = particles.reduce((sum, p) => sum + p.weight, 0)
  assert.ok(Math.abs(totalWeight - 1.0) < 0.001)
})

test("Particle params are within constraints", () => {
  const filter = createParticleFilter()
  const particles = filter.getParticles()
  for (const p of particles) {
    assert.ok(
      p.params.imbalanceWeight >= 0.1 && p.params.imbalanceWeight <= 0.5
    )
    assert.ok(p.params.zScoreWeight >= -0.2 && p.params.zScoreWeight <= 0)
    assert.ok(
      p.params.volatilityWeight >= 0 && p.params.volatilityWeight <= 0.3
    )
  }
})

test("ParticleFilter predict step propagates states", () => {
  const filter = createParticleFilter()
  filter.predict()
  const particles = filter.getParticles()
  assert.equal(particles.length, 100)
})

test("ParticleFilter update step updates weights", () => {
  const filter = createParticleFilter()
  const feature: FeatureSnapshot = {
    marketId: "test",
    ts: Date.now(),
    imbalanceL1: 0.3,
    imbalanceL5: 0.2,
    microPrice: 0.5,
    spreadZScore: -0.5,
    volatility1s: 0.01,
  }
  filter.predict()
  filter.update(feature)
  const estimate = filter.getEstimate()
  assert.ok(estimate.pUp >= 0.01 && estimate.pUp <= 0.99)
  assert.ok(estimate.effectiveParticleCount > 0)
})

test("ParticleFilter resample maintains particle count", () => {
  const filter = createParticleFilter({ particleCount: 50 })
  const feature: FeatureSnapshot = {
    marketId: "test",
    ts: Date.now(),
    imbalanceL1: 0.5,
    imbalanceL5: 0.5,
    microPrice: 0.5,
    spreadZScore: 1.0,
    volatility1s: 0.05,
  }
  filter.predict()
  filter.update(feature)
  filter.resample()
  const particles = filter.getParticles()
  assert.equal(particles.length, 50)
  const totalWeight = particles.reduce((sum, p) => sum + p.weight, 0)
  assert.ok(Math.abs(totalWeight - 1.0) < 0.001)
})

test("ParticleFilter reset clears state", () => {
  const filter = createParticleFilter()
  const feature: FeatureSnapshot = {
    marketId: "test",
    ts: Date.now(),
    imbalanceL1: 0.3,
    imbalanceL5: 0.2,
    microPrice: 0.5,
  }
  filter.predict()
  filter.update(feature)
  filter.reset()
  const particles = filter.getParticles()
  const uniformWeight = 1.0 / particles.length
  for (const p of particles) {
    assert.ok(Math.abs(p.weight - uniformWeight) < 0.001)
  }
})

test("computeBayesianEnhanced returns valid output", () => {
  clearFilterRegistry()
  const feature: FeatureSnapshot = {
    marketId: "test",
    ts: Date.now(),
    imbalanceL1: 0.2,
    imbalanceL5: 0.15,
    microPrice: 0.5,
    spreadZScore: -0.3,
    volatility1s: 0.008,
  }
  const result = computeBayesianEnhanced(feature)
  assert.ok(result.pUp >= 0.01 && result.pUp <= 0.99)
  assert.ok(["up", "down", "range", "volatile"].includes(result.regime))
  assert.ok(result.regimeConfidence >= 0 && result.regimeConfidence <= 1)
  assert.ok(["up", "down", "neutral"].includes(result.predictedPriceMove))
})

test("sampleInitialParams returns valid params", () => {
  const params = sampleInitialParams()
  assert.ok(typeof params.imbalanceWeight === "number")
  assert.ok(typeof params.zScoreWeight === "number")
  assert.ok(typeof params.volatilityWeight === "number")
})

test("clampParams respects constraints", () => {
  const params = {
    imbalanceWeight: 0.6,
    zScoreWeight: -0.3,
    volatilityWeight: 0.4,
  }
  const constraints = [
    { min: 0.1, max: 0.5 },
    { min: -0.2, max: 0.0 },
    { min: 0.0, max: 0.3 },
  ]
  const clamped = clampParams(params, constraints)
  assert.equal(clamped.imbalanceWeight, 0.5)
  assert.equal(clamped.zScoreWeight, -0.2)
  assert.equal(clamped.volatilityWeight, 0.3)
})

test("computeObservationLikelihood returns finite value", () => {
  const observation = { imbalance: 0.3, zScore: -0.5, volatility: 0.01 }
  const model = {
    imbalanceMean: { up: 0.3, down: -0.3, range: 0.0, volatile: 0.0 } as Record<
      MarketRegime,
      number
    >,
    imbalanceStd: { up: 0.2, down: 0.2, range: 0.15, volatile: 0.4 } as Record<
      MarketRegime,
      number
    >,
    zScoreMean: { up: -0.5, down: 0.5, range: 0.0, volatile: 0.0 } as Record<
      MarketRegime,
      number
    >,
    zScoreStd: { up: 0.5, down: 0.5, range: 0.3, volatile: 1.0 } as Record<
      MarketRegime,
      number
    >,
    volatilityMean: {
      up: 0.01,
      down: 0.01,
      range: 0.005,
      volatile: 0.03,
    } as Record<MarketRegime, number>,
    volatilityStd: {
      up: 0.005,
      down: 0.005,
      range: 0.002,
      volatile: 0.02,
    } as Record<MarketRegime, number>,
  }
  const ll = computeObservationLikelihood(observation, "up", model)
  assert.ok(typeof ll === "number")
  assert.ok(!Number.isNaN(ll))
})

test("sampleNextRegime returns valid regime", () => {
  const transitionMatrix: Record<MarketRegime, Record<MarketRegime, number>> = {
    up: { up: 0.7, down: 0.1, range: 0.15, volatile: 0.05 },
    down: { up: 0.1, down: 0.7, range: 0.15, volatile: 0.05 },
    range: { up: 0.15, down: 0.15, range: 0.6, volatile: 0.1 },
    volatile: { up: 0.2, down: 0.2, range: 0.2, volatile: 0.4 },
  }
  for (let i = 0; i < 10; i++) {
    const regime = sampleNextRegime("up", transitionMatrix)
    assert.ok(["up", "down", "range", "volatile"].includes(regime))
  }
})

test("getRegimeDirection returns correct values", () => {
  assert.equal(getRegimeDirection("up"), 1)
  assert.equal(getRegimeDirection("down"), -1)
  assert.equal(getRegimeDirection("range"), 0)
  assert.equal(getRegimeDirection("volatile"), 0)
})

test("ParticleFilter handles extreme observations", () => {
  const filter = createParticleFilter()
  const feature: FeatureSnapshot = {
    marketId: "test",
    ts: Date.now(),
    imbalanceL1: 0.9,
    imbalanceL5: 0.9,
    microPrice: 0.5,
    spreadZScore: 3.0,
    volatility1s: 0.1,
  }
  filter.predict()
  filter.update(feature)
  const estimate = filter.getEstimate()
  assert.ok(estimate.pUp >= 0.01 && estimate.pUp <= 0.99)
  assert.ok(!Number.isNaN(estimate.effectiveParticleCount))
})

test("ParticleFilter performance is under 5ms for 100 particles", () => {
  const filter = createParticleFilter({ particleCount: 100 })
  const feature: FeatureSnapshot = {
    marketId: "perf-test",
    ts: Date.now(),
    imbalanceL1: 0.2,
    imbalanceL5: 0.15,
    microPrice: 0.5,
    spreadZScore: -0.3,
    volatility1s: 0.01,
  }
  const start = performance.now()
  for (let i = 0; i < 100; i++) {
    filter.predict()
    filter.update({
      ...feature,
      ts: Date.now() + i,
      imbalanceL1: 0.2 + Math.random() * 0.1,
    })
  }
  const elapsed = performance.now() - start
  const avgMs = elapsed / 100
  assert.ok(avgMs < 5, `Average time per update: ${avgMs}ms, expected < 5ms`)
})

test("Multiple updates converge regime estimate", () => {
  const filter = createParticleFilter()
  for (let i = 0; i < 20; i++) {
    const feature: FeatureSnapshot = {
      marketId: "test",
      ts: Date.now() + i * 100,
      imbalanceL1: 0.4,
      imbalanceL5: 0.35,
      microPrice: 0.5,
      spreadZScore: -0.8,
      volatility1s: 0.005,
    }
    filter.predict()
    filter.update(feature)
  }
  const estimate = filter.getEstimate()
  assert.ok(
    estimate.regimeConfidence > 0.2,
    "Regime confidence should increase with consistent observations"
  )
})
