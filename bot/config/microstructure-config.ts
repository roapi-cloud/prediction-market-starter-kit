import type { MicrostructureConfig } from "../contracts/types"

export const DEFAULT_MICROSTRUCTURE_CONFIG: MicrostructureConfig = {
  imbalanceThreshold: 0.6,
  microPriceDevThreshold: 0.01,
  largeTradeMultiplier: 3.0,
  queueCollapseWindowMs: 500,
  sparseTradeThreshold: 5,
}

export const SIGNAL_WEIGHTS = {
  imbalance: 0.3,
  microPriceDev: 0.25,
  largeTrade: 0.25,
  queueCollapse: 0.15,
  sparseTrade: 0.05,
}

export const MIN_COMBINED_SCORE = 0.4
export const MIN_EV_BPS = 3
export const DEFAULT_TTL_MS = 2000
