import type { Market } from "@/lib/gamma"

export type ParsePriceResult = {
  yesPrice: number
  noPrice: number
  success: boolean
  error?: string
}

export function parseYesPrice(market: Market): number {
  try {
    const raw = market.outcomePrices || market.outcome_prices
    if (!raw) {
      console.warn(`[prices] Missing outcomePrices for market`)
      return 0
    }
    const prices = JSON.parse(raw) as string[]
    if (!prices[0]) {
      console.warn(`[prices] Empty prices array for market`)
      return 0
    }
    return Number(prices[0]) || 0
  } catch (error) {
    console.error(
      `[prices] Failed to parse yes price:`,
      error instanceof Error ? error.message : error
    )
    return 0
  }
}

export function parsePrices(market: Market): [number, number] {
  const result = parsePricesWithDetails(market)
  return [result.yesPrice, result.noPrice]
}

export function parsePricesWithDetails(market: Market): ParsePriceResult {
  try {
    const raw = market.outcomePrices || market.outcome_prices
    if (!raw) {
      return {
        yesPrice: 0,
        noPrice: 0,
        success: false,
        error: "Missing outcomePrices field",
      }
    }
    const prices = JSON.parse(raw) as string[]
    if (!prices || prices.length < 2) {
      return {
        yesPrice: 0,
        noPrice: 0,
        success: false,
        error: `Invalid prices array: expected 2 elements, got ${prices?.length ?? 0}`,
      }
    }
    const yesPrice = Number(prices[0]) || 0
    const noPrice = Number(prices[1]) || 0
    return { yesPrice, noPrice, success: true }
  } catch (error) {
    return {
      yesPrice: 0,
      noPrice: 0,
      success: false,
      error: error instanceof Error ? error.message : "Unknown parse error",
    }
  }
}

export function formatOdds(price: number): string {
  const pct = Math.round(price * 100)
  if (pct < 1 && price > 0) return "<1%"
  return `${pct}%`
}

export function formatVolume(vol: number): string {
  if (vol >= 1_000_000_000) return `$${(vol / 1_000_000_000).toFixed(1)}B`
  if (vol >= 1_000_000) return `$${(vol / 1_000_000).toFixed(0)}M`
  if (vol >= 1_000) return `$${(vol / 1_000).toFixed(0)}K`
  return `$${vol.toFixed(0)}`
}
