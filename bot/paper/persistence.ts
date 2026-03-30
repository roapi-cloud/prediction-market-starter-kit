import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import type { PaperPosition, PaperOrder, StrategyType } from "./portfolio"

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = resolve(__dirname, "..", "data")
const SESSION_PATH = resolve(DATA_DIR, "session.json")

export type StrategyStats = {
  strategy: StrategyType
  totalTrades: number
  filledTrades: number
  winRate: number
  totalPnl: number
  avgEvBps: number
  maxDrawdown: number
  equityCurve: number[]
}

export type SessionData = {
  wallet: {
    address: string
    safeAddress: string
    privateKey: string
  }
  updatedAt: string
  portfolio: {
    initialEquity: number
    cash: number
    equity: number
    peakEquity: number
  }
  positions: PaperPosition[]
  orders: PaperOrder[]
  stats: {
    totalTrades: number
    fillRate: number
    totalArbProfit: number
    totalSlippageCost: number
    sessionsRun: number
  }
  strategyStats?: StrategyStats[]
}

export function saveSession(data: SessionData): void {
  data.strategyStats = computeStrategyStats(
    data.orders,
    data.portfolio.initialEquity
  )
  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(SESSION_PATH, JSON.stringify(data, null, 2), "utf8")
}

export function computeStrategyStats(
  orders: PaperOrder[],
  initialEquity: number
): StrategyStats[] {
  const strategies: StrategyType[] = [
    "static_arb",
    "stat_arb",
    "microstructure",
    "term_structure",
  ]
  const stats: StrategyStats[] = []

  for (const strategy of strategies) {
    const strategyOrders = orders.filter((o) => o.strategy === strategy)
    const filledOrders = strategyOrders.filter(
      (o) => o.status === "FILLED" || o.status === "PARTIAL"
    )

    let totalPnl = 0
    let equity = initialEquity * 0.25
    const equityCurve: number[] = [equity]
    let peak = equity
    let maxDrawdown = 0

    for (const order of filledOrders) {
      const pnl = order.filledSize * (order.price - 0.5)
      totalPnl += pnl
      equity += pnl
      equityCurve.push(equity)
      if (equity > peak) peak = equity
      const dd = (peak - equity) / peak
      if (dd > maxDrawdown) maxDrawdown = dd
    }

    const winRate =
      filledOrders.length > 0
        ? filledOrders.filter((o) => o.pnl >= 0).length / filledOrders.length
        : 0

    stats.push({
      strategy,
      totalTrades: strategyOrders.length,
      filledTrades: filledOrders.length,
      winRate,
      totalPnl,
      avgEvBps:
        filledOrders.length > 0
          ? ((totalPnl / initialEquity) * 10000) / filledOrders.length
          : 0,
      maxDrawdown,
      equityCurve,
    })
  }

  return stats
}

export function loadSession(): SessionData | null {
  try {
    const raw = readFileSync(SESSION_PATH, "utf8")
    return JSON.parse(raw) as SessionData
  } catch {
    return null
  }
}

export function getSessionPath(): string {
  return SESSION_PATH
}
