import test from "node:test"
import assert from "node:assert/strict"
import {
  QueueSimulator,
  createDefaultQueueConfig,
} from "../backtest/queue-simulator"
import {
  DepthSimulator,
  createDefaultDepthConfig,
} from "../backtest/depth-simulator"
import {
  DelayInjector,
  createDefaultDelayConfig,
} from "../backtest/delay-injector"
import { LHSSampler, lhsSampleBounded } from "../montecarlo/lhs-sampler"
import {
  perturbParams,
  generatePerturbationSet,
  createDefaultPerturbationRanges,
} from "../montecarlo/perturbation"
import {
  SensitivityAnalyzer,
  createDefaultBaseParams,
} from "../montecarlo/sensitivity"
import {
  attributePnl,
  computeSignalQuality,
  computeExecutionLoss,
} from "../backtest/attribution"
import {
  generatePnlCurve,
  generateMcDistribution,
  computeSummaryStatistics,
  computeExecutionStatistics,
  computeRiskStatistics,
} from "../backtest/report-generator"
import {
  createDefaultBacktestConfig,
  validateBacktestConfig,
  mergeBacktestConfig,
} from "../config/backtest-config"
import {
  createSyntheticData,
  validateHistoricalData,
  aggregateTicksByInterval,
} from "../backtest/historical-loader"
import {
  monteCarloEnhanced,
  percentile,
  computeConfidenceInterval,
} from "../montecarlo/sim"
import {
  BacktestEngineEnhanced,
  runEnhancedBacktest,
} from "../backtest/engine-enhanced"

test("QueueSimulator initializes with default config", () => {
  const config = createDefaultQueueConfig()
  const simulator = new QueueSimulator(config)
  assert.ok(simulator)
})

test("QueueSimulator simulates queue position", () => {
  const simulator = new QueueSimulator(createDefaultQueueConfig())
  const order = {
    opportunityId: "test-opp",
    marketId: "test-market",
    side: "buy" as const,
    price: 0.5,
    size: 100,
    tif: "IOC" as const,
  }
  const snapshot = {
    ts: Date.now(),
    marketId: "test-market",
    bids: [{ price: 0.5, size: 100 }],
    asks: [{ price: 0.51, size: 100 }],
  }
  const position = simulator.simulateQueuePosition(order, snapshot)
  assert.ok(position >= 0)
})

test("QueueSimulator simulates queue consumption", () => {
  const simulator = new QueueSimulator(createDefaultQueueConfig())
  const trades = [{ side: "buy", size: 50 }]
  const newPosition = simulator.simulateConsume(100, trades)
  assert.ok(newPosition <= 100)
})

test("QueueSimulator simulates fill with queue position", () => {
  const simulator = new QueueSimulator(createDefaultQueueConfig())
  const result = simulator.simulateFill(50, 100)
  assert.ok(result.filledSize >= 0)
  assert.ok(result.filledSize <= 100)
  assert.ok(result.remainingQueue >= 0)
})

test("DelayInjector initializes with default config", () => {
  const injector = new DelayInjector(createDefaultDelayConfig())
  assert.ok(injector)
})

test("DelayInjector injects delays within expected range", () => {
  const config = {
    meanMs: 50,
    stdMs: 30,
    p99Ms: 200,
    spikeProbability: 0.01,
    spikeMs: 1000,
  }
  const injector = new DelayInjector(config)

  for (let i = 0; i < 100; i++) {
    const delay = injector.injectDelay()
    assert.ok(delay >= 0)
    assert.ok(delay <= 1500)
  }
})

test("DelayInjector provides delay statistics", () => {
  const injector = new DelayInjector(createDefaultDelayConfig())
  for (let i = 0; i < 100; i++) {
    injector.injectDelay()
  }
  const stats = injector.getDelayStats()
  assert.ok(stats.mean > 0)
  assert.ok(stats.std >= 0)
})

test("DelayInjector simulates network conditions", () => {
  const injector = new DelayInjector(createDefaultDelayConfig())
  injector.simulateNetworkCondition("good")
  const delay1 = injector.injectDelay()

  injector.reset()
  injector.simulateNetworkCondition("bad")
  const delay2 = injector.injectDelay()

  assert.ok(delay2 > delay1)
})

test("DepthSimulator initializes with default config", () => {
  const simulator = new DepthSimulator(createDefaultDepthConfig())
  assert.ok(simulator)
})

test("DepthSimulator simulates depth levels", () => {
  const simulator = new DepthSimulator({
    levels: 5,
    tickSize: 0.01,
    minSpread: 0.02,
    liquidityDecayRate: 0.5,
  })
  const snapshot = simulator.simulateDepth(0.5, 0.02, "test-market")
  assert.strictEqual(snapshot.bids.length, 5)
  assert.strictEqual(snapshot.asks.length, 5)
})

test("DepthSimulator calculates depth metrics", () => {
  const simulator = new DepthSimulator(createDefaultDepthConfig())
  simulator.simulateDepth(0.5, 0.02, "test-market")
  const metrics = simulator.calculateDepthMetrics("test-market")
  assert.ok(metrics.bidDepth > 0)
  assert.ok(metrics.askDepth > 0)
  assert.ok(metrics.spread > 0)
})

test("DepthSimulator simulates liquidity disappearance", () => {
  const simulator = new DepthSimulator(createDefaultDepthConfig())
  simulator.simulateDepth(0.5, 0.02, "test-market")
  const metricsBefore = simulator.calculateDepthMetrics("test-market")
  simulator.simulateLiquidityDisappearance("test-market", 0.5)
  const metricsAfter = simulator.calculateDepthMetrics("test-market")
  assert.ok(metricsAfter.bidDepth < metricsBefore.bidDepth)
})

test("LHSSampler generates samples with correct dimensions", () => {
  const sampler = new LHSSampler(3, 10)
  const samples = sampler.sample()
  assert.strictEqual(samples.length, 10)
  assert.strictEqual(samples[0].length, 3)
})

test("LHSSampler generates bounded samples", () => {
  const bounds: Array<[number, number]> = [
    [0, 1],
    [10, 20],
    [100, 200],
  ]
  const samples = lhsSampleBounded(bounds, 20)
  assert.strictEqual(samples.length, 20)
  for (const sample of samples) {
    assert.ok(sample[0] >= 0 && sample[0] <= 1)
    assert.ok(sample[1] >= 10 && sample[1] <= 20)
  }
})

test("Perturbation generates perturbed parameters", () => {
  const ranges = createDefaultPerturbationRanges()
  const params = perturbParams(createDefaultBaseParams(), ranges)
  assert.ok(params.slippageMultiplier >= ranges.slippageMultiplier[0])
  assert.ok(params.slippageMultiplier <= ranges.slippageMultiplier[1])
})

test("Perturbation generates perturbation set", () => {
  const ranges = createDefaultPerturbationRanges()
  const set = generatePerturbationSet(ranges, 100, "random")
  assert.strictEqual(set.length, 100)
})

test("Perturbation generates LHS perturbations", () => {
  const ranges = createDefaultPerturbationRanges()
  const set = generatePerturbationSet(ranges, 50, "lhs")
  assert.strictEqual(set.length, 50)
})

test("SensitivityAnalyzer analyzes parameter sensitivity", () => {
  const analyzer = new SensitivityAnalyzer(
    createDefaultBaseParams(),
    createDefaultPerturbationRanges()
  )
  const result = analyzer.analyzeOneParameter(
    "slippageMultiplier",
    10,
    () => 100
  )
  assert.strictEqual(result.parameter, "slippageMultiplier")
  assert.strictEqual(typeof result.sensitivity, "number")
})

test("Attribution computes PnL attribution", () => {
  const events = [
    {
      ts: 1,
      type: "execution",
      data: {},
      pnl: 100,
      signalPnl: 110,
      executionLoss: 10,
    },
    {
      ts: 2,
      type: "execution",
      data: {},
      pnl: -50,
      signalPnl: 0,
      executionLoss: 50,
    },
  ]
  const result = attributePnl(events as any)
  assert.strictEqual(result.signalPnl, 110)
  assert.strictEqual(result.executionLoss, 60)
})

test("Attribution computes signal quality", () => {
  const opportunities = [
    { evBps: 50, actualPnlBps: 40 },
    { evBps: 30, actualPnlBps: -10 },
  ]
  const result = computeSignalQuality(opportunities)
  assert.strictEqual(result.hitRate, 0.5)
  assert.strictEqual(result.avgEvBps, 40)
})

test("Attribution computes execution loss", () => {
  const executions = [
    { intendedPrice: 0.5, actualPrice: 0.495, size: 100, delayMs: 50 },
    { intendedPrice: 0.51, actualPrice: 0.512, size: 50, delayMs: 100 },
  ]
  const result = computeExecutionLoss(executions)
  assert.ok(result.avgSlippageBps > 0)
})

test("ReportGenerator generates PnL curve", () => {
  const events = [
    { ts: 1, pnl: 10 },
    { ts: 2, pnl: 20 },
    { ts: 3, pnl: -5 },
  ]
  const curve = generatePnlCurve(events, 10000)
  assert.strictEqual(curve.length, 3)
  assert.strictEqual(curve[0].equity, 10010)
})

test("ReportGenerator computes summary statistics", () => {
  const curve = [
    { pnl: 10, equity: 10100 },
    { pnl: 20, equity: 10200 },
    { pnl: -30, equity: 9900 },
  ]
  const stats = computeSummaryStatistics(curve)
  assert.ok(stats.maxDrawdown > 0)
})

test("ReportGenerator generates MC distribution", () => {
  const pnlValues = Array.from({ length: 100 }, (_, i) => i * 10)
  const distribution = generateMcDistribution(pnlValues, 10)
  assert.strictEqual(distribution.length, 10)
  assert.ok(distribution[0].probability > 0)
})

test("BacktestConfig creates default config", () => {
  const config = createDefaultBacktestConfig()
  assert.strictEqual(config.monteCarloRuns, 10000)
  assert.strictEqual(config.simulateDepth, 5)
})

test("BacktestConfig validates valid config", () => {
  const validConfig = createDefaultBacktestConfig()
  validConfig.dataPath = "test"
  validConfig.dataStart = 1000
  validConfig.dataEnd = 2000
  const result = validateBacktestConfig(validConfig)
  assert.strictEqual(result.valid, true)
})

test("BacktestConfig detects invalid config", () => {
  const config = createDefaultBacktestConfig()
  config.dataStart = 2000
  config.dataEnd = 1000
  const result = validateBacktestConfig(config)
  assert.strictEqual(result.valid, false)
  assert.ok(result.errors.includes("dataStart must be less than dataEnd"))
})

test("BacktestConfig merges configs", () => {
  const base = createDefaultBacktestConfig()
  const merged = mergeBacktestConfig(base, { monteCarloRuns: 5000 })
  assert.strictEqual(merged.monteCarloRuns, 5000)
})

test("HistoricalLoader creates synthetic data", () => {
  const data = createSyntheticData(100, "test-market")
  assert.strictEqual(data.ticks.length, 100)
  assert.strictEqual(data.snapshots.length, 100)
})

test("HistoricalLoader validates historical data", () => {
  const data = createSyntheticData(10, "test-market")
  const result = validateHistoricalData(data)
  assert.strictEqual(result.valid, true)
})

test("HistoricalLoader aggregates ticks by interval", () => {
  const ticks = Array.from({ length: 100 }, (_, i) => ({
    ts: 1000 + i * 100,
    marketId: "test",
    yesBid: 0.5,
    yesAsk: 0.51,
    noBid: 0.49,
    noAsk: 0.5,
    volume: 10,
  }))
  const aggregated = aggregateTicksByInterval(ticks, 1000)
  assert.ok(aggregated.length <= 100)
  assert.ok(aggregated[0].tickCount > 0)
})

test("MonteCarlo computes percentile", () => {
  const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  assert.strictEqual(percentile(sorted, 50), 5)
  assert.ok(percentile(sorted, 95) >= 9)
})

test("MonteCarlo computes confidence interval", () => {
  const distribution = Array.from({ length: 100 }, (_, i) => i)
  const ci = computeConfidenceInterval(distribution, 0.95)
  assert.ok(ci.lower < ci.upper)
})

test("MonteCarlo runs enhanced simulation", () => {
  const ranges = createDefaultPerturbationRanges()
  const result = monteCarloEnhanced(1000, 200, 1000, ranges, "random")
  assert.strictEqual(result.pnlDistribution.length, 1000)
  assert.ok(result.meanPnl > 0)
  assert.ok(result.p05Pnl < result.p95Pnl)
})

test("BacktestEngineEnhanced runs backtest on synthetic data", () => {
  const config = createDefaultBacktestConfig()
  config.dataPath = "test"
  config.dataStart = Date.now() - 100000
  config.dataEnd = Date.now()

  const data = createSyntheticData(100, "test-market")
  const engine = new BacktestEngineEnhanced(config)
  const result = engine.runBacktest(data)

  assert.ok(result.totalOpportunities >= 0)
  assert.ok(result.totalPnl !== undefined)
  assert.ok(result.mcPnLMean !== undefined)
})

test("BacktestEngineEnhanced generates report", () => {
  const config = createDefaultBacktestConfig()
  config.dataPath = "test"

  const data = createSyntheticData(50, "test-market")
  const engine = new BacktestEngineEnhanced(config)
  const result = engine.runBacktest(data)
  const report = engine.generateReport(result)

  assert.ok(report.summary)
  assert.ok(report.pnlCurve)
})

test("runEnhancedBacktest convenience function", () => {
  const config = createDefaultBacktestConfig()
  config.dataPath = "test"

  const data = createSyntheticData(20, "test-market")
  const result = runEnhancedBacktest(data, config)

  assert.ok(result)
  assert.ok(result.totalPnl !== undefined)
})
