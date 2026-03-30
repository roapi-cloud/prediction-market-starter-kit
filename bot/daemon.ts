/**
 * Bot Daemon — single long-running process with a serial pipeline.
 *
 * Each cycle (every 5 minutes):
 *   1. Fetch latest market data
 *   2. Mark-to-market + alert check
 *   3. Scan arbitrage opportunities
 *   4. Execute paper trades
 *   5. Save session state
 *
 * Auto-tune runs every 12 cycles (~1 hour).
 *
 * Usage:
 *   pnpm bot:daemon          # run in foreground
 *   nohup pnpm bot:daemon &  # run in background
 */

import { createDataSource, type IDataSource } from "./integration"
import { FeatureEngine } from "./features/engine"
import { PaperPortfolio } from "./paper/portfolio"
import { generateWallet } from "./paper/wallet"
import { saveSession, loadSession } from "./paper/persistence"
import { loadConfig, resetConfigCache, type BotConfig } from "./config"
import { autotune } from "./config/autotune"
import { runCycle } from "./core/cycle"

const CYCLE_INTERVAL = 5 * 60 * 1000
const TUNE_EVERY_N_CYCLES = 12

let running = true

function ts(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function persistState(
  portfolio: PaperPortfolio,
  wallet: { address: string; safeAddress: string; privateKey: string },
  config: BotConfig,
  cycleCount: number
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
  console.log(`[${ts()}] Bot Daemon starting`)
  console.log(`  Cycle interval:  ${CYCLE_INTERVAL / 60000}min`)
  console.log(
    `  Auto-tune every: ${TUNE_EVERY_N_CYCLES} cycles (~${TUNE_EVERY_N_CYCLES * 5}min)`
  )
  console.log(`  Press Ctrl+C to stop\n`)

  process.on("SIGINT", () => {
    console.log(`\n[${ts()}] Shutting down...`)
    running = false
  })
  process.on("SIGTERM", () => {
    console.log(`\n[${ts()}] Shutting down...`)
    running = false
  })

  let config = loadConfig()
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
  console.log(`  Data source: ${config.data.dataSource.type}`)

  const featureEngine = new FeatureEngine()
  let cycleCount = 0

  while (running) {
    cycleCount += 1
    console.log(`\n[${ts()}] ── Cycle #${cycleCount} ──`)

    const ticks = await dataSource.fetchOnce()
    const result = runCycle(ticks, portfolio, featureEngine, config)
    const snap = portfolio.snapshot()

    console.log(
      `  Market: ${result.trades} trades, ${result.skips} skips, ${result.blocks} blocks`
    )
    console.log(
      `  Portfolio: equity=$${snap.equity.toFixed(2)} arb=$${snap.lockedArbProfit.toFixed(4)} ` +
        `slip=$${snap.totalSlippageCost.toFixed(4)} DD=${snap.drawdownPct.toFixed(2)}%`
    )
    for (const alert of result.alerts) console.log(`  ${alert}`)

    persistState(portfolio, wallet, config, cycleCount)

    if (cycleCount % TUNE_EVERY_N_CYCLES === 0) {
      console.log(`\n[${ts()}] ── Auto-Tune ──`)
      resetConfigCache()
      const report = autotune()
      if (report.adjustments.length === 0) {
        console.log("  No adjustments needed")
      } else {
        for (const adj of report.adjustments)
          console.log(`  ${adj.param}: ${adj.old} → ${adj.new}`)
      }
      resetConfigCache()
      config = loadConfig()
    }

    if (running) {
      const deadline = Date.now() + CYCLE_INTERVAL
      while (running && Date.now() < deadline) await sleep(1000)
    }
  }

  dataSource.stop()
  console.log(`[${ts()}] Daemon stopped after ${cycleCount} cycles`)
}

void main()
