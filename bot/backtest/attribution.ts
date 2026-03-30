import type { BacktestEvent, AttributionResult } from "../contracts/types"

export function attributePnl(events: BacktestEvent[]): AttributionResult {
  const signalPnl = events.reduce((acc, e) => acc + (e.signalPnl ?? 0), 0)
  const executionLoss = events.reduce(
    (acc, e) => acc + Math.abs(e.executionLoss ?? 0),
    0
  )
  const inventoryLoss = events.reduce(
    (acc, e) => acc + Math.abs(e.inventoryLoss ?? 0),
    0
  )
  const riskControlLoss = events.reduce(
    (acc, e) => acc + Math.abs(e.riskControlLoss ?? 0),
    0
  )

  const totalPnl = events.reduce((acc, e) => acc + (e.pnl ?? 0), 0)

  return {
    signalPnl,
    executionLoss,
    inventoryLoss,
    riskControlLoss,
    totalPnl,
  }
}

export function computeSignalQuality(
  opportunities: Array<{ evBps: number; actualPnlBps?: number }>
): { hitRate: number; avgEvError: number; avgEvBps: number } {
  const withResults = opportunities.filter((o) => o.actualPnlBps !== undefined)
  if (withResults.length === 0) {
    return { hitRate: 0, avgEvError: 0, avgEvBps: 0 }
  }

  const hits = withResults.filter((o) => (o.actualPnlBps ?? 0) > 0).length
  const hitRate = hits / withResults.length

  const evErrors = withResults.map((o) =>
    Math.abs(o.evBps - (o.actualPnlBps ?? 0))
  )
  const avgEvError = evErrors.reduce((a, b) => a + b, 0) / evErrors.length

  const avgEvBps =
    opportunities.reduce((a, o) => a + o.evBps, 0) / opportunities.length

  return { hitRate, avgEvError, avgEvBps }
}

export function computeExecutionLoss(
  executions: Array<{
    intendedPrice: number
    actualPrice: number
    size: number
    delayMs: number
  }>
): { totalSlippageLoss: number; avgSlippageBps: number; delayImpact: number } {
  if (executions.length === 0) {
    return { totalSlippageLoss: 0, avgSlippageBps: 0, delayImpact: 0 }
  }

  const slippages = executions.map((e) => {
    const slippageBps = Math.abs(e.actualPrice - e.intendedPrice) * 10000
    return slippageBps * e.size
  })

  const totalSlippageLoss = slippages.reduce((a, b) => a + b, 0)
  const avgSlippageBps =
    executions.reduce(
      (a, e) => a + Math.abs(e.actualPrice - e.intendedPrice) * 10000,
      0
    ) / executions.length

  const delayImpact = executions.reduce(
    (a, e) => a + e.delayMs * 0.001 * e.size,
    0
  )

  return { totalSlippageLoss, avgSlippageBps, delayImpact }
}

export function computeInventoryLoss(
  positions: Array<{
    entryPrice: number
    exitPrice: number
    size: number
    holdingMs: number
  }>
): { totalInventoryLoss: number; avgHoldingMs: number; driftLoss: number } {
  if (positions.length === 0) {
    return { totalInventoryLoss: 0, avgHoldingMs: 0, driftLoss: 0 }
  }

  const inventoryLosses = positions.map((p) => {
    const priceDrift = Math.abs(p.exitPrice - p.entryPrice)
    return priceDrift * p.size * 0.1
  })

  const totalInventoryLoss = inventoryLosses.reduce((a, b) => a + b, 0)
  const avgHoldingMs =
    positions.reduce((a, p) => a + p.holdingMs, 0) / positions.length
  const driftLoss = totalInventoryLoss * 0.5

  return { totalInventoryLoss, avgHoldingMs, driftLoss }
}

export function computeRiskControlLoss(
  rejectedOpportunities: Array<{ evBps: number; size: number; reason: string }>
): {
  totalOpportunityLoss: number
  byReason: Record<string, number>
  count: number
} {
  if (rejectedOpportunities.length === 0) {
    return { totalOpportunityLoss: 0, byReason: {}, count: 0 }
  }

  const losses = rejectedOpportunities.map((o) => (o.evBps / 10000) * o.size)
  const totalOpportunityLoss = losses.reduce((a, b) => a + b, 0)

  const byReason: Record<string, number> = {}
  for (const o of rejectedOpportunities) {
    byReason[o.reason] = (byReason[o.reason] ?? 0) + (o.evBps / 10000) * o.size
  }

  return { totalOpportunityLoss, byReason, count: rejectedOpportunities.length }
}

export class AttributionEngine {
  private events: BacktestEvent[] = []

  addEvent(event: BacktestEvent): void {
    this.events.push(event)
  }

  compute(): AttributionResult {
    return attributePnl(this.events)
  }

  breakdownByStrategy(): Record<string, AttributionResult> {
    const byStrategy: Record<string, BacktestEvent[]> = {}

    for (const event of this.events) {
      const strategy = (event.data.strategy as string) ?? "unknown"
      if (!byStrategy[strategy]) {
        byStrategy[strategy] = []
      }
      byStrategy[strategy].push(event)
    }

    const result: Record<string, AttributionResult> = {}
    for (const [strategy, events] of Object.entries(byStrategy)) {
      result[strategy] = attributePnl(events)
    }

    return result
  }

  breakdownByMarket(): Record<string, AttributionResult> {
    const byMarket: Record<string, BacktestEvent[]> = {}

    for (const event of this.events) {
      const marketId = (event.data.marketId as string) ?? "unknown"
      if (!byMarket[marketId]) {
        byMarket[marketId] = []
      }
      byMarket[marketId].push(event)
    }

    const result: Record<string, AttributionResult> = {}
    for (const [marketId, events] of Object.entries(byMarket)) {
      result[marketId] = attributePnl(events)
    }

    return result
  }

  breakdownByTimeWindow(
    windowMs: number
  ): Array<{ start: number; end: number; attribution: AttributionResult }> {
    if (this.events.length === 0) return []

    const minTs = Math.min(...this.events.map((e) => e.ts))
    const maxTs = Math.max(...this.events.map((e) => e.ts))

    const windows: Array<{
      start: number
      end: number
      attribution: AttributionResult
    }> = []

    for (let start = minTs; start < maxTs; start += windowMs) {
      const end = start + windowMs
      const windowEvents = this.events.filter(
        (e) => e.ts >= start && e.ts < end
      )

      if (windowEvents.length > 0) {
        windows.push({
          start,
          end,
          attribution: attributePnl(windowEvents),
        })
      }
    }

    return windows
  }

  clear(): void {
    this.events = []
  }

  getEvents(): BacktestEvent[] {
    return [...this.events]
  }
}
