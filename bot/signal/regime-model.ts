import type {
  MarketRegime,
  ParticleParams,
  ObservationModel,
} from "../contracts/types"

export function getRegimeDirection(regime: MarketRegime): number {
  switch (regime) {
    case "up":
      return 1
    case "down":
      return -1
    case "range":
    case "volatile":
      return 0
  }
}

export function isVolatileRegime(regime: MarketRegime): boolean {
  return regime === "volatile"
}

export function sampleInitialParams(): ParticleParams {
  return {
    imbalanceWeight: 0.3 + (Math.random() - 0.5) * 0.2,
    zScoreWeight: -0.05 + (Math.random() - 0.5) * 0.04,
    volatilityWeight: 0.05 + (Math.random() - 0.5) * 0.05,
  }
}

export function clampParams(
  params: ParticleParams,
  constraints: { min: number; max: number }[]
): ParticleParams {
  return {
    imbalanceWeight: Math.max(
      constraints[0].min,
      Math.min(constraints[0].max, params.imbalanceWeight)
    ),
    zScoreWeight: Math.max(
      constraints[1].min,
      Math.min(constraints[1].max, params.zScoreWeight)
    ),
    volatilityWeight: Math.max(
      constraints[2].min,
      Math.min(constraints[2].max, params.volatilityWeight)
    ),
  }
}

export function computeObservationLikelihood(
  observation: { imbalance: number; zScore: number; volatility: number },
  regime: MarketRegime,
  model: ObservationModel
): number {
  const imbalanceLL = gaussianLogLikelihood(
    observation.imbalance,
    model.imbalanceMean[regime],
    model.imbalanceStd[regime]
  )
  const zScoreLL = gaussianLogLikelihood(
    observation.zScore,
    model.zScoreMean[regime],
    model.zScoreStd[regime]
  )
  const volatilityLL = gaussianLogLikelihood(
    observation.volatility,
    model.volatilityMean[regime],
    model.volatilityStd[regime]
  )

  return imbalanceLL + zScoreLL * 0.5 + volatilityLL * 0.3
}

function gaussianLogLikelihood(x: number, mean: number, std: number): number {
  if (std <= 0) return -Infinity
  const diff = x - mean
  return (
    -0.5 * Math.log(2 * Math.PI) -
    Math.log(std) -
    (diff * diff) / (2 * std * std)
  )
}

export function sampleNextRegime(
  currentRegime: MarketRegime,
  transitionMatrix: Record<MarketRegime, Record<MarketRegime, number>>
): MarketRegime {
  const probs = transitionMatrix[currentRegime]
  const rand = Math.random()
  let cumsum = 0

  const regimes: MarketRegime[] = ["up", "down", "range", "volatile"]
  for (const regime of regimes) {
    cumsum += probs[regime]
    if (rand <= cumsum) {
      return regime
    }
  }

  return regimes[regimes.length - 1]
}

export function adaptParams(
  params: ParticleParams,
  observation: { imbalance: number; zScore: number; volatility: number },
  learningRate: number
): ParticleParams {
  const newImbalance =
    params.imbalanceWeight + learningRate * observation.imbalance * 0.01
  const newZScore =
    params.zScoreWeight + learningRate * observation.zScore * 0.001
  const newVolatility =
    params.volatilityWeight + learningRate * observation.volatility * 0.1

  return {
    imbalanceWeight: newImbalance,
    zScoreWeight: newZScore,
    volatilityWeight: newVolatility,
  }
}
