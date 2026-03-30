import type { TermSpreadSnapshot } from "../contracts/types"

export type TermHistoryEntry = {
  ts: number
  eventId: string
  shortMarketId: string
  longMarketId: string
  shortTermPrice: number
  longTermPrice: number
  termSpread: number
  theoreticalSpread: number
  spreadDeviation: number
}

export type TermHistoryStats = {
  eventId: string
  count: number
  avgSpread: number
  stdSpread: number
  avgDeviation: number
  maxDeviation: number
  minDeviation: number
  lastTs: number
}

const MAX_HISTORY_PER_EVENT = 10000
const DEFAULT_RETENTION_MS = 86400000

const TERM_HISTORY: Map<string, TermHistoryEntry[]> = new Map()

export function recordTermSpread(
  spread: TermSpreadSnapshot,
  config: { shortMarketId: string; longMarketId: string }
): void {
  const { eventId, ts } = spread

  if (!TERM_HISTORY.has(eventId)) {
    TERM_HISTORY.set(eventId, [])
  }

  const history = TERM_HISTORY.get(eventId)!

  const entry: TermHistoryEntry = {
    ts,
    eventId,
    shortMarketId: config.shortMarketId,
    longMarketId: config.longMarketId,
    shortTermPrice: spread.shortTermPrice,
    longTermPrice: spread.longTermPrice,
    termSpread: spread.termSpread,
    theoreticalSpread: spread.theoreticalSpread,
    spreadDeviation: spread.spreadDeviation,
  }

  history.push(entry)

  if (history.length > MAX_HISTORY_PER_EVENT) {
    const excess = history.length - MAX_HISTORY_PER_EVENT
    history.splice(0, excess)
  }
}

export function getTermHistory(eventId: string): TermHistoryEntry[] {
  return TERM_HISTORY.get(eventId) ?? []
}

export function getRecentTermHistory(
  eventId: string,
  lookbackMs: number
): TermHistoryEntry[] {
  const history = TERM_HISTORY.get(eventId)
  if (!history) return []

  const cutoff = Date.now() - lookbackMs
  return history.filter((entry) => entry.ts >= cutoff)
}

export function computeTermHistoryStats(
  eventId: string,
  lookbackMs?: number
): TermHistoryStats | null {
  const history = lookbackMs
    ? getRecentTermHistory(eventId, lookbackMs)
    : getTermHistory(eventId)

  if (history.length === 0) return null

  const spreads = history.map((h) => h.termSpread)
  const deviations = history.map((h) => h.spreadDeviation)

  const avgSpread = spreads.reduce((a, b) => a + b, 0) / spreads.length
  const avgDeviation = deviations.reduce((a, b) => a + b, 0) / deviations.length

  const variance =
    spreads.reduce((sum, s) => sum + Math.pow(s - avgSpread, 2), 0) /
    spreads.length
  const stdSpread = Math.sqrt(variance)

  return {
    eventId,
    count: history.length,
    avgSpread,
    stdSpread,
    avgDeviation,
    maxDeviation: Math.max(...deviations),
    minDeviation: Math.min(...deviations),
    lastTs: history[history.length - 1].ts,
  }
}

export function pruneOldHistory(
  retentionMs: number = DEFAULT_RETENTION_MS
): number {
  const cutoff = Date.now() - retentionMs
  let pruned = 0

  TERM_HISTORY.forEach((history, eventId) => {
    const originalLength = history.length
    const filtered = history.filter((entry) => entry.ts >= cutoff)

    if (filtered.length === 0) {
      TERM_HISTORY.delete(eventId)
    } else {
      TERM_HISTORY.set(eventId, filtered)
    }

    pruned += originalLength - filtered.length
  })

  return pruned
}

export function clearTermHistory(eventId?: string): void {
  if (eventId) {
    TERM_HISTORY.delete(eventId)
  } else {
    TERM_HISTORY.clear()
  }
}

export function getAllEventIds(): string[] {
  return Array.from(TERM_HISTORY.keys())
}

export function getTotalEntryCount(): number {
  let count = 0
  TERM_HISTORY.forEach((history) => {
    count += history.length
  })
  return count
}

export function exportTermHistory(eventId: string): string {
  const history = getTermHistory(eventId)
  return JSON.stringify(history, null, 2)
}

export function importTermHistory(eventId: string, data: string): number {
  try {
    const entries = JSON.parse(data) as TermHistoryEntry[]
    if (!Array.isArray(entries)) return 0

    const validEntries = entries.filter(
      (e) => e.ts && e.eventId === eventId && typeof e.termSpread === "number"
    )

    TERM_HISTORY.set(eventId, validEntries)
    return validEntries.length
  } catch {
    return 0
  }
}
