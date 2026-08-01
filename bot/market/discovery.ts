import { getEvents, type Event, type Market } from "@/lib/gamma"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import type { MarketInfo, StatArbConfig, TermStructureConfig } from "../contracts/types"
import { createChildLogger } from "../lib/logger"

const log = createChildLogger("market-discovery")

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Market discovery module - fetches events from Gamma API
 * and identifies potential pairs for stat_arb and term_structure strategies.
 */

export type EventMarketGroup = {
  eventId: string
  eventTitle: string
  markets: DiscoveredMarket[]
}

export type DiscoveredMarket = {
  marketId: string
  question: string
  yesPrice: number
  noPrice: number
  volume24hr: number
  totalVolume: number
  expiryTs: number
  slug: string
}

export type DiscoveryResult = {
  groups: EventMarketGroup[]
  statArbCandidates: StatArbCandidate[]
  termStructureCandidates: TermStructureCandidate[]
}

export type StatArbCandidate = {
  eventId: string
  marketA: string
  marketB: string
  marketAQuestion: string
  marketBQuestion: string
  correlationType: "parallel" | "inverse" | "unknown"
}

export type TermStructureCandidate = {
  eventId: string
  markets: Array<{ marketId: string; expiryTs: number }>
  expiryDiffMs: number
}

const DEFAULT_STAT_ARB_CONFIG = {
  lookbackWindow: 50,
  entryZThreshold: 2,
  exitZThreshold: 0.5,
  maxHoldingMs: 3600000,
  stopLossZThreshold: 4,
}

/**
 * Fetch events from Gamma API and discover market groups
 */
export async function discoverMarkets(limit = 50): Promise<DiscoveryResult> {
  log.info({ limit }, "Starting market discovery")

  let events: Event[]
  try {
    events = await getEvents({
      active: true,
      closed: false,
      archived: false,
      limit,
    })
  } catch (err) {
    log.warn({ error: err }, "Gamma API failed, falling back to fixture data")
    // Fallback to fixture data
    try {
      const snapshot = await readFile(
        resolve(__dirname, "../fixtures/gamma-events.snapshot.json"),
        "utf8"
      )
      events = JSON.parse(snapshot)
    } catch (fixtureErr) {
      log.error({ error: fixtureErr }, "Failed to load fixture data")
      throw err
    }
  }

  log.info({ eventCount: events.length }, "Fetched events")

  const groups: EventMarketGroup[] = []
  const statArbCandidates: StatArbCandidate[] = []
  const termStructureCandidates: TermStructureCandidate[] = []

  for (const event of events) {
    if (!event.markets || event.markets.length === 0) continue

    const markets: DiscoveredMarket[] = []

    for (const market of event.markets) {
      const discovered = parseMarket(market)
      if (discovered) {
        markets.push(discovered)
      }
    }

    if (markets.length === 0) continue

    const group: EventMarketGroup = {
      eventId: event.id,
      eventTitle: event.title,
      markets,
    }
    groups.push(group)

    // Find stat_arb candidates (events with multiple markets)
    if (markets.length >= 2) {
      const candidates = findStatArbCandidates(group)
      statArbCandidates.push(...candidates)
    }

    // Find term_structure candidates (markets with different expiries)
    const termCandidates = findTermStructureCandidates(group)
    if (termCandidates) {
      termStructureCandidates.push(termCandidates)
    }
  }

  log.info(
    {
      groups: groups.length,
      statArbPairs: statArbCandidates.length,
      termStructureEvents: termStructureCandidates.length,
    },
    "Discovery complete"
  )

  return {
    groups,
    statArbCandidates,
    termStructureCandidates,
  }
}

/**
 * Parse a market from Gamma API response
 */
function parseMarket(market: Market): DiscoveredMarket | null {
  try {
    // Parse prices from outcomePrices string
    let yesPrice = 0.5
    let noPrice = 0.5

    const pricesStr = market.outcomePrices || market.outcome_prices
    if (pricesStr) {
      const prices = JSON.parse(pricesStr)
      yesPrice = parseFloat(prices[0]) || 0.5
      noPrice = parseFloat(prices[1]) || 0.5
    }

    // Parse expiry from end_date
    let expiryTs = 0
    if (market.end_date) {
      expiryTs = Math.floor(new Date(market.end_date).getTime() / 1000)
    }

    return {
      marketId: market.id,
      question: market.question || "",
      yesPrice,
      noPrice,
      volume24hr: market.volume_24hr || 0,
      totalVolume: market.volume || 0,
      expiryTs,
      slug: market.slug || "",
    }
  } catch (err) {
    log.warn({ marketId: market.id, error: err }, "Failed to parse market")
    return null
  }
}

/**
 * Find stat_arb candidates within an event group
 */
function findStatArbCandidates(group: EventMarketGroup): StatArbCandidate[] {
  const candidates: StatArbCandidate[] = []
  const markets = group.markets

  // Pair each market with every other market in the same event
  for (let i = 0; i < markets.length; i++) {
    for (let j = i + 1; j < markets.length; j++) {
      const marketA = markets[i]
      const marketB = markets[j]

      // Determine correlation type based on market questions
      const correlationType = inferCorrelationType(
        marketA.question,
        marketB.question,
        group.eventTitle
      )

      candidates.push({
        eventId: group.eventId,
        marketA: marketA.marketId,
        marketB: marketB.marketId,
        marketAQuestion: marketA.question,
        marketBQuestion: marketB.question,
        correlationType,
      })
    }
  }

  return candidates
}

/**
 * Find term_structure candidates within an event group
 * (markets with different expiry times)
 */
function findTermStructureCandidates(
  group: EventMarketGroup
): TermStructureCandidate | null {
  const marketsWithExpiry = group.markets.filter((m) => m.expiryTs > 0)

  if (marketsWithExpiry.length < 2) return null

  // Sort by expiry
  const sorted = [...marketsWithExpiry].sort((a, b) => a.expiryTs - b.expiryTs)

  // Check if there's meaningful expiry difference (at least 1 hour)
  const earliest = sorted[0].expiryTs
  const latest = sorted[sorted.length - 1].expiryTs
  const expiryDiffMs = (latest - earliest) * 1000

  if (expiryDiffMs < 3600000) return null // Less than 1 hour difference

  return {
    eventId: group.eventId,
    markets: sorted.map((m) => ({
      marketId: m.marketId,
      expiryTs: m.expiryTs,
    })),
    expiryDiffMs,
  }
}

/**
 * Infer correlation type between two markets based on their questions
 */
function inferCorrelationType(
  questionA: string,
  questionB: string,
  eventTitle: string
): "parallel" | "inverse" | "unknown" {
  const qA = questionA.toLowerCase()
  const qB = questionB.toLowerCase()
  const title = eventTitle.toLowerCase()

  // World Cup winner markets - mutually exclusive (inverse correlation)
  if (
    title.includes("world cup") ||
    title.includes("winner") ||
    (qA.includes("brazil") && qB.includes("france")) ||
    (qA.includes("france") && qB.includes("argentina"))
  ) {
    return "inverse"
  }

  // S&P targets - complementary (parallel correlation)
  // Higher targets are correlated with lower targets
  if (title.includes("s&p") || title.includes("sp500") || title.includes("index")) {
    // Markets asking about different price levels
    if (
      (qA.includes("above") && qB.includes("above")) ||
      (qA.includes("above") && qB.includes("below"))
    ) {
      return "parallel"
    }
  }

  // Election markets - may be inverse (party control)
  if (title.includes("election") || title.includes("senate") || title.includes("house")) {
    // Democrat vs Republican control - inverse
    if (
      (qA.includes("dem") && qB.includes("gop")) ||
      (qA.includes("dem") && qB.includes("republican"))
    ) {
      return "inverse"
    }
  }

  // Tech layoffs - parallel correlation
  if (title.includes("layoff")) {
    return "parallel"
  }

  // Crypto prices - parallel correlation
  if (title.includes("btc") || title.includes("eth") || title.includes("sol")) {
    return "parallel"
  }

  return "unknown"
}

/**
 * Convert discovery result to StatArbConfig array
 */
export function buildStatArbConfigs(
  candidates: StatArbCandidate[]
): StatArbConfig[] {
  return candidates.map((c, idx) => ({
    pairId: `${c.eventId}-${c.marketA}-${c.marketB}`,
    marketA: c.marketA,
    marketB: c.marketB,
    hedgeRatio: c.correlationType === "inverse" ? -1 : 1,
    ...DEFAULT_STAT_ARB_CONFIG,
  }))
}

/**
 * Convert discovery result to TermStructureConfig array
 */
export function buildTermStructureConfigs(
  candidates: TermStructureCandidate[]
): TermStructureConfig[] {
  return candidates.map((c) => ({
    eventId: c.eventId,
    markets: c.markets,
    termSpreadThreshold: 0.05,
    maxHoldingBeforeExpiryMs: 60000,
    timeValueDecayRate: 0.001,
  }))
}

/**
 * Get all discovered market info as MarketInfo array
 */
export function getAllMarketInfo(groups: EventMarketGroup[]): MarketInfo[] {
  const infos: MarketInfo[] = []

  for (const group of groups) {
    for (const market of group.markets) {
      infos.push({
        marketId: market.marketId,
        eventId: group.eventId,
        expiryTs: market.expiryTs,
        question: market.question,
      })
    }
  }

  return infos
}