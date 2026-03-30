import type { BayesianConfig, MarketRegime } from "../contracts/types"

const STATES: MarketRegime[] = ["up", "down", "range", "volatile"]

const DEFAULT_TRANSITION_MATRIX: Record<
  MarketRegime,
  Record<MarketRegime, number>
> = {
  up: { up: 0.7, down: 0.1, range: 0.15, volatile: 0.05 },
  down: { up: 0.1, down: 0.7, range: 0.15, volatile: 0.05 },
  range: { up: 0.15, down: 0.15, range: 0.6, volatile: 0.1 },
  volatile: { up: 0.2, down: 0.2, range: 0.2, volatile: 0.4 },
}

const DEFAULT_OBSERVATION_MODEL = {
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

export const DEFAULT_BAYESIAN_CONFIG: BayesianConfig = {
  particleCount: 100,
  states: STATES,
  transitionMatrix: DEFAULT_TRANSITION_MATRIX,
  observationModel: DEFAULT_OBSERVATION_MODEL,
  resampleThreshold: 0.5,
  paramConstraints: {
    imbalanceWeight: { min: 0.1, max: 0.5 },
    zScoreWeight: { min: -0.2, max: 0.0 },
    volatilityWeight: { min: 0.0, max: 0.3 },
  },
}

export function createBayesianConfig(
  overrides?: Partial<BayesianConfig>
): BayesianConfig {
  return {
    ...DEFAULT_BAYESIAN_CONFIG,
    ...overrides,
  }
}
