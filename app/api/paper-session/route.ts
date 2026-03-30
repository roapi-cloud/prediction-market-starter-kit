import { NextResponse } from "next/server"
import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = resolve(__dirname, "../../../bot/data")
const SESSION_PATH = resolve(DATA_DIR, "session.json")

type StrategyType =
  | "static_arb"
  | "stat_arb"
  | "microstructure"
  | "term_structure"

type StrategyStats = {
  strategy: StrategyType
  totalTrades: number
  filledTrades: number
  winRate: number
  totalPnl: number
  avgEvBps: number
  maxDrawdown: number
  equityCurve: number[]
}

type PaperOrder = {
  id: string
  ts: number
  marketId: string
  side: "YES" | "NO"
  action: "BUY" | "SELL"
  price: number
  size: number
  status: "FILLED" | "PARTIAL" | "REJECTED"
  filledSize: number
  pnl: number
  strategy: StrategyType
}

function computeStrategyStats(
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
    const equity = initialEquity * 0.25
    const equityCurve: number[] = [equity]
    let peak = equity
    let maxDrawdown = 0

    for (const order of filledOrders) {
      const pnl = order.filledSize * (order.price - 0.5)
      totalPnl += pnl
      const newEq = equity + totalPnl
      equityCurve.push(newEq)
      if (newEq > peak) peak = newEq
      const dd = (peak - newEq) / peak
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

export async function GET() {
  try {
    if (!existsSync(SESSION_PATH)) {
      return NextResponse.json({
        exists: false,
        message:
          "No paper trading session found. Run 'pnpm bot:daemon' to start.",
      })
    }

    const raw = readFileSync(SESSION_PATH, "utf8")
    const session = JSON.parse(raw)

    if (!session.strategyStats && session.orders) {
      session.strategyStats = computeStrategyStats(
        session.orders,
        session.portfolio?.initialEquity ?? 10000
      )
    }

    return NextResponse.json({
      exists: true,
      ...session,
    })
  } catch (error) {
    return NextResponse.json(
      {
        exists: false,
        error: "Failed to read session data",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    )
  }
}
