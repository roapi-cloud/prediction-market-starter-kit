/**
 * Realtime Bot Daemon — second-level scanning with exit logic.
 *
 * Features:
 *   1. WebSocket or REST polling (configurable)
 *   2. Depth analysis + split orders
 *   3. Exit when spread narrows to lock profit
 *
 * Usage:
 *   pnpm bot:realtime
 */

import { createDataSource, type IDataSource } from "./integration"
import { RealtimeEngine, type RealtimeResult } from "./core/realtime-engine"
import { PaperPortfolio } from "./paper/portfolio"
import { generateWallet } from "./paper/wallet"
import { saveSession, loadSession } from "./paper/persistence"
import { loadConfig, resetConfigCache, type BotConfig } from "./config"
import { autotune } from "./config/autotune"
import type { SyntheticTick } from "./ingest/adapter"

const TUNE_INTERVAL = 60 * 60 * 1000

function ts(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19)
}

function persistState(
  portfolio: PaperPortfolio,
  wallet: { address: string; safeAddress: string; privateKey: string },
  config: BotConfig,
  cycleCount: number,
  tradeCount: number,
  exitCount: number
): void {
  const filledOrders = portfolio.orders.filter((o) => o.status !== "REJECTED")
  saveSession({
    wallet,
    updatedAt: new Date().toISOString(),
    portfolio: {
      initialEquity: config.portfolio.initialEquity,
      cash: portfolio.cashBalance,
      equity: portfolio.equity,
      peakEquity: portfolio.peakEquity,
    },
    positions: Array.from(portfolio.positions.values()),
    orders: portfolio.orders,
    stats: {
      totalTrades: portfolio.orders.length,
      fillRate: filledOrders.length / Math.max(1, portfolio.orders.length),
      totalArbProfit: portfolio.lockedArbProfit,
      totalSlippageCost: portfolio.totalSlippageCost,
      sessionsRun: cycleCount,
    },
  })
}

async function main(): Promise<void> {
  console.log(`[${ts()}] Realtime Bot Daemon starting`)

  let config = loadConfig()
  const dataSourceType = config.data.dataSource.type
  console.log(`  Data source:    ${dataSourceType}`)
  console.log(`  Auto-tune:      every 1 hour`)
  console.log(`  Press Ctrl+C to stop\n`)

  const session = loadSession()
  const wallet = { address: "", safeAddress: "", privateKey: "" }
  const portfolio = new PaperPortfolio(config.portfolio.initialEquity)

  if (session) {
    Object.assign(wallet, session.wallet)
    portfolio.cashBalance = session.portfolio.cash
    portfolio.peakEquity = session.portfolio.peakEquity
    for (const pos of session.positions)
      portfolio.positions.set(`${pos.marketId}:${pos.side}`, { ...pos })
    for (const order of session.orders) portfolio.orders.push(order)
    console.log(
      `  Restored: ${wallet.address} (${portfolio.positions.size} positions)`
    )
  } else {
    const w = generateWallet()
    wallet.address = w.address
    wallet.safeAddress = w.safeAddress
    wallet.privateKey = w.privateKey
    console.log(`  New wallet: ${wallet.address}`)
  }

  const dataSource = createDataSource(config.data.dataSource)
  const engine = new RealtimeEngine(portfolio, config)

  let cycleCount = 0
  let tradeCount = 0
  let exitCount = 0
  let lastTuneTime = Date.now()
  let lastPrintTime = Date.now()
  let running = true

  dataSource.start({
    onConnect: () => {
      console.log(`[${ts()}] Data source connected`)
    },
    onDisconnect: () => {
      console.log(`[${ts()}] Data source disconnected`)
    },
    onError: (err) => {
      console.error(`[${ts()}] Data source error:`, err.message)
    },
    onTick: (tick: SyntheticTick) => {
      if (!running) return

      cycleCount += 1
      const result = engine.processTick(tick)
      tradeCount += result.trades
      exitCount += result.exits

      if (Date.now() - lastPrintTime >= 10000) {
        lastPrintTime = Date.now()
        const snap = portfolio.snapshot()
        console.log(
          `[${ts()}] Tick #${cycleCount}: trades=${tradeCount} exits=${exitCount} equity=$${snap.equity.toFixed(2)} arb=$${snap.lockedArbProfit.toFixed(4)} DD=${snap.drawdownPct.toFixed(2)}%`
        )

        if (result.spreadChanges.length > 0) {
          for (const change of result.spreadChanges.slice(0, 3)) {
            console.log(
              `  ${change.marketId}: spread ${change.oldSpread.toFixed(4)} → ${change.newSpread.toFixed(4)}`
            )
          }
        }

        for (const alert of result.alerts) {
          console.log(`  ${alert}`)
        }
      }

      if (cycleCount % 60 === 0) {
        persistState(
          portfolio,
          wallet,
          config,
          cycleCount,
          tradeCount,
          exitCount
        )
      }

      if (Date.now() - lastTuneTime >= TUNE_INTERVAL) {
        lastTuneTime = Date.now()
        console.log(`\n[${ts()}] ── Auto-Tune ──`)
        resetConfigCache()
        const report = autotune()
        if (report.adjustments.length > 0) {
          for (const adj of report.adjustments) {
            console.log(`  ${adj.param}: ${adj.old} → ${adj.new}`)
          }
          resetConfigCache()
          config = loadConfig()
        } else {
          console.log("  No adjustments needed")
        }
      }
    },
  })

  process.on("SIGINT", () => {
    console.log(`\n[${ts()}] Shutting down...`)
    running = false
    dataSource.stop()
    persistState(portfolio, wallet, config, cycleCount, tradeCount, exitCount)
    console.log(
      `[${ts()}] Daemon stopped after ${cycleCount} ticks, ${tradeCount} trades, ${exitCount} exits`
    )
    process.exit(0)
  })

  process.on("SIGTERM", () => {
    console.log(`\n[${ts()}] Shutting down...`)
    running = false
    dataSource.stop()
    persistState(portfolio, wallet, config, cycleCount, tradeCount, exitCount)
    process.exit(0)
  })
}

void main()
