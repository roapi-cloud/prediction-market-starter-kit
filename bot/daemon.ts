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
 * Market discovery runs every 6 cycles (~30 minutes).
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
import { runCycle, setStatArbConfigs, setTermStructureConfigs } from "./core/cycle"
import { createChildLogger } from "./lib/logger"
import { CYCLE } from "./config/constants"
import { discoverMarkets, generateStatArbConfigs, generateTermStructureConfigs } from "./market"

let running = true
let consecutiveErrors = 0
const MAX_CONSECUTIVE_ERRORS = 5
const ERROR_BACKOFF_MS = 10000
const DISCOVERY_EVERY_N_CYCLES = 6 // Run discovery every 6 cycles (~30 min)

const log = createChildLogger("daemon")

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
  log.info("Bot Daemon starting")
  log.info(
    { cycleIntervalMin: CYCLE.INTERVAL_MS / 60000 },
    "Cycle interval configured"
  )
  log.info(
    {
      tuneEveryCycles: CYCLE.TUNE_EVERY_N_CYCLES,
      tuneIntervalMin: CYCLE.TUNE_EVERY_N_CYCLES * 5,
    },
    "Auto-tune configured"
  )
  log.info("Press Ctrl+C to stop")

  process.on("SIGINT", () => {
    log.info("Shutting down (SIGINT)...")
    running = false
  })
  process.on("SIGTERM", () => {
    log.info("Shutting down (SIGTERM)...")
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
    for (const order of session.orders)
      portfolio.orders.push({
        ...order,
        strategy: order.strategy ?? "static_arb",
      })
    log.info(
      { address: wallet.address, positions: portfolio.positions.size },
      "Restored session"
    )
  } else {
    const w = generateWallet()
    wallet.address = w.address
    wallet.safeAddress = w.safeAddress
    wallet.privateKey = w.privateKey
    log.info({ address: wallet.address }, "Created new wallet")
  }

  const dataSource = createDataSource(config.data.dataSource)
  log.info(
    { dataSource: config.data.dataSource.type },
    "Data source initialized"
  )

  const featureEngine = new FeatureEngine()
  let cycleCount = 0

  // Run initial market discovery
  log.info("Running initial market discovery...")
  try {
    const discovery = await discoverMarkets(config.data.tickLimit)
    const statArbConfigs = generateStatArbConfigs(discovery.statArbCandidates, discovery.groups)
    const termConfigs = generateTermStructureConfigs(discovery.termStructureCandidates)

    setStatArbConfigs(statArbConfigs)
    setTermStructureConfigs(termConfigs)

    log.info(
      { statArbPairs: statArbConfigs.length, termStructureEvents: termConfigs.length },
      "Market discovery complete"
    )
  } catch (discoveryError) {
    log.error({ error: discoveryError }, "Initial market discovery failed, using empty configs")
  }

  while (running) {
    cycleCount += 1
    log.info({ cycle: cycleCount }, "Starting cycle")

    try {
      const ticks = await dataSource.fetchOnce()
      const result = runCycle(ticks, portfolio, featureEngine, config)
      const snap = portfolio.snapshot()

      log.info(
        { trades: result.trades, skips: result.skips, blocks: result.blocks },
        "Cycle market result"
      )
      log.info(
        {
          equity: snap.equity,
          arbProfit: snap.lockedArbProfit,
          slippageCost: snap.totalSlippageCost,
          drawdownPct: snap.drawdownPct,
        },
        "Portfolio snapshot"
      )

      if (result.alerts.length > 0) {
        log.warn({ alerts: result.alerts }, "Cycle alerts")
      }

      persistState(portfolio, wallet, config, cycleCount)
      consecutiveErrors = 0

      if (cycleCount % CYCLE.TUNE_EVERY_N_CYCLES === 0) {
        log.info("Running auto-tune")
        try {
          resetConfigCache()
          const report = autotune()
          if (report.adjustments.length === 0) {
            log.info("No adjustments needed")
          } else {
            log.info(
              { adjustments: report.adjustments },
              "Auto-tune adjustments applied"
            )
          }
          resetConfigCache()
          config = loadConfig()
        } catch (tuneError) {
          log.error({ error: tuneError }, "Auto-tune failed")
        }
      }

      // Periodic market discovery
      if (cycleCount % DISCOVERY_EVERY_N_CYCLES === 0) {
        log.info("Running periodic market discovery")
        try {
          const discovery = await discoverMarkets(config.data.tickLimit)
          const statArbConfigs = generateStatArbConfigs(discovery.statArbCandidates, discovery.groups)
          const termConfigs = generateTermStructureConfigs(discovery.termStructureCandidates)

          setStatArbConfigs(statArbConfigs)
          setTermStructureConfigs(termConfigs)

          log.info(
            { statArbPairs: statArbConfigs.length, termStructureEvents: termConfigs.length },
            "Market discovery updated"
          )
        } catch (discoveryError) {
          log.error({ error: discoveryError }, "Periodic market discovery failed")
        }
      }

      if (running) {
        const deadline = Date.now() + CYCLE.INTERVAL_MS
        while (running && Date.now() < deadline) await sleep(1000)
      }
    } catch (cycleError) {
      consecutiveErrors += 1
      log.error(
        { cycle: cycleCount, error: cycleError, consecutiveErrors },
        "Cycle failed"
      )

      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        log.error(
          { consecutiveErrors, maxErrors: MAX_CONSECUTIVE_ERRORS },
          "Max consecutive errors reached, entering backoff"
        )
        await sleep(ERROR_BACKOFF_MS)
        consecutiveErrors = 0
      }

      if (running) {
        const deadline = Date.now() + CYCLE.INTERVAL_MS
        while (running && Date.now() < deadline) await sleep(1000)
      }
    }
  }

  dataSource.stop()
  log.info({ totalCycles: cycleCount }, "Daemon stopped")
}

void main()
