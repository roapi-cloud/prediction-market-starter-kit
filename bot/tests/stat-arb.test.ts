import test from "node:test"
import assert from "node:assert/strict"
import {
  computeSpread,
  computeZScore,
  computeStatArb,
  generateStatArbOpportunity,
  determineDirection,
  calculateEvBps,
  calculateConfidence,
  shouldExitPosition,
} from "../signal/stat-arb"
import { SpreadHistory } from "../data/spread-history"
import type { StatArbConfig } from "../contracts/types"

const defaultConfig: StatArbConfig = {
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

test("computeSpread calculates correctly", () => {
  assert.ok(Math.abs(computeSpread(0.6, 0.4, 1.0) - 0.2) < 1e-10)
  assert.equal(computeSpread(0.5, 0.5, 1.0), 0)
  assert.ok(Math.abs(computeSpread(0.7, 0.3, 0.5) - 0.55) < 1e-10)
})

test("computeZScore handles normal case", () => {
  const z = computeZScore(1.5, 1.0, 0.25)
  assert.equal(z, 2.0)
})

test("computeZScore returns 0 for zero std", () => {
  const z = computeZScore(1.5, 1.0, 0)
  assert.equal(z, 0)
})

test("determineDirection returns neutral for low Z-score", () => {
  const direction = determineDirection(1.5, defaultConfig)
  assert.equal(direction, "neutral")
})

test("determineDirection returns short_spread for high positive Z-score", () => {
  const direction = determineDirection(2.5, defaultConfig)
  assert.equal(direction, "short_spread")
})

test("determineDirection returns long_spread for high negative Z-score", () => {
  const direction = determineDirection(-2.5, defaultConfig)
  assert.equal(direction, "long_spread")
})

test("calculateEvBps returns 0 for Z below threshold", () => {
  const ev = calculateEvBps(1.5, defaultConfig)
  assert.equal(ev, 0)
})

test("calculateEvBps calculates expected reversion", () => {
  const ev = calculateEvBps(2.5, defaultConfig)
  assert.equal(ev, 20)
})

test("calculateConfidence increases with Z-score magnitude", () => {
  const conf1 = calculateConfidence(2.0)
  const conf2 = calculateConfidence(3.0)
  assert.ok(conf2 > conf1)
})

test("calculateConfidence considers half-life", () => {
  const confShort = calculateConfidence(2.5, 20)
  const confLong = calculateConfidence(2.5, 200)
  assert.ok(confShort > confLong)
})

test("SpreadHistory stores and retrieves entries", () => {
  const history = new SpreadHistory()
  history.add("pair1", 1000, 0.6, 0.4, 1.0)
  history.add("pair1", 2000, 0.5, 0.5, 1.0)

  const entries = history.get("pair1")
  assert.equal(entries.length, 2)
  assert.ok(Math.abs(entries[0].spread - 0.2) < 1e-10)
  assert.equal(entries[1].spread, 0)
})

test("SpreadHistory respects max window size", () => {
  const history = new SpreadHistory(5)
  for (let i = 0; i < 10; i++) {
    history.add("pair1", i, 0.5, 0.5, 1.0)
  }

  const entries = history.get("pair1")
  assert.equal(entries.length, 5)
})

test("SpreadHistory estimates half-life", () => {
  const history = new SpreadHistory()
  const spreads = []
  for (let i = 0; i < 50; i++) {
    spreads.push(0.1 * Math.exp(-i * 0.05))
  }

  const halfLife = history.estimateHalfLife(spreads)
  assert.ok(halfLife !== undefined)
  assert.ok(halfLife > 0)
})

test("computeStatArb returns null for missing prices", () => {
  const history = new SpreadHistory()
  const prices = new Map([["market-a", 0.6]])

  const signal = computeStatArb(prices, history, defaultConfig)
  assert.equal(signal, null)
})

test("computeStatArb returns null for insufficient history", () => {
  const history = new SpreadHistory()
  const prices = new Map([
    ["market-a", 0.6],
    ["market-b", 0.4],
  ])

  for (let i = 0; i < 5; i++) {
    history.add("test-pair", i, 0.5, 0.5, 1.0)
  }

  const signal = computeStatArb(prices, history, defaultConfig)
  assert.equal(signal, null)
})

test("computeStatArb generates signal with sufficient history", () => {
  const history = new SpreadHistory()
  const prices = new Map([
    ["market-a", 0.8],
    ["market-b", 0.2],
  ])

  for (let i = 0; i < 50; i++) {
    history.add("test-pair", i, 0.5, 0.5, 1.0)
  }

  const signal = computeStatArb(prices, history, defaultConfig)
  assert.ok(signal !== null)
  assert.equal(signal?.pairId, "test-pair")
  assert.ok(signal?.zScore > 2.0)
  assert.equal(signal?.direction, "short_spread")
})

test("generateStatArbOpportunity creates opportunity for valid signal", () => {
  const signal = {
    pairId: "test-pair",
    zScore: 2.5,
    direction: "short_spread" as const,
    evBps: 20,
    confidence: 0.8,
    ttlMs: 300000,
  }

  const opportunity = generateStatArbOpportunity(signal, defaultConfig, 1000)
  assert.ok(opportunity !== null)
  assert.equal(opportunity?.strategy, "stat_arb")
  assert.deepEqual(opportunity?.marketIds, ["market-a", "market-b"])
})

test("generateStatArbOpportunity returns null for neutral signal", () => {
  const signal = {
    pairId: "test-pair",
    zScore: 1.0,
    direction: "neutral" as const,
    evBps: 0,
    confidence: 0,
    ttlMs: 300000,
  }

  const opportunity = generateStatArbOpportunity(signal, defaultConfig, 1000)
  assert.equal(opportunity, null)
})

test("generateStatArbOpportunity returns null for stop loss threshold", () => {
  const signal = {
    pairId: "test-pair",
    zScore: 3.5,
    direction: "short_spread" as const,
    evBps: 30,
    confidence: 0.9,
    ttlMs: 300000,
  }

  const opportunity = generateStatArbOpportunity(signal, defaultConfig, 1000)
  assert.equal(opportunity, null)
})

test("shouldExitPosition returns true when Z-score reverses past threshold", () => {
  assert.equal(shouldExitPosition(0.3, 2.5, defaultConfig), true)
  assert.equal(shouldExitPosition(0.6, 2.5, defaultConfig), false)
})

test("shouldExitPosition returns true when Z-score flips sign", () => {
  assert.equal(shouldExitPosition(-0.5, 2.5, defaultConfig), true)
})

test("shouldExitPosition returns true when Z-score widens significantly", () => {
  assert.equal(shouldExitPosition(3.6, 2.5, defaultConfig), true)
})
