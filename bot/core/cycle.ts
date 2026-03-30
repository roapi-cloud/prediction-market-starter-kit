import { tickToMarketEvents, type SyntheticTick } from "../ingest/adapter"
import {
  applyBookEvent,
  getDefaultBookState,
  type BookState,
} from "../ingest/orderbook"
import { FeatureEngine } from "../features/engine"
import { generateOpportunity } from "../signal"
import { preTradeCheck } from "../risk/pre_trade"
import { kellySize } from "../execution/kelly"
import { stoikovPriceAdjust } from "../execution/stoikov"
import { PaperPortfolio } from "../paper/portfolio"
import type { BotConfig } from "../config"

export type CycleResult = {
  trades: number
  skips: number
  blocks: number
  alerts: string[]
}

/**
 * Run one complete trading cycle: mark-to-market → scan → execute.
 *
 * Shared by daemon.ts and run-paper-trading.ts.
 */
export function runCycle(
  ticks: SyntheticTick[],
  portfolio: PaperPortfolio,
  featureEngine: FeatureEngine,
  config: BotConfig
): CycleResult {
  if (ticks.length === 0) return { trades: 0, skips: 0, blocks: 0, alerts: [] }

  let book: BookState = getDefaultBookState()
  let trades = 0
  let skips = 0
  let blocks = 0
  const alerts: string[] = []

  // Step 1: Mark-to-market existing positions
  // Use Ask prices for hedged positions (YES+NO together should value ~$1 at settlement)
  for (const tick of ticks) {
    portfolio.markToMarket(tick.marketId, tick.yesAsk, tick.noAsk)
  }

  // Step 2: Alert checks
  const snap = portfolio.snapshot()
  if (snap.drawdownPct >= Math.abs(config.risk.maxDrawdownPct)) {
    alerts.push(
      `[CRIT] Drawdown ${snap.drawdownPct.toFixed(2)}% exceeds ${config.risk.maxDrawdownPct}% limit!`
    )
  } else if (snap.drawdownPct >= Math.abs(config.risk.intradayStopPct)) {
    alerts.push(
      `[WARN] Drawdown ${snap.drawdownPct.toFixed(2)}% approaching limit`
    )
  }

  for (const pos of portfolio.positions.values()) {
    const weight =
      ((pos.size * pos.currentPrice) / Math.max(1, snap.equity)) * 100
    if (weight > config.risk.maxPositionPct) {
      alerts.push(
        `[WARN] ${pos.marketId}:${pos.side} concentration ${weight.toFixed(1)}% > ${config.risk.maxPositionPct}%`
      )
    }
  }

  // Step 3 & 4: Scan opportunities + Execute trades
  for (const tick of ticks) {
    const events = tickToMarketEvents(tick)
    for (const evt of events) {
      book = applyBookEvent(book, evt)
    }

    const feature = featureEngine.build(tick.marketId, tick.ts, book, events)
    const opp = generateOpportunity(
      feature,
      book,
      tick.ts,
      config.signal.costBps,
      config.signal.minEvBps
    )

    if (!opp || opp.confidence < config.signal.confidenceThreshold) {
      skips += 1
      continue
    }

    const decision = preTradeCheck(
      opp,
      portfolio.openNotional,
      config.portfolio.maxOpenNotional
    )
    if (!decision.allow) {
      blocks += 1
      continue
    }

    const pnlPct = (portfolio.totalPnl / Math.max(1, portfolio.equity)) * 100
    if (
      pnlPct <= config.risk.intradayStopPct ||
      portfolio.drawdownPct >= Math.abs(config.risk.maxDrawdownPct)
    ) {
      blocks += 1
      alerts.push(`[STOP] Circuit breaker active — no new trades`)
      break
    }

    const size = kellySize(
      opp.evBps,
      opp.confidence,
      portfolio.equity,
      config.execution.kellyCap
    )
    if (size < 0.01) {
      skips += 1
      continue
    }

    const inventory = Array.from(portfolio.positions.values()).reduce(
      (acc, p) => acc + (p.side === "YES" ? p.size : -p.size),
      0
    )
    const adjYes = stoikovPriceAdjust(
      book.yesAsk,
      inventory,
      config.execution.stoikovRiskAversion
    )
    const adjNo = stoikovPriceAdjust(
      book.noAsk,
      -inventory,
      config.execution.stoikovRiskAversion
    )

    portfolio.executeTrade(
      tick.marketId,
      "YES",
      adjYes,
      size / 2,
      tick.ts,
      config.execution.slippageBps,
      config.execution.partialFillBaseRate,
      config.execution.partialFillSizeDecay
    )
    portfolio.executeTrade(
      tick.marketId,
      "NO",
      adjNo,
      size / 2,
      tick.ts,
      config.execution.slippageBps,
      config.execution.partialFillBaseRate,
      config.execution.partialFillSizeDecay
    )

    trades += 1
  }

  // Final mark-to-market after all trades executed
  for (const tick of ticks) {
    portfolio.markToMarket(tick.marketId, tick.yesAsk, tick.noAsk)
  }

  return { trades, skips, blocks, alerts }
}
