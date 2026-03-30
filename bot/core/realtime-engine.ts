import { FeatureEngine } from "../features/engine"
import { PaperPortfolio } from "../paper/portfolio"
import { type BotConfig } from "../config"
import { generateOpportunity } from "../signal"
import { preTradeCheck } from "../risk/pre_trade"
import { kellySize } from "../execution/kelly"
import {
  analyzeDepth,
  splitOrderSize,
  computeLimitPrice,
} from "../execution/depth"
import { checkExitOpportunity } from "../execution/exit"
import { tickToMarketEvents, type SyntheticTick } from "../ingest/adapter"
import {
  applyBookEvent,
  getDefaultBookState,
  type BookState,
} from "../ingest/orderbook"
import { createDataSource } from "../integration"

export type RealtimeResult = {
  trades: number
  exits: number
  skips: number
  blocks: number
  alerts: string[]
  spreadChanges: Array<{
    marketId: string
    oldSpread: number
    newSpread: number
  }>
}

export class RealtimeEngine {
  private config: BotConfig
  private portfolio: PaperPortfolio
  private featureEngine: FeatureEngine
  private lastSpreads: Map<string, number> = new Map()
  private bookStates: Map<string, BookState> = new Map()
  private running = false
  private scanInterval = 1000
  private lastScanTime = 0

  constructor(portfolio: PaperPortfolio, config: BotConfig) {
    this.config = config
    this.portfolio = portfolio
    this.featureEngine = new FeatureEngine()
  }

  setScanInterval(ms: number): void {
    this.scanInterval = ms
  }

  processTick(tick: SyntheticTick): RealtimeResult {
    const alerts: string[] = []
    const spreadChanges: Array<{
      marketId: string
      oldSpread: number
      newSpread: number
    }> = []
    let trades = 0
    let exits = 0
    let skips = 0
    let blocks = 0

    const currentSpread = tick.yesAsk + tick.noAsk - 1
    const lastSpread = this.lastSpreads.get(tick.marketId)

    if (lastSpread !== undefined) {
      const spreadChange = currentSpread - lastSpread
      if (spreadChange < -0.001) {
        spreadChanges.push({
          marketId: tick.marketId,
          oldSpread: lastSpread,
          newSpread: currentSpread,
        })

        const exitDecision = checkExitOpportunity(
          tick.marketId,
          this.portfolio,
          currentSpread,
          lastSpread,
          this.config
        )

        if (exitDecision.shouldExit) {
          this.executeExit(tick, exitDecision)
          exits += 1
          alerts.push(
            `[EXIT] ${tick.marketId} spread narrowed from ${lastSpread.toFixed(4)} to ${currentSpread.toFixed(4)}, locked profit`
          )
        }
      }
    }

    this.lastSpreads.set(tick.marketId, currentSpread)

    this.portfolio.markToMarket(tick.marketId, tick.yesAsk, tick.noAsk)

    const snap = this.portfolio.snapshot()
    if (snap.drawdownPct >= Math.abs(this.config.risk.maxDrawdownPct)) {
      alerts.push(
        `[CRIT] Drawdown ${snap.drawdownPct.toFixed(2)}% exceeds limit`
      )
      return { trades, exits, skips, blocks: 1, alerts, spreadChanges }
    }

    let book = this.bookStates.get(tick.marketId) ?? getDefaultBookState()
    const events = tickToMarketEvents(tick)
    for (const evt of events) {
      book = applyBookEvent(book, evt)
    }
    this.bookStates.set(tick.marketId, book)

    const feature = this.featureEngine.build(
      tick.marketId,
      tick.ts,
      book,
      events
    )
    const opp = generateOpportunity(
      feature,
      book,
      tick.ts,
      this.config.signal.costBps,
      this.config.signal.minEvBps
    )

    if (!opp || opp.confidence < this.config.signal.confidenceThreshold) {
      skips += 1
      return { trades, exits, skips, blocks, alerts, spreadChanges }
    }

    const decision = preTradeCheck(
      opp,
      this.portfolio.openNotional,
      this.config.portfolio.maxOpenNotional
    )
    if (!decision.allow) {
      blocks += 1
      return { trades, exits, skips, blocks, alerts, spreadChanges }
    }

    const depthAnalysis = analyzeDepth(book, tick.volume)
    const baseSize = kellySize(
      opp.evBps,
      opp.confidence,
      this.portfolio.equity,
      this.config.execution.kellyCap
    )

    if (baseSize < 0.01) {
      skips += 1
      return { trades, exits, skips, blocks, alerts, spreadChanges }
    }

    const orderSplits = splitOrderSize(baseSize, depthAnalysis)

    for (const split of orderSplits) {
      const limitYes = computeLimitPrice(
        book.yesAsk,
        split.size,
        "BUY",
        this.config
      )
      const limitNo = computeLimitPrice(
        book.noAsk,
        split.size,
        "BUY",
        this.config
      )

      this.portfolio.executeTrade(
        tick.marketId,
        "YES",
        limitYes,
        split.size / 2,
        tick.ts,
        this.config.execution.slippageBps,
        this.config.execution.partialFillBaseRate,
        this.config.execution.partialFillSizeDecay
      )
      this.portfolio.executeTrade(
        tick.marketId,
        "NO",
        limitNo,
        split.size / 2,
        tick.ts,
        this.config.execution.slippageBps,
        this.config.execution.partialFillBaseRate,
        this.config.execution.partialFillSizeDecay
      )
      trades += 1
    }

    this.portfolio.markToMarket(tick.marketId, tick.yesAsk, tick.noAsk)

    return { trades, exits, skips, blocks, alerts, spreadChanges }
  }

  async scanOnce(): Promise<RealtimeResult> {
    const dataSource = createDataSource(this.config.data.dataSource)
    const ticks = await dataSource.fetchOnce()
    if (ticks.length === 0) {
      return {
        trades: 0,
        exits: 0,
        skips: 0,
        blocks: 0,
        alerts: [],
        spreadChanges: [],
      }
    }

    const result: RealtimeResult = {
      trades: 0,
      exits: 0,
      skips: 0,
      blocks: 0,
      alerts: [],
      spreadChanges: [],
    }

    for (const tick of ticks) {
      const tickResult = this.processTick(tick)
      result.trades += tickResult.trades
      result.exits += tickResult.exits
      result.skips += tickResult.skips
      result.blocks += tickResult.blocks
      result.alerts.push(...tickResult.alerts)
      result.spreadChanges.push(...tickResult.spreadChanges)
    }

    return result
  }

  private executeExit(
    tick: SyntheticTick,
    decision: { yesSize: number; noSize: number }
  ): void {
    const yesPos = this.portfolio.positions.get(`${tick.marketId}:YES`)
    const noPos = this.portfolio.positions.get(`${tick.marketId}:NO`)

    if (yesPos && decision.yesSize > 0) {
      const sellValue = decision.yesSize * tick.yesBid
      this.portfolio.cashBalance += sellValue
      yesPos.size -= decision.yesSize
      if (yesPos.size <= 0.01) {
        this.portfolio.positions.delete(`${tick.marketId}:YES`)
      }
    }

    if (noPos && decision.noSize > 0) {
      const sellValue = decision.noSize * tick.noBid
      this.portfolio.cashBalance += sellValue
      noPos.size -= decision.noSize
      if (noPos.size <= 0.01) {
        this.portfolio.positions.delete(`${tick.marketId}:NO`)
      }
    }
  }

  start(onCycle?: (result: RealtimeResult) => void): void {
    this.running = true
    const loop = async (): Promise<void> => {
      while (this.running) {
        const now = Date.now()
        if (now - this.lastScanTime >= this.scanInterval) {
          this.lastScanTime = now
          try {
            const result = await this.scanOnce()
            if (onCycle) onCycle(result)
          } catch (err) {
            console.error(`[ERROR] Scan failed: ${err}`)
          }
        }
        await new Promise((r) => setTimeout(r, 100))
      }
    }
    loop()
  }

  stop(): void {
    this.running = false
  }

  isRunning(): boolean {
    return this.running
  }
}
