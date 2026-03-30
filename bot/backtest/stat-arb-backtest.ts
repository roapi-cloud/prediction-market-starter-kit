import { StatArbEngine } from "../signal/index"
import type { StatArbConfig } from "../contracts/types"
import { SpreadHistory } from "../data/spread-history"

function generateMeanRevertingSpread(
  nPoints: number,
  mean: number,
  std: number,
  halfLife: number
): number[] {
  const spreads: number[] = []
  let current = mean

  const lambda = Math.exp(-Math.log(2) / halfLife)
  const noiseStd = std * Math.sqrt(1 - lambda * lambda)

  for (let i = 0; i < nPoints; i++) {
    const noise = (Math.random() - 0.5) * 2 * noiseStd
    current = lambda * current + (1 - lambda) * mean + noise
    spreads.push(current)
  }

  return spreads
}

function generatePricesFromSpread(
  spreads: number[],
  basePriceA: number,
  hedgeRatio: number
): { priceA: number; priceB: number }[] {
  const prices: { priceA: number; priceB: number }[] = []

  for (const spread of spreads) {
    const priceB = basePriceA - spread / hedgeRatio
    prices.push({
      priceA: basePriceA,
      priceB: Math.max(0.01, Math.min(0.99, priceB)),
    })
  }

  return prices
}

type BacktestResult = {
  totalSignals: number
  longSpreadSignals: number
  shortSpreadSignals: number
  avgEvBps: number
  avgConfidence: number
  avgHoldingTimeMs: number
  signalDistribution: { zScoreRange: string; count: number }[]
}

function runBacktest(
  config: StatArbConfig,
  nPoints: number,
  mean: number,
  std: number,
  halfLife: number
): BacktestResult {
  const history = new SpreadHistory(1000)
  const engine = new StatArbEngine([config], 1000)

  const spreads = generateMeanRevertingSpread(nPoints, mean, std, halfLife)
  const prices = generatePricesFromSpread(spreads, 0.5, config.hedgeRatio)

  for (let i = 0; i < Math.min(50, nPoints); i++) {
    const marketPrices = new Map([
      [config.marketA, prices[i].priceA],
      [config.marketB, prices[i].priceB],
    ])
    engine.updateHistory(marketPrices, i * 1000)
  }

  const signals: {
    zScore: number
    direction: string
    evBps: number
    confidence: number
  }[] = []

  for (let i = 50; i < nPoints; i++) {
    const marketPrices = new Map([
      [config.marketA, prices[i].priceA],
      [config.marketB, prices[i].priceB],
    ])
    engine.updateHistory(marketPrices, i * 1000)

    const opportunities = engine.scan(marketPrices, i * 1000)
    for (const opp of opportunities) {
      const zScore =
        opp.confidence > 0
          ? opp.evBps > 0
            ? opp.evBps / 10 + config.exitZThreshold
            : 0
          : 0
      signals.push({
        zScore,
        direction: opp.evBps > 0 ? "entry" : "neutral",
        evBps: opp.evBps,
        confidence: opp.confidence,
      })
    }
  }

  const entrySignals = signals.filter((s) => s.evBps > 0)
  const longSpread = entrySignals.filter((s) => s.zScore < 0).length
  const shortSpread = entrySignals.filter((s) => s.zScore > 0).length

  const avgEvBps =
    entrySignals.length > 0
      ? entrySignals.reduce((a, b) => a + b.evBps, 0) / entrySignals.length
      : 0

  const avgConfidence =
    entrySignals.length > 0
      ? entrySignals.reduce((a, b) => a + b.confidence, 0) / entrySignals.length
      : 0

  const zScoreRanges = [
    { range: "[-3, -2)", min: -3, max: -2 },
    { range: "[-2, -1)", min: -2, max: -1 },
    { range: "[-1, 0)", min: -1, max: 0 },
    { range: "[0, 1)", min: 0, max: 1 },
    { range: "[1, 2)", min: 1, max: 2 },
    { range: "[2, 3)", min: 2, max: 3 },
    { range: "[3+)", min: 3, max: Infinity },
  ]

  const signalDistribution = zScoreRanges.map(({ range, min, max }) => ({
    zScoreRange: range,
    count: signals.filter((s) => s.zScore >= min && s.zScore < max).length,
  }))

  return {
    totalSignals: signals.length,
    longSpreadSignals: longSpread,
    shortSpreadSignals: shortSpread,
    avgEvBps,
    avgConfidence,
    avgHoldingTimeMs: config.maxHoldingMs,
    signalDistribution,
  }
}

const config: StatArbConfig = {
  pairId: "test-pair",
  marketA: "market-a",
  marketB: "market-b",
  hedgeRatio: 1.0,
  lookbackWindow: 100,
  entryZThreshold: 2.0,
  exitZThreshold: 0.5,
  maxHoldingMs: 300000,
  stopLossZThreshold: 3.0,
}

console.log("=== Stat Arb Backtest ===\n")

const scenarios = [
  { name: "Fast mean reversion", halfLife: 30 },
  { name: "Medium mean reversion", halfLife: 60 },
  { name: "Slow mean reversion", halfLife: 120 },
]

for (const scenario of scenarios) {
  console.log(`\n--- ${scenario.name} (half-life: ${scenario.halfLife}s) ---`)
  const result = runBacktest(config, 1000, 0.0, 0.1, scenario.halfLife)

  console.log(`Total signals: ${result.totalSignals}`)
  console.log(`Long spread signals: ${result.longSpreadSignals}`)
  console.log(`Short spread signals: ${result.shortSpreadSignals}`)
  console.log(`Average EV (bps): ${result.avgEvBps.toFixed(2)}`)
  console.log(`Average confidence: ${result.avgConfidence.toFixed(2)}`)
  console.log(`Average holding time (ms): ${result.avgHoldingTimeMs}`)
  console.log("\nZ-Score distribution:")
  for (const dist of result.signalDistribution) {
    console.log(`  ${dist.zScoreRange}: ${dist.count}`)
  }
}

console.log("\n=== Backtest Complete ===")
