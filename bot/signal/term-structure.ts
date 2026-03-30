import type {
  TermStructureConfig,
  TermSpreadSnapshot,
  TermStructureSignal,
  MarketInfo,
} from "../contracts/types"

export const DEFAULT_TERM_SPREAD_THRESHOLD = 0.05
export const DEFAULT_MAX_HOLDING_BEFORE_EXPIRY_MS = 60000
export const DEFAULT_TIME_VALUE_DECAY_RATE = 0.001
export const MIN_EXPIRY_DIFF_MS = 3600000

export function identifyTermMarkets(
  eventId: string,
  markets: MarketInfo[]
): TermStructureConfig | null {
  const eventMarkets = markets.filter(
    (m) => m.eventId === eventId && m.expiryTs > 0
  )

  if (eventMarkets.length < 2) return null

  const sortedMarkets = [...eventMarkets].sort(
    (a, b) => a.expiryTs - b.expiryTs
  )

  const uniqueExpiries = new Set(sortedMarkets.map((m) => m.expiryTs))
  if (uniqueExpiries.size < 2) return null

  return {
    eventId,
    markets: sortedMarkets.map((m) => ({
      marketId: m.marketId,
      expiryTs: m.expiryTs,
    })),
    termSpreadThreshold: DEFAULT_TERM_SPREAD_THRESHOLD,
    maxHoldingBeforeExpiryMs: DEFAULT_MAX_HOLDING_BEFORE_EXPIRY_MS,
    timeValueDecayRate: DEFAULT_TIME_VALUE_DECAY_RATE,
  }
}

export function computeTermSpread(
  config: TermStructureConfig,
  prices: Map<string, number>,
  now: number
): TermSpreadSnapshot | null {
  const sortedMarkets = [...config.markets].sort(
    (a, b) => a.expiryTs - b.expiryTs
  )

  const shortMarket = sortedMarkets[0]
  const longMarket = sortedMarkets[sortedMarkets.length - 1]

  const shortTermPrice = prices.get(shortMarket.marketId)
  const longTermPrice = prices.get(longMarket.marketId)

  if (shortTermPrice === undefined || longTermPrice === undefined) return null

  const shortExpiryMs = shortMarket.expiryTs * 1000 - now
  const longExpiryMs = longMarket.expiryTs * 1000 - now

  if (shortExpiryMs <= 0 || longExpiryMs <= 0) return null

  const termSpread = shortTermPrice - longTermPrice

  const timeDiffMs = longExpiryMs - shortExpiryMs
  const theoreticalSpread = computeTheoreticalSpread(
    shortTermPrice,
    shortExpiryMs,
    longExpiryMs,
    config.timeValueDecayRate
  )

  const spreadDeviation = termSpread - theoreticalSpread

  return {
    eventId: config.eventId,
    ts: now,
    shortTermPrice,
    longTermPrice,
    termSpread,
    theoreticalSpread,
    spreadDeviation,
    shortExpiryMs,
    longExpiryMs,
  }
}

export function computeTheoreticalSpread(
  shortPrice: number,
  shortExpiryMs: number,
  longExpiryMs: number,
  decayRate: number
): number {
  const timeDiffMs = longExpiryMs - shortExpiryMs
  if (timeDiffMs <= 0) return 0

  const timeDiffDays = timeDiffMs / (1000 * 60 * 60 * 24)
  const theoreticalSpread = decayRate * timeDiffDays * shortPrice

  return Math.min(theoreticalSpread, 1 - shortPrice)
}

export function generateTermOpportunity(
  spread: TermSpreadSnapshot,
  config: TermStructureConfig
): TermStructureSignal | null {
  if (Math.abs(spread.spreadDeviation) < config.termSpreadThreshold) return null

  const urgency = computeUrgency(
    spread.shortExpiryMs,
    config.maxHoldingBeforeExpiryMs
  )

  if (spread.shortExpiryMs < config.maxHoldingBeforeExpiryMs) return null

  let direction: "long_short" | "short_short" | "neutral"
  let evBps: number
  let confidence: number

  if (spread.spreadDeviation < 0) {
    direction = "long_short"
    evBps = Math.abs(spread.spreadDeviation) * 10000
    confidence = Math.min(
      1,
      Math.abs(spread.spreadDeviation) / config.termSpreadThreshold
    )
  } else if (spread.spreadDeviation > config.termSpreadThreshold) {
    direction = "short_short"
    evBps = Math.abs(spread.spreadDeviation) * 10000
    confidence = Math.min(
      1,
      Math.abs(spread.spreadDeviation) / config.termSpreadThreshold
    )
  } else {
    return null
  }

  confidence = confidence * (1 - urgency * 0.5)

  const ttlMs = Math.min(
    spread.shortExpiryMs - config.maxHoldingBeforeExpiryMs,
    300000
  )

  return {
    eventId: spread.eventId,
    direction,
    shortMarketId: config.markets[0].marketId,
    longMarketId: config.markets[config.markets.length - 1].marketId,
    termSpreadDev: spread.spreadDeviation,
    evBps,
    confidence,
    urgency,
    ttlMs: Math.max(ttlMs, 1000),
  }
}

function computeUrgency(shortExpiryMs: number, maxHoldingMs: number): number {
  if (shortExpiryMs <= maxHoldingMs) return 1

  const timeBuffer = shortExpiryMs - maxHoldingMs
  const urgencyThreshold = maxHoldingMs * 5

  if (timeBuffer > urgencyThreshold) return 0

  return 1 - timeBuffer / urgencyThreshold
}

export function selectTermPair(
  config: TermStructureConfig
): {
  short: (typeof config.markets)[0]
  long: (typeof config.markets)[0]
} | null {
  const sortedMarkets = [...config.markets].sort(
    (a, b) => a.expiryTs - b.expiryTs
  )

  if (sortedMarkets.length < 2) return null

  const short = sortedMarkets[0]
  const long = sortedMarkets[sortedMarkets.length - 1]

  const expiryDiff = long.expiryTs - short.expiryTs
  if (expiryDiff * 1000 < MIN_EXPIRY_DIFF_MS) return null

  return { short, long }
}

export function validateTermConfig(config: TermStructureConfig): boolean {
  if (!config.eventId) return false
  if (!config.markets || config.markets.length < 2) return false
  if (config.termSpreadThreshold <= 0) return false
  if (config.maxHoldingBeforeExpiryMs <= 0) return false
  if (config.timeValueDecayRate <= 0) return false

  const uniqueMarketIds = new Set(config.markets.map((m) => m.marketId))
  if (uniqueMarketIds.size !== config.markets.length) return false

  return true
}
