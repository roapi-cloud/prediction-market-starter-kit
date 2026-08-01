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
import { createChildLogger } from "./lib/logger"
import { CYCLE } from "./config/constants"

const log = createChildLogger("realtime-daemon")

let tickErrors = 0
const MAX_TICK_ERRORS = 10

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
  log.info("Realtime Bot Daemon starting")

  let config = loadConfig()
  const dataSourceType = config.data.dataSource.type
  log.info(
    { dataSource: dataSourceType, autoTuneInterval: "1 hour" },
    "Configuration loaded"
  )
  log.info("Press Ctrl+C to stop")

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
  const engine = new RealtimeEngine(portfolio, config)

  let cycleCount = 0
  let tradeCount = 0
  let exitCount = 0
  let lastTuneTime = Date.now()
  let lastPrintTime = Date.now()
  let running = true

  dataSource.start({
    onConnect: () => {
      log.info("Data source connected")
    },
    onDisconnect: () => {
      log.warn("Data source disconnected")
    },
    onError: (err) => {
      log.error({ error: err.message }, "Data source error")
    },
    onTick: (tick: SyntheticTick) => {
      if (!running) return

      try {
        cycleCount += 1
        const result = engine.processTick(tick)
        tradeCount += result.trades
        exitCount += result.exits
        tickErrors = 0

        if (Date.now() - lastPrintTime >= CYCLE.PRINT_INTERVAL_MS) {
          lastPrintTime = Date.now()
          const snap = portfolio.snapshot()
          log.info(
            {
              tick: cycleCount,
              trades: tradeCount,
              exits: exitCount,
              equity: snap.equity,
              arbProfit: snap.lockedArbProfit,
              drawdownPct: snap.drawdownPct,
            },
            "Tick processed"
          )

          if (result.spreadChanges.length > 0) {
            log.debug(
              { spreadChanges: result.spreadChanges.slice(0, 3) },
              "Spread changes"
            )
          }

          if (result.alerts.length > 0) {
            log.warn({ alerts: result.alerts }, "Tick alerts")
          }
        }

        if (cycleCount % CYCLE.PERSIST_EVERY_N_TICKS === 0) {
          persistState(
            portfolio,
            wallet,
            config,
            cycleCount,
            tradeCount,
            exitCount
          )
          log.debug({ tick: cycleCount }, "State persisted")
        }

        if (Date.now() - lastTuneTime >= CYCLE.TUNE_INTERVAL_MS) {
          lastTuneTime = Date.now()
          log.info("Running auto-tune")
          try {
            resetConfigCache()
            const report = autotune()
            if (report.adjustments.length > 0) {
              log.info(
                { adjustments: report.adjustments },
                "Auto-tune adjustments applied"
              )
              resetConfigCache()
              config = loadConfig()
            } else {
              log.info("No adjustments needed")
            }
          } catch (tuneError) {
            log.error({ error: tuneError }, "Auto-tune failed")
          }
        }
      } catch (tickError) {
        tickErrors += 1
        log.error(
          { tick: cycleCount, error: tickError, consecutiveErrors: tickErrors },
          "Tick processing failed"
        )

        if (tickErrors >= MAX_TICK_ERRORS) {
          log.error(
            { consecutiveErrors: tickErrors, maxErrors: MAX_TICK_ERRORS },
            "Max tick errors reached, stopping daemon"
          )
          running = false
          dataSource.stop()
          persistState(
            portfolio,
            wallet,
            config,
            cycleCount,
            tradeCount,
            exitCount
          )
          process.exit(1)
        }
      }
    },
  })

  process.on("SIGINT", () => {
    log.info("Shutting down (SIGINT)...")
    running = false
    dataSource.stop()
    persistState(portfolio, wallet, config, cycleCount, tradeCount, exitCount)
    log.info(
      { ticks: cycleCount, trades: tradeCount, exits: exitCount },
      "Daemon stopped"
    )
    process.exit(0)
  })

  process.on("SIGTERM", () => {
    log.info("Shutting down (SIGTERM)...")
    running = false
    dataSource.stop()
    persistState(portfolio, wallet, config, cycleCount, tradeCount, exitCount)
    process.exit(0)
  })
}

void main()
