import type {
  BayesianConfig,
  BayesianOutputEnhanced,
  FeatureSnapshot,
  MarketRegime,
  ParticleState,
} from "../contracts/types"
import {
  computeObservationLikelihood,
  sampleInitialParams,
  sampleNextRegime,
  adaptParams,
  getRegimeDirection,
} from "./regime-model"
import { clampParams } from "./regime-model"

export class ParticleFilter {
  private particles: ParticleState[]
  private config: BayesianConfig
  private stepCount: number
  private lastObservation: {
    imbalance: number
    zScore: number
    volatility: number
  } | null

  constructor(config: BayesianConfig) {
    this.config = config
    this.particles = []
    this.stepCount = 0
    this.lastObservation = null
    this.initializeParticles()
  }

  private initializeParticles(): void {
    const n = this.config.particleCount
    this.particles = []

    for (let i = 0; i < n; i++) {
      const regimeIdx = Math.floor(Math.random() * this.config.states.length)
      const regime = this.config.states[regimeIdx]
      const params = sampleInitialParams()

      this.particles.push({
        regime,
        weight: 1.0 / n,
        params: clampParams(params, [
          this.config.paramConstraints.imbalanceWeight,
          this.config.paramConstraints.zScoreWeight,
          this.config.paramConstraints.volatilityWeight,
        ]),
      })
    }
  }

  predict(): void {
    for (const particle of this.particles) {
      particle.regime = sampleNextRegime(
        particle.regime,
        this.config.transitionMatrix
      )
    }
  }

  update(feature: FeatureSnapshot): void {
    const observation = {
      imbalance: feature.imbalanceL1,
      zScore: feature.spreadZScore ?? 0,
      volatility: feature.volatility1s ?? 0,
    }

    this.lastObservation = observation
    this.stepCount++

    let totalWeight = 0
    const logWeights: number[] = []
    let maxLogWeight = -Infinity

    for (const particle of this.particles) {
      const logLikelihood = computeObservationLikelihood(
        observation,
        particle.regime,
        this.config.observationModel
      )
      logWeights.push(
        Math.log(Math.max(particle.weight, 1e-300)) + logLikelihood
      )
      maxLogWeight = Math.max(maxLogWeight, logWeights[logWeights.length - 1])
    }

    for (let i = 0; i < this.particles.length; i++) {
      const logW = logWeights[i] - maxLogWeight
      this.particles[i].weight = Math.exp(logW)
      totalWeight += this.particles[i].weight
    }

    if (totalWeight > 0) {
      for (const particle of this.particles) {
        particle.weight /= totalWeight
      }
    } else {
      const uniformWeight = 1.0 / this.particles.length
      for (const particle of this.particles) {
        particle.weight = uniformWeight
      }
    }

    const effectiveCount = this.computeEffectiveParticleCount()
    if (
      effectiveCount <
      this.config.resampleThreshold * this.config.particleCount
    ) {
      this.resample()
    }

    if (this.stepCount % 10 === 0) {
      this.adaptParticleParams(observation)
    }
  }

  resample(): void {
    const n = this.particles.length
    const newParticles: ParticleState[] = []

    const cumsums: number[] = []
    let sum = 0
    for (const p of this.particles) {
      sum += p.weight
      cumsums.push(sum)
    }

    const step = 1.0 / n
    let u = Math.random() * step

    let idx = 0
    for (let i = 0; i < n; i++) {
      while (u > cumsums[idx] && idx < n - 1) {
        idx++
      }

      newParticles.push({
        regime: this.particles[idx].regime,
        weight: step,
        params: {
          ...this.particles[idx].params,
          imbalanceWeight:
            this.particles[idx].params.imbalanceWeight +
            (Math.random() - 0.5) * 0.02,
          zScoreWeight:
            this.particles[idx].params.zScoreWeight +
            (Math.random() - 0.5) * 0.01,
          volatilityWeight:
            this.particles[idx].params.volatilityWeight +
            (Math.random() - 0.5) * 0.01,
        },
      })

      u += step
    }

    for (const p of newParticles) {
      p.params = clampParams(p.params, [
        this.config.paramConstraints.imbalanceWeight,
        this.config.paramConstraints.zScoreWeight,
        this.config.paramConstraints.volatilityWeight,
      ])
    }

    this.particles = newParticles
  }

  private adaptParticleParams(observation: {
    imbalance: number
    zScore: number
    volatility: number
  }): void {
    const learningRate = 0.1
    for (const particle of this.particles) {
      particle.params = adaptParams(particle.params, observation, learningRate)
      particle.params = clampParams(particle.params, [
        this.config.paramConstraints.imbalanceWeight,
        this.config.paramConstraints.zScoreWeight,
        this.config.paramConstraints.volatilityWeight,
      ])
    }
  }

  private computeEffectiveParticleCount(): number {
    let sumSq = 0
    for (const particle of this.particles) {
      sumSq += particle.weight * particle.weight
    }
    return sumSq > 0 ? 1.0 / sumSq : 0
  }

  getEstimate(): BayesianOutputEnhanced {
    const regimeProbs: Record<MarketRegime, number> = {
      up: 0,
      down: 0,
      range: 0,
      volatile: 0,
    }

    let pUp = 0
    for (const particle of this.particles) {
      regimeProbs[particle.regime] += particle.weight
      const direction = getRegimeDirection(particle.regime)
      const paramContrib =
        particle.params.imbalanceWeight *
          (this.lastObservation?.imbalance ?? 0) +
        particle.params.zScoreWeight * (this.lastObservation?.zScore ?? 0)
      pUp += particle.weight * (0.5 + direction * 0.3 + paramContrib)
    }

    pUp = Math.min(0.99, Math.max(0.01, pUp))

    let maxProb = 0
    let dominantRegime: MarketRegime = "range"
    for (const regime of this.config.states) {
      if (regimeProbs[regime] > maxProb) {
        maxProb = regimeProbs[regime]
        dominantRegime = regime
      }
    }

    const nextRegimeProb: Record<MarketRegime, number> = {
      up: 0,
      down: 0,
      range: 0,
      volatile: 0,
    }
    for (const particle of this.particles) {
      const transitionProbs = this.config.transitionMatrix[particle.regime]
      for (const regime of this.config.states) {
        nextRegimeProb[regime] += particle.weight * transitionProbs[regime]
      }
    }

    let predictedPriceMove: "up" | "down" | "neutral" = "neutral"
    if (pUp > 0.55) {
      predictedPriceMove = "up"
    } else if (pUp < 0.45) {
      predictedPriceMove = "down"
    }

    return {
      pUp,
      pDown: 1 - pUp,
      regime: dominantRegime,
      regimeConfidence: maxProb,
      confidence: Math.abs(pUp - 0.5) * 2,
      nextRegimeProb,
      predictedPriceMove,
      effectiveParticleCount: this.computeEffectiveParticleCount(),
    }
  }

  getParticles(): ParticleState[] {
    return [...this.particles]
  }

  reset(): void {
    this.stepCount = 0
    this.lastObservation = null
    this.initializeParticles()
  }
}

export function createParticleFilter(
  config?: Partial<BayesianConfig>
): ParticleFilter {
  const defaultConfig: BayesianConfig = {
    particleCount: 100,
    states: ["up", "down", "range", "volatile"],
    transitionMatrix: {
      up: { up: 0.7, down: 0.1, range: 0.15, volatile: 0.05 },
      down: { up: 0.1, down: 0.7, range: 0.15, volatile: 0.05 },
      range: { up: 0.15, down: 0.15, range: 0.6, volatile: 0.1 },
      volatile: { up: 0.2, down: 0.2, range: 0.2, volatile: 0.4 },
    },
    observationModel: {
      imbalanceMean: { up: 0.3, down: -0.3, range: 0.0, volatile: 0.0 },
      imbalanceStd: { up: 0.2, down: 0.2, range: 0.15, volatile: 0.4 },
      zScoreMean: { up: -0.5, down: 0.5, range: 0.0, volatile: 0.0 },
      zScoreStd: { up: 0.5, down: 0.5, range: 0.3, volatile: 1.0 },
      volatilityMean: { up: 0.01, down: 0.01, range: 0.005, volatile: 0.03 },
      volatilityStd: { up: 0.005, down: 0.005, range: 0.002, volatile: 0.02 },
    },
    resampleThreshold: 0.5,
    paramConstraints: {
      imbalanceWeight: { min: 0.1, max: 0.5 },
      zScoreWeight: { min: -0.2, max: 0.0 },
      volatilityWeight: { min: 0.0, max: 0.3 },
    },
    ...config,
  }
  return new ParticleFilter(defaultConfig)
}
