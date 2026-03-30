import type { TermStructureConfig, MarketInfo } from "../contracts/types"
import {
  DEFAULT_TERM_SPREAD_THRESHOLD,
  DEFAULT_MAX_HOLDING_BEFORE_EXPIRY_MS,
  DEFAULT_TIME_VALUE_DECAY_RATE,
} from "../signal/term-structure"

export type EventMarketMapping = {
  eventId: string
  eventName?: string
  markets: Array<{
    marketId: string
    question?: string
    expiryTs: number
  }>
}

const TERM_EVENT_REGISTRY: Map<string, EventMarketMapping> = new Map()

export function registerTermEvent(mapping: EventMarketMapping): void {
  if (!mapping.eventId || !mapping.markets || mapping.markets.length < 2) {
    throw new Error(
      "Invalid term event mapping: requires eventId and at least 2 markets"
    )
  }

  const sortedMarkets = [...mapping.markets].sort(
    (a, b) => a.expiryTs - b.expiryTs
  )

  TERM_EVENT_REGISTRY.set(mapping.eventId, {
    ...mapping,
    markets: sortedMarkets,
  })
}

export function unregisterTermEvent(eventId: string): boolean {
  return TERM_EVENT_REGISTRY.delete(eventId)
}

export function getTermEventConfig(
  eventId: string
): TermStructureConfig | null {
  const mapping = TERM_EVENT_REGISTRY.get(eventId)
  if (!mapping) return null

  return {
    eventId: mapping.eventId,
    markets: mapping.markets.map((m) => ({
      marketId: m.marketId,
      expiryTs: m.expiryTs,
    })),
    termSpreadThreshold: DEFAULT_TERM_SPREAD_THRESHOLD,
    maxHoldingBeforeExpiryMs: DEFAULT_MAX_HOLDING_BEFORE_EXPIRY_MS,
    timeValueDecayRate: DEFAULT_TIME_VALUE_DECAY_RATE,
  }
}

export function getAllTermEventConfigs(): TermStructureConfig[] {
  const configs: TermStructureConfig[] = []
  TERM_EVENT_REGISTRY.forEach((mapping) => {
    configs.push({
      eventId: mapping.eventId,
      markets: mapping.markets.map((m) => ({
        marketId: m.marketId,
        expiryTs: m.expiryTs,
      })),
      termSpreadThreshold: DEFAULT_TERM_SPREAD_THRESHOLD,
      maxHoldingBeforeExpiryMs: DEFAULT_MAX_HOLDING_BEFORE_EXPIRY_MS,
      timeValueDecayRate: DEFAULT_TIME_VALUE_DECAY_RATE,
    })
  })
  return configs
}

export function createTermConfigFromMarkets(
  eventId: string,
  markets: MarketInfo[],
  options?: {
    termSpreadThreshold?: number
    maxHoldingBeforeExpiryMs?: number
    timeValueDecayRate?: number
  }
): TermStructureConfig {
  const sortedMarkets = [...markets]
    .filter((m) => m.eventId === eventId && m.expiryTs > 0)
    .sort((a, b) => a.expiryTs - b.expiryTs)

  return {
    eventId,
    markets: sortedMarkets.map((m) => ({
      marketId: m.marketId,
      expiryTs: m.expiryTs,
    })),
    termSpreadThreshold:
      options?.termSpreadThreshold ?? DEFAULT_TERM_SPREAD_THRESHOLD,
    maxHoldingBeforeExpiryMs:
      options?.maxHoldingBeforeExpiryMs ?? DEFAULT_MAX_HOLDING_BEFORE_EXPIRY_MS,
    timeValueDecayRate:
      options?.timeValueDecayRate ?? DEFAULT_TIME_VALUE_DECAY_RATE,
  }
}

export function isTermEligible(eventId: string): boolean {
  return TERM_EVENT_REGISTRY.has(eventId)
}

export function getTermEventCount(): number {
  return TERM_EVENT_REGISTRY.size
}

export function clearTermEvents(): void {
  TERM_EVENT_REGISTRY.clear()
}
