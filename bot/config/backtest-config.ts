import type {
  BacktestConfigEnhanced,
  DelayDistribution,
  PerturbationRanges,
  RiskConfigEnhanced,
  ExecutionConfigBacktest,
  QueueSimulationConfig,
} from "../contracts/types"

export function createDefaultDelayConfig(): DelayDistribution {
  return {
    meanMs: 50,
    stdMs: 30,
    p99Ms: 200,
    spikeProbability: 0.01,
    spikeMs: 1000,
  }
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

export function createDefaultRiskConfig(): RiskConfigEnhanced {
  return {
    maxPositionSize: 1000,
    maxMarketExposure: 500,
    maxIntradayLoss: 200,
    maxIntradayLossPct: 2,
    maxDrawdownPct: 4,
    consecutiveFailThreshold: 5,
    failCooldownMs: 60000,
    correlationMatrix: new Map(),
    maxCombinedExposure: 1500,
    slippageAlertThreshold: 50,
    slippageCalibrationWindow: 100,
  }
}

export function createDefaultExecutionConfig(): ExecutionConfigBacktest {
  return {
    kellyCap: 0.02,
    stoikovRiskAversion: 0.002,
    slippageBps: 20,
    partialFillBaseRate: 0.7,
    partialFillSizeDecay: 0.1,
  }
}

export function createDefaultQueueConfig(): QueueSimulationConfig {
  return {
    trackQueuePosition: true,
    consumeRate: 0.1,
    frontCancelRate: 0.05,
  }
}

export function createDefaultBacktestConfig(): BacktestConfigEnhanced {
  return {
    dataStart: 0,
    dataEnd: 0,
    dataPath: "",
    replaySpeed: 1,
    simulateQueue: true,
    simulateDepth: 5,
    injectDelay: true,
    delayConfig: createDefaultDelayConfig(),
    monteCarloRuns: 10000,
    perturbationRanges: createDefaultPerturbationRanges(),
    samplingMethod: "lhs",
    strategiesEnabled: [
      "static_arb",
      "stat_arb",
      "microstructure",
      "term_structure",
    ],
    riskConfig: createDefaultRiskConfig(),
    executionConfig: createDefaultExecutionConfig(),
  }
}

export function validateBacktestConfig(config: BacktestConfigEnhanced): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []

  if (config.dataStart >= config.dataEnd) {
    errors.push("dataStart must be less than dataEnd")
  }

  if (!config.dataPath) {
    errors.push("dataPath must be specified")
  }

  if (config.replaySpeed <= 0) {
    errors.push("replaySpeed must be positive")
  }

  if (config.simulateDepth < 1 || config.simulateDepth > 10) {
    errors.push("simulateDepth must be between 1 and 10")
  }

  if (config.delayConfig.meanMs < 0) {
    errors.push("delayConfig.meanMs must be non-negative")
  }

  if (config.monteCarloRuns < 100) {
    errors.push("monteCarloRuns must be at least 100")
  }

  if (
    config.perturbationRanges.fillRateRange[0] < 0 ||
    config.perturbationRanges.fillRateRange[1] > 1
  ) {
    errors.push("fillRateRange must be between 0 and 1")
  }

  if (config.perturbationRanges.slippageMultiplier[0] <= 0) {
    errors.push("slippageMultiplier must be positive")
  }

  return { valid: errors.length === 0, errors }
}

export function mergeBacktestConfig(
  base: BacktestConfigEnhanced,
  overrides: Partial<BacktestConfigEnhanced>
): BacktestConfigEnhanced {
  return {
    ...base,
    ...overrides,
    delayConfig: {
      ...base.delayConfig,
      ...overrides.delayConfig,
    },
    perturbationRanges: {
      ...base.perturbationRanges,
      ...overrides.perturbationRanges,
    },
    riskConfig: {
      ...base.riskConfig,
      ...overrides.riskConfig,
    },
    executionConfig: {
      ...base.executionConfig,
      ...overrides.executionConfig,
    },
  }
}

export function createNetworkConditionDelayConfig(
  condition: "good" | "medium" | "bad"
): DelayDistribution {
  const configs: Record<string, DelayDistribution> = {
    good: {
      meanMs: 20,
      stdMs: 10,
      p99Ms: 50,
      spikeProbability: 0.001,
      spikeMs: 100,
    },
    medium: createDefaultDelayConfig(),
    bad: {
      meanMs: 150,
      stdMs: 100,
      p99Ms: 500,
      spikeProbability: 0.05,
      spikeMs: 2000,
    },
  }

  return configs[condition]
}

export function loadBacktestConfigFromJson(
  path: string
): BacktestConfigEnhanced {
  const fs = require("fs")
  const raw = fs.readFileSync(path, "utf8")
  const parsed = JSON.parse(raw)
  return mergeBacktestConfig(createDefaultBacktestConfig(), parsed)
}
