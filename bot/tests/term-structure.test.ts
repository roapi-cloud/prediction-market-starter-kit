import test from "node:test"
import assert from "node:assert/strict"
import {
  identifyTermMarkets,
  computeTermSpread,
  computeTheoreticalSpread,
  generateTermOpportunity,
  selectTermPair,
  validateTermConfig,
  DEFAULT_TERM_SPREAD_THRESHOLD,
  DEFAULT_MAX_HOLDING_BEFORE_EXPIRY_MS,
  DEFAULT_TIME_VALUE_DECAY_RATE,
} from "../signal/term-structure"
import type {
  MarketInfo,
  TermStructureConfig,
  TermSpreadSnapshot,
} from "../contracts/types"

test("identifyTermMarkets returns null for single market", () => {
  const markets: MarketInfo[] = [
    { marketId: "m1", eventId: "e1", expiryTs: Date.now() / 1000 + 86400 },
  ]
  const result = identifyTermMarkets("e1", markets)
  assert.equal(result, null)
})

test("identifyTermMarkets returns config for multiple markets", () => {
  const now = Date.now() / 1000
  const markets: MarketInfo[] = [
    { marketId: "m1", eventId: "e1", expiryTs: now + 86400 },
    { marketId: "m2", eventId: "e1", expiryTs: now + 86400 * 7 },
  ]
  const result = identifyTermMarkets("e1", markets)
  assert.ok(result)
  assert.equal(result?.eventId, "e1")
  assert.equal(result?.markets.length, 2)
  assert.equal(result?.markets[0].marketId, "m1")
  assert.equal(result?.markets[1].marketId, "m2")
})

test("identifyTermMarkets filters by eventId", () => {
  const now = Date.now() / 1000
  const markets: MarketInfo[] = [
    { marketId: "m1", eventId: "e1", expiryTs: now + 86400 },
    { marketId: "m2", eventId: "e2", expiryTs: now + 86400 * 7 },
  ]
  const result = identifyTermMarkets("e1", markets)
  assert.equal(result, null)
})

test("identifyTermMarkets returns null when all markets have same expiry", () => {
  const now = Date.now() / 1000
  const markets: MarketInfo[] = [
    { marketId: "m1", eventId: "e1", expiryTs: now + 86400 },
    { marketId: "m2", eventId: "e1", expiryTs: now + 86400 },
  ]
  const result = identifyTermMarkets("e1", markets)
  assert.equal(result, null)
})

test("identifyTermMarkets sorts markets by expiry", () => {
  const now = Date.now() / 1000
  const markets: MarketInfo[] = [
    { marketId: "m3", eventId: "e1", expiryTs: now + 86400 * 30 },
    { marketId: "m1", eventId: "e1", expiryTs: now + 86400 },
    { marketId: "m2", eventId: "e1", expiryTs: now + 86400 * 7 },
  ]
  const result = identifyTermMarkets("e1", markets)
  assert.ok(result)
  assert.equal(result?.markets[0].marketId, "m1")
  assert.equal(result?.markets[1].marketId, "m2")
  assert.equal(result?.markets[2].marketId, "m3")
})

test("computeTheoreticalSpread calculates correct spread", () => {
  const shortPrice = 0.6
  const shortExpiryMs = 1000 * 60 * 60 * 24
  const longExpiryMs = 1000 * 60 * 60 * 24 * 8
  const decayRate = 0.001

  const spread = computeTheoreticalSpread(
    shortPrice,
    shortExpiryMs,
    longExpiryMs,
    decayRate
  )
  assert.ok(spread > 0)
  assert.ok(spread < 1 - shortPrice)
})

test("computeTermSpread returns null for missing prices", () => {
  const now = Date.now()
  const config: TermStructureConfig = {
    eventId: "e1",
    markets: [
      { marketId: "m1", expiryTs: now / 1000 + 86400 },
      { marketId: "m2", expiryTs: now / 1000 + 86400 * 7 },
    ],
    termSpreadThreshold: 0.05,
    maxHoldingBeforeExpiryMs: 60000,
    timeValueDecayRate: 0.001,
  }

  const prices = new Map<string, number>()
  prices.set("m1", 0.5)

  const result = computeTermSpread(config, prices, now)
  assert.equal(result, null)
})

test("computeTermSpread calculates correct spread values", () => {
  const now = Date.now()
  const config: TermStructureConfig = {
    eventId: "e1",
    markets: [
      { marketId: "m1", expiryTs: now / 1000 + 86400 },
      { marketId: "m2", expiryTs: now / 1000 + 86400 * 7 },
    ],
    termSpreadThreshold: 0.05,
    maxHoldingBeforeExpiryMs: 60000,
    timeValueDecayRate: 0.001,
  }

  const prices = new Map<string, number>()
  prices.set("m1", 0.55)
  prices.set("m2", 0.5)

  const result = computeTermSpread(config, prices, now)
  assert.ok(result)
  assert.equal(result?.eventId, "e1")
  assert.ok(Math.abs(result?.shortTermPrice - 0.55) < 0.001)
  assert.ok(Math.abs(result?.longTermPrice - 0.5) < 0.001)
  assert.ok(Math.abs(result?.termSpread - 0.05) < 0.001)
  assert.ok(result?.shortExpiryMs > 0)
  assert.ok(result?.longExpiryMs > result?.shortExpiryMs)
})

test("computeTermSpread returns null for expired markets", () => {
  const now = Date.now()
  const config: TermStructureConfig = {
    eventId: "e1",
    markets: [
      { marketId: "m1", expiryTs: now / 1000 - 100 },
      { marketId: "m2", expiryTs: now / 1000 + 86400 },
    ],
    termSpreadThreshold: 0.05,
    maxHoldingBeforeExpiryMs: 60000,
    timeValueDecayRate: 0.001,
  }

  const prices = new Map<string, number>()
  prices.set("m1", 0.5)
  prices.set("m2", 0.5)

  const result = computeTermSpread(config, prices, now)
  assert.equal(result, null)
})

test("generateTermOpportunity returns null for small deviation", () => {
  const now = Date.now()
  const spread: TermSpreadSnapshot = {
    eventId: "e1",
    ts: now,
    shortTermPrice: 0.51,
    longTermPrice: 0.5,
    termSpread: 0.01,
    theoreticalSpread: 0.02,
    spreadDeviation: -0.01,
    shortExpiryMs: 86400000,
    longExpiryMs: 86400000 * 7,
  }

  const config: TermStructureConfig = {
    eventId: "e1",
    markets: [
      { marketId: "m1", expiryTs: now / 1000 + 86400 },
      { marketId: "m2", expiryTs: now / 1000 + 86400 * 7 },
    ],
    termSpreadThreshold: 0.05,
    maxHoldingBeforeExpiryMs: 60000,
    timeValueDecayRate: 0.001,
  }

  const result = generateTermOpportunity(spread, config)
  assert.equal(result, null)
})

test("generateTermOpportunity generates long_short signal when short underpriced", () => {
  const now = Date.now()
  const spread: TermSpreadSnapshot = {
    eventId: "e1",
    ts: now,
    shortTermPrice: 0.5,
    longTermPrice: 0.55,
    termSpread: -0.05,
    theoreticalSpread: 0.02,
    spreadDeviation: -0.07,
    shortExpiryMs: 86400000,
    longExpiryMs: 86400000 * 7,
  }

  const config: TermStructureConfig = {
    eventId: "e1",
    markets: [
      { marketId: "m1", expiryTs: now / 1000 + 86400 },
      { marketId: "m2", expiryTs: now / 1000 + 86400 * 7 },
    ],
    termSpreadThreshold: 0.05,
    maxHoldingBeforeExpiryMs: 60000,
    timeValueDecayRate: 0.001,
  }

  const result = generateTermOpportunity(spread, config)
  assert.ok(result)
  assert.equal(result?.direction, "long_short")
  assert.equal(result?.shortMarketId, "m1")
  assert.equal(result?.longMarketId, "m2")
  assert.ok(result?.evBps > 0)
  assert.ok(result?.confidence > 0)
})

test("generateTermOpportunity generates short_short signal when short overpriced", () => {
  const now = Date.now()
  const spread: TermSpreadSnapshot = {
    eventId: "e1",
    ts: now,
    shortTermPrice: 0.6,
    longTermPrice: 0.5,
    termSpread: 0.1,
    theoreticalSpread: 0.02,
    spreadDeviation: 0.08,
    shortExpiryMs: 86400000,
    longExpiryMs: 86400000 * 7,
  }

  const config: TermStructureConfig = {
    eventId: "e1",
    markets: [
      { marketId: "m1", expiryTs: now / 1000 + 86400 },
      { marketId: "m2", expiryTs: now / 1000 + 86400 * 7 },
    ],
    termSpreadThreshold: 0.05,
    maxHoldingBeforeExpiryMs: 60000,
    timeValueDecayRate: 0.001,
  }

  const result = generateTermOpportunity(spread, config)
  assert.ok(result)
  assert.equal(result?.direction, "short_short")
  assert.ok(result?.evBps > 0)
})

test("generateTermOpportunity returns null for expiring short contract", () => {
  const now = Date.now()
  const spread: TermSpreadSnapshot = {
    eventId: "e1",
    ts: now,
    shortTermPrice: 0.5,
    longTermPrice: 0.55,
    termSpread: -0.05,
    theoreticalSpread: 0.02,
    spreadDeviation: -0.07,
    shortExpiryMs: 30000,
    longExpiryMs: 86400000 * 7,
  }

  const config: TermStructureConfig = {
    eventId: "e1",
    markets: [
      { marketId: "m1", expiryTs: now / 1000 + 30 },
      { marketId: "m2", expiryTs: now / 1000 + 86400 * 7 },
    ],
    termSpreadThreshold: 0.05,
    maxHoldingBeforeExpiryMs: 60000,
    timeValueDecayRate: 0.001,
  }

  const result = generateTermOpportunity(spread, config)
  assert.equal(result, null)
})

test("selectTermPair returns null for insufficient markets", () => {
  const config: TermStructureConfig = {
    eventId: "e1",
    markets: [{ marketId: "m1", expiryTs: Date.now() / 1000 + 86400 }],
    termSpreadThreshold: 0.05,
    maxHoldingBeforeExpiryMs: 60000,
    timeValueDecayRate: 0.001,
  }

  const result = selectTermPair(config)
  assert.equal(result, null)
})

test("selectTermPair returns short and long markets", () => {
  const now = Date.now() / 1000
  const config: TermStructureConfig = {
    eventId: "e1",
    markets: [
      { marketId: "m1", expiryTs: now + 86400 },
      { marketId: "m2", expiryTs: now + 86400 * 7 },
    ],
    termSpreadThreshold: 0.05,
    maxHoldingBeforeExpiryMs: 60000,
    timeValueDecayRate: 0.001,
  }

  const result = selectTermPair(config)
  assert.ok(result)
  assert.equal(result?.short.marketId, "m1")
  assert.equal(result?.long.marketId, "m2")
})

test("validateTermConfig validates required fields", () => {
  const validConfig: TermStructureConfig = {
    eventId: "e1",
    markets: [
      { marketId: "m1", expiryTs: Date.now() / 1000 + 86400 },
      { marketId: "m2", expiryTs: Date.now() / 1000 + 86400 * 7 },
    ],
    termSpreadThreshold: 0.05,
    maxHoldingBeforeExpiryMs: 60000,
    timeValueDecayRate: 0.001,
  }
  assert.equal(validateTermConfig(validConfig), true)

  const noEventId: TermStructureConfig = { ...validConfig, eventId: "" }
  assert.equal(validateTermConfig(noEventId), false)

  const singleMarket: TermStructureConfig = {
    ...validConfig,
    markets: [{ marketId: "m1", expiryTs: Date.now() / 1000 + 86400 }],
  }
  assert.equal(validateTermConfig(singleMarket), false)

  const zeroThreshold: TermStructureConfig = {
    ...validConfig,
    termSpreadThreshold: 0,
  }
  assert.equal(validateTermConfig(zeroThreshold), false)

  const duplicateMarkets: TermStructureConfig = {
    ...validConfig,
    markets: [
      { marketId: "m1", expiryTs: Date.now() / 1000 + 86400 },
      { marketId: "m1", expiryTs: Date.now() / 1000 + 86400 * 7 },
    ],
  }
  assert.equal(validateTermConfig(duplicateMarkets), false)
})
