import type { StrategyType, Position } from "../contracts/types"

export type ManagedPosition = Position & {
  id: string
  strategy: StrategyType
  openedAt: number
  lastUpdated: number
  pairedPositionId?: string
  hedgeStatus: "hedged" | "partial" | "unhedged"
  orderId: string
  realizedPnl: number
}

export type StrategyPositionGroup = {
  strategy: StrategyType
  positions: Map<string, ManagedPosition>
  totalExposure: number
  unrealizedPnl: number
  realizedPnl: number
  hedgedValue: number
  unhedgedExposure: number
}

export type MarketExposure = {
  marketId: string
  yesSize: number
  noSize: number
  netExposure: number
  hedgedSize: number
  hedgedValue: number
  unhedgedExposure: number
  strategies: StrategyType[]
}

export type PortfolioState = {
  totalEquity: number
  cashBalance: number
  strategyPositions: Map<StrategyType, StrategyPositionGroup>
  marketExposures: Map<string, MarketExposure>
  combinedExposure: number
  hedgedValue: number
  unhedgedExposure: number
  totalUnrealizedPnl: number
  totalRealizedPnl: number
}

export type HedgePair = {
  yesPosition: ManagedPosition
  noPosition: ManagedPosition
  hedgedSize: number
  lockedProfit: number
  efficiency: number
}

export type PositionConstraint = {
  maxSizePerTrade: number
  maxSizePerMarket: number
  maxSizePerStrategy: number
  maxUnhedgedPct: number
  maxHoldingTimeMs: number
}

export const DEFAULT_POSITION_CONSTRAINT: PositionConstraint = {
  maxSizePerTrade: 500,
  maxSizePerMarket: 1000,
  maxSizePerStrategy: 5000,
  maxUnhedgedPct: 0.3,
  maxHoldingTimeMs: 300000, // 5 minutes
}

export class PositionManager {
  private positions: Map<string, ManagedPosition> = new Map()
  private strategyGroups: Map<StrategyType, StrategyPositionGroup> = new Map()
  private marketExposures: Map<string, MarketExposure> = new Map()
  private hedgePairs: Map<string, HedgePair> = new Map()
  private constraint: PositionConstraint
  private positionIdCounter: number = 0

  constructor(constraint: Partial<PositionConstraint> = {}) {
    this.constraint = { ...DEFAULT_POSITION_CONSTRAINT, ...constraint }
    this.initializeStrategyGroups()
  }

  private initializeStrategyGroups(): void {
    const strategies: StrategyType[] = [
      "static_arb",
      "stat_arb",
      "microstructure",
      "term_structure",
    ]
    for (const strategy of strategies) {
      this.strategyGroups.set(strategy, {
        strategy,
        positions: new Map(),
        totalExposure: 0,
        unrealizedPnl: 0,
        realizedPnl: 0,
        hedgedValue: 0,
        unhedgedExposure: 0,
      })
    }
  }

  openPosition(
    strategy: StrategyType,
    marketId: string,
    side: "YES" | "NO",
    size: number,
    price: number,
    orderId: string
  ): ManagedPosition {
    const id = `pos-${++this.positionIdCounter}`
    const now = Date.now()

    const position: ManagedPosition = {
      id,
      strategy,
      marketId,
      side,
      size,
      avgEntry: price,
      currentPrice: price,
      unrealizedPnl: 0,
      realizedPnl: 0,
      openedAt: now,
      lastUpdated: now,
      hedgeStatus: "unhedged",
      orderId,
    }

    this.positions.set(id, position)
    this.addToStrategyGroup(position)
    this.updateMarketExposure(marketId)
    this.checkAndCreateHedge(marketId, strategy)

    return position
  }

  closePosition(
    positionId: string,
    price: number,
    reason: string
  ): { closedPosition: ManagedPosition; realizedPnl: number } | null {
    const position = this.positions.get(positionId)
    if (!position) return null

    const realizedPnl = (price - position.avgEntry) * position.size
    position.realizedPnl = realizedPnl
    position.unrealizedPnl = 0
    position.currentPrice = price

    // Remove from tracking
    this.positions.delete(positionId)
    this.removeFromStrategyGroup(position)
    this.updateMarketExposure(position.marketId)

    // Update hedge pair if exists
    if (position.pairedPositionId) {
      this.hedgePairs.delete(position.pairedPositionId)
      const pairKey = this.findHedgePairKey(positionId)
      if (pairKey) {
        this.hedgePairs.delete(pairKey)
      }
    }

    return { closedPosition: position, realizedPnl }
  }

  updatePositionPrice(positionId: string, currentPrice: number): void {
    const position = this.positions.get(positionId)
    if (!position) return

    position.currentPrice = currentPrice
    position.unrealizedPnl = (currentPrice - position.avgEntry) * position.size
    position.lastUpdated = Date.now()
  }

  private addToStrategyGroup(position: ManagedPosition): void {
    const group = this.strategyGroups.get(position.strategy)
    if (!group) return

    group.positions.set(position.id, position)
    group.totalExposure += position.size * position.avgEntry
    group.unrealizedPnl += position.unrealizedPnl
  }

  private removeFromStrategyGroup(position: ManagedPosition): void {
    const group = this.strategyGroups.get(position.strategy)
    if (!group) return

    group.positions.delete(position.id)
    group.totalExposure -= position.size * position.avgEntry
    group.realizedPnl += position.realizedPnl
  }

  private updateMarketExposure(marketId: string): void {
    const marketPositions = Array.from(this.positions.values()).filter(
      (p) => p.marketId === marketId
    )

    const yesPositions = marketPositions.filter((p) => p.side === "YES")
    const noPositions = marketPositions.filter((p) => p.side === "NO")

    const yesSize = yesPositions.reduce((sum, p) => sum + p.size, 0)
    const noSize = noPositions.reduce((sum, p) => sum + p.size, 0)
    const hedgedSize = Math.min(yesSize, noSize)

    // Calculate hedged value (each hedged pair worth $1)
    const yesAvgEntry =
      yesSize > 0
        ? yesPositions.reduce((sum, p) => sum + p.avgEntry * p.size, 0) /
          yesSize
        : 0
    const noAvgEntry =
      noSize > 0
        ? noPositions.reduce((sum, p) => sum + p.avgEntry * p.size, 0) / noSize
        : 0

    const hedgedValue = hedgedSize * (1 - yesAvgEntry - noAvgEntry) // Locked profit

    const strategies = [...new Set(marketPositions.map((p) => p.strategy))]

    this.marketExposures.set(marketId, {
      marketId,
      yesSize,
      noSize,
      netExposure: Math.abs(yesSize - noSize),
      hedgedSize,
      hedgedValue,
      unhedgedExposure: Math.abs(yesSize - noSize),
      strategies,
    })
  }

  private checkAndCreateHedge(marketId: string, strategy: StrategyType): void {
    const marketPositions = Array.from(this.positions.values()).filter(
      (p) => p.marketId === marketId && p.strategy === strategy
    )

    const yesPositions = marketPositions.filter(
      (p) => p.side === "YES" && p.hedgeStatus === "unhedged"
    )
    let noPositions = marketPositions.filter(
      (p) => p.side === "NO" && p.hedgeStatus === "unhedged"
    )

    // Create hedge pairs
    for (const yesPos of yesPositions) {
      const noPos = noPositions.find(
        (p) => p.hedgeStatus === "unhedged" && p.size <= yesPos.size * 1.1
      )
      if (noPos) {
        this.createHedgePair(yesPos, noPos)
        noPositions = noPositions.filter((p) => p.id !== noPos.id)
      }
    }
  }

  private createHedgePair(
    yesPos: ManagedPosition,
    noPos: ManagedPosition
  ): void {
    const hedgedSize = Math.min(yesPos.size, noPos.size)
    const lockedProfit = hedgedSize * (1 - yesPos.avgEntry - noPos.avgEntry)
    const efficiency = hedgedSize / Math.max(yesPos.size, noPos.size)

    yesPos.pairedPositionId = noPos.id
    yesPos.hedgeStatus = hedgedSize >= yesPos.size ? "hedged" : "partial"
    noPos.pairedPositionId = yesPos.id
    noPos.hedgeStatus = hedgedSize >= noPos.size ? "hedged" : "partial"

    const pairKey = `hedge-${yesPos.id}-${noPos.id}`
    this.hedgePairs.set(pairKey, {
      yesPosition: yesPos,
      noPosition: noPos,
      hedgedSize,
      lockedProfit,
      efficiency,
    })

    // Update strategy group hedged value
    const group = this.strategyGroups.get(yesPos.strategy)
    if (group) {
      group.hedgedValue += lockedProfit
      group.unhedgedExposure = group.totalExposure - group.hedgedValue
    }
  }

  private findHedgePairKey(positionId: string): string | null {
    for (const [key, pair] of this.hedgePairs) {
      if (
        pair.yesPosition.id === positionId ||
        pair.noPosition.id === positionId
      ) {
        return key
      }
    }
    return null
  }

  getHedgeSuggestions(): Array<{
    marketId: string
    strategy: StrategyType
    side: "YES" | "NO"
    size: number
    reason: string
  }> {
    const suggestions: Array<{
      marketId: string
      strategy: StrategyType
      side: "YES" | "NO"
      size: number
      reason: string
    }> = []

    for (const [marketId, exposure] of this.marketExposures) {
      if (exposure.unhedgedExposure > 0) {
        const side = exposure.yesSize > exposure.noSize ? "NO" : "YES"
        const size = exposure.unhedgedExposure

        // Find which strategy has the unhedged position
        const marketPositions = Array.from(this.positions.values()).filter(
          (p) => p.marketId === marketId && p.hedgeStatus !== "hedged"
        )

        for (const pos of marketPositions) {
          suggestions.push({
            marketId,
            strategy: pos.strategy,
            side: pos.side === "YES" ? "NO" : "YES",
            size: Math.min(size, pos.size),
            reason: `Auto-hedge ${pos.side} position ${pos.id}`,
          })
        }
      }
    }

    return suggestions
  }

  getPositionsByStrategy(strategy: StrategyType): ManagedPosition[] {
    return Array.from(this.positions.values()).filter(
      (p) => p.strategy === strategy
    )
  }

  getPositionsByMarket(marketId: string): ManagedPosition[] {
    return Array.from(this.positions.values()).filter(
      (p) => p.marketId === marketId
    )
  }

  getUnhedgedPositions(): ManagedPosition[] {
    return Array.from(this.positions.values()).filter(
      (p) => p.hedgeStatus !== "hedged"
    )
  }

  getMarketExposure(marketId: string): MarketExposure | undefined {
    return this.marketExposures.get(marketId)
  }

  getStrategyExposure(strategy: StrategyType): number {
    const group = this.strategyGroups.get(strategy)
    return group?.totalExposure ?? 0
  }

  getPortfolioState(equity: number, cashBalance: number): PortfolioState {
    let combinedExposure = 0
    let hedgedValue = 0
    let unhedgedExposure = 0
    let totalUnrealizedPnl = 0
    let totalRealizedPnl = 0

    for (const [, group] of this.strategyGroups) {
      combinedExposure += group.totalExposure
      hedgedValue += group.hedgedValue
      unhedgedExposure += group.unhedgedExposure
      totalUnrealizedPnl += group.unrealizedPnl
      totalRealizedPnl += group.realizedPnl
    }

    return {
      totalEquity: equity,
      cashBalance,
      strategyPositions: new Map(this.strategyGroups),
      marketExposures: new Map(this.marketExposures),
      combinedExposure,
      hedgedValue,
      unhedgedExposure,
      totalUnrealizedPnl,
      totalRealizedPnl,
    }
  }

  getHedgePairs(): HedgePair[] {
    return Array.from(this.hedgePairs.values())
  }

  getPositionCount(): number {
    return this.positions.size
  }

  getTotalExposure(): number {
    let total = 0
    for (const [, group] of this.strategyGroups) {
      total += group.totalExposure
    }
    return total
  }

  checkConstraint(
    strategy: StrategyType,
    marketId: string,
    size: number
  ): { allowed: boolean; reason?: string; maxSize: number } {
    const strategyExposure = this.getStrategyExposure(strategy)
    const marketExposure = this.marketExposures.get(marketId)

    const currentMarketExposure = marketExposure?.netExposure ?? 0

    // Check per-trade limit
    if (size > this.constraint.maxSizePerTrade) {
      return {
        allowed: true,
        reason: "Capped by per-trade limit",
        maxSize: this.constraint.maxSizePerTrade,
      }
    }

    // Check per-market limit
    if (currentMarketExposure + size > this.constraint.maxSizePerMarket) {
      const remaining = this.constraint.maxSizePerMarket - currentMarketExposure
      if (remaining <= 0) {
        return {
          allowed: false,
          reason: "Market exposure limit reached",
          maxSize: 0,
        }
      }
      return {
        allowed: true,
        reason: "Capped by market limit",
        maxSize: remaining,
      }
    }

    // Check per-strategy limit
    if (strategyExposure + size > this.constraint.maxSizePerStrategy) {
      const remaining = this.constraint.maxSizePerStrategy - strategyExposure
      if (remaining <= 0) {
        return {
          allowed: false,
          reason: "Strategy exposure limit reached",
          maxSize: 0,
        }
      }
      return {
        allowed: true,
        reason: "Capped by strategy limit",
        maxSize: remaining,
      }
    }

    return { allowed: true, maxSize: size }
  }

  markToMarket(marketId: string, yesPrice: number, noPrice: number): void {
    const positions = this.getPositionsByMarket(marketId)

    for (const pos of positions) {
      const price = pos.side === "YES" ? yesPrice : noPrice
      this.updatePositionPrice(pos.id, price)
    }
  }

  reset(): void {
    this.positions.clear()
    this.hedgePairs.clear()
    this.marketExposures.clear()
    this.initializeStrategyGroups()
    this.positionIdCounter = 0
  }
}
