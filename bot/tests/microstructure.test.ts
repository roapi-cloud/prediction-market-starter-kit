import test from "node:test"
import assert from "node:assert/strict"
import {
  computeBookMetrics,
  computeImbalance,
  computeMicroPrice,
} from "../signal/book-metrics"
import { computeTradeMetrics, isSparseTrading } from "../signal/trade-metrics"
import { detectMicrostructureOpportunity } from "../signal/microstructure"
import type { BookState, DepthLevel } from "../ingest/orderbook"
import type { MarketEvent } from "../contracts/types"

test("computeImbalance: correct calculation", () => {
  assert.equal(computeImbalance(100, 100), 0)
  assert.equal(computeImbalance(200, 100), 1 / 3)
  assert.equal(computeImbalance(100, 200), -1 / 3)
  assert.equal(computeImbalance(0, 0), 0)
})

test("computeMicroPrice: correct calculation", () => {
  const bid = 0.49
  const ask = 0.51
  const bidDepth = 100
  const askDepth = 100

  const microPrice = computeMicroPrice(bid, ask, bidDepth, askDepth)
  const expected = (ask * bidDepth + bid * askDepth) / (bidDepth + askDepth)
  assert.equal(microPrice, expected)
  assert.ok(microPrice > bid && microPrice < ask)
})

test("computeMicroPrice: weighted toward bid when ask depth higher", () => {
  const bid = 0.49
  const ask = 0.51
  const bidDepth = 100
  const askDepth = 300

  const microPrice = computeMicroPrice(bid, ask, bidDepth, askDepth)
  const midPrice = (bid + ask) / 2
  assert.ok(microPrice < midPrice)
})

test("computeMicroPrice: zero depth returns mid", () => {
  const microPrice = computeMicroPrice(0.49, 0.51, 0, 0)
  assert.equal(microPrice, 0.5)
})

test("computeBookMetrics: basic functionality", () => {
  const book: BookState = {
    yesBid: 0.49,
    yesAsk: 0.51,
    noBid: 0.49,
    noAsk: 0.51,
    yesBidDepth: 100,
    yesAskDepth: 100,
  }

  const metrics = computeBookMetrics(book)

  assert.equal(metrics.imbalanceL1, 0)
  assert.ok(metrics.microPrice > 0.49 && metrics.microPrice < 0.51)
  assert.equal(metrics.microPriceDev, Math.abs(metrics.microPrice - 0.5))
})

test("computeBookMetrics: imbalance with depth levels", () => {
  const levels: DepthLevel[] = [
    { price: 0.49, size: 100 },
    { price: 0.48, size: 150 },
    { price: 0.47, size: 200 },
  ]

  const book: BookState = {
    yesBid: 0.49,
    yesAsk: 0.51,
    noBid: 0.49,
    noAsk: 0.51,
    yesBidLevels: levels,
    yesAskLevels: levels,
  }

  const metrics = computeBookMetrics(book)
  assert.ok(typeof metrics.imbalanceL1 === "number")
  assert.ok(typeof metrics.imbalanceL5 === "number")
  assert.ok(typeof metrics.imbalanceL10 === "number")
})

test("computeTradeMetrics: empty trades", () => {
  const result = computeTradeMetrics([], 5000)
  assert.equal(result.largeTradeCount, 0)
  assert.equal(result.avgTradeSize, 0)
  assert.equal(result.tradeFrequency, 0)
})

test("computeTradeMetrics: normal trades", () => {
  const trades: MarketEvent[] = [
    {
      eventId: "1",
      tsExchange: Date.now(),
      tsLocal: Date.now(),
      marketId: "m1",
      type: "trade_print",
      payload: { volume: 10, side: "buy" },
    },
    {
      eventId: "2",
      tsExchange: Date.now(),
      tsLocal: Date.now(),
      marketId: "m1",
      type: "trade_print",
      payload: { volume: 15, side: "sell" },
    },
  ]

  const result = computeTradeMetrics(trades, 5000)
  assert.equal(result.avgTradeSize, 12.5)
  assert.ok(result.tradeFrequency > 0)
})

test("computeTradeMetrics: large trade detection", () => {
  const trades: MarketEvent[] = [
    {
      eventId: "1",
      tsExchange: Date.now(),
      tsLocal: Date.now(),
      marketId: "m1",
      type: "trade_print",
      payload: { volume: 10, side: "buy" },
    },
    {
      eventId: "2",
      tsExchange: Date.now(),
      tsLocal: Date.now(),
      marketId: "m1",
      type: "trade_print",
      payload: { volume: 10, side: "sell" },
    },
    {
      eventId: "3",
      tsExchange: Date.now(),
      tsLocal: Date.now(),
      marketId: "m1",
      type: "trade_print",
      payload: { volume: 100, side: "buy" },
    },
  ]

  const result = computeTradeMetrics(trades, 5000, 2.0)
  assert.equal(result.largeTradeCount, 1)
  assert.equal(result.largeTradeVolume, 100)
  assert.equal(result.largeTradeDirection, "buy")
})

test("isSparseTrading: correct detection", () => {
  assert.equal(isSparseTrading(2, 5), true)
  assert.equal(isSparseTrading(10, 5), false)
})

test("detectMicrostructureOpportunity: returns null for weak signals", () => {
  const bookMetrics = {
    imbalanceL1: 0.1,
    imbalanceL5: 0.1,
    imbalanceL10: 0.1,
    microPrice: 0.5,
    microPriceDev: 0.001,
    queueDepthBid: 100,
    queueDepthAsk: 100,
    queueConsumptionRate: 0,
  }

  const tradeMetrics = {
    largeTradeCount: 0,
    largeTradeVolume: 0,
    largeTradeDirection: "neutral" as const,
    tradeFrequency: 10,
    avgTradeSize: 10,
  }

  const result = detectMicrostructureOpportunity(bookMetrics, tradeMetrics)
  assert.equal(result, null)
})

test("detectMicrostructureOpportunity: detects strong imbalance", () => {
  const bookMetrics = {
    imbalanceL1: 0.7,
    imbalanceL5: 0.6,
    imbalanceL10: 0.5,
    microPrice: 0.51,
    microPriceDev: 0.02,
    queueDepthBid: 200,
    queueDepthAsk: 100,
    queueConsumptionRate: 0.5,
  }

  const tradeMetrics = {
    largeTradeCount: 2,
    largeTradeVolume: 100,
    largeTradeDirection: "buy" as const,
    tradeFrequency: 15,
    avgTradeSize: 20,
  }

  const result = detectMicrostructureOpportunity(bookMetrics, tradeMetrics)
  assert.ok(result !== null)
  assert.equal(result?.signals.imbalance, true)
  assert.equal(result?.signals.microPriceDev, true)
  assert.equal(result?.signals.largeTrade, true)
  assert.equal(result?.direction, "buy")
  assert.ok(result?.combinedScore > 0)
})
