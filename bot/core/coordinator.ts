import type {
  StrategyType,
  Opportunity,
  FeatureSnapshot,
  RoutedOpportunity,
  ArbitrationResult,
  StrategyState,
} from "../contracts/types"
import type { BookState } from "../ingest/orderbook"
import type { CapitalAllocator, AllocationDecision } from "../capital/allocator"
import type { PositionManager } from "../position/manager"
import { StrategyRouter, createDefaultRouter } from "../signal/router"

export type CoordinationResult = {
  selectedOpportunity: Opportunity | null
  allocationDecision: AllocationDecision | null
  rejectedOpportunities: Array<{
    opportunity: Opportunity
    reason: string
  }>
  warnings: string[]
}

export type ConflictType = "market" | "capital" | "risk" | "priority"

export type Conflict = {
  type: ConflictType
  strategies: StrategyType[]
  marketId?: string
  description: string
}

export type ConflictResolution = {
  conflict: Conflict
  winner: StrategyType
  reason: string
}

export type CoordinatorConfig = {
  enableParallelSignals: boolean
  maxSignalsPerCycle: number
  arbitrationStrategy: "highest_ev" | "highest_priority" | "risk_adjusted"
}

export const DEFAULT_COORDINATOR_CONFIG: CoordinatorConfig = {
  enableParallelSignals: true,
  maxSignalsPerCycle: 10,
  arbitrationStrategy: "risk_adjusted",
}

export class StrategyCoordinator {
  private router: StrategyRouter
  private capitalAllocator: CapitalAllocator
  private positionManager: PositionManager
  private config: CoordinatorConfig
  private strategyStates: Map<StrategyType, StrategyState>
  private lastAdjustmentTs: number = 0

  constructor(
    capitalAllocator: CapitalAllocator,
    positionManager: PositionManager,
    config: Partial<CoordinatorConfig> = {}
  ) {
    this.capitalAllocator = capitalAllocator
    this.positionManager = positionManager
    this.config = { ...DEFAULT_COORDINATOR_CONFIG, ...config }
    this.router = createDefaultRouter()
    this.strategyStates = new Map()
    this.initializeStrategyStates()
  }

  private initializeStrategyStates(): void {
    const strategies: StrategyType[] = [
      "static_arb",
      "stat_arb",
      "microstructure",
      "term_structure",
    ]
    for (const strategy of strategies) {
      this.strategyStates.set(strategy, {
        name: strategy,
        type: strategy,
        status: "active",
        currentExposure: 0,
        intradayPnl: 0,
        opportunitiesFound: 0,
        opportunitiesExecuted: 0,
        consecutiveFails: 0,
        avgEvBps: 0,
        winRate: 0,
        lockedMarkets: new Set(),
      })
    }
  }

  coordinate(
    feature: FeatureSnapshot,
    book: BookState,
    now: number
  ): CoordinationResult {
    const warnings: string[] = []
    const rejectedOpportunities: Array<{
      opportunity: Opportunity
      reason: string
    }> = []

    // Step 1: Collect signals from all strategies
    const routedOpps = this.router.route(feature, book, now)

    if (routedOpps.length === 0) {
      return {
        selectedOpportunity: null,
        allocationDecision: null,
        rejectedOpportunities,
        warnings: ["NO_SIGNALS"],
      }
    }

    // Step 2: Check for conflicts
    const conflicts = this.detectConflicts(routedOpps)
    if (conflicts.length > 0) {
      warnings.push(`CONFLICTS_DETECTED: ${conflicts.length}`)
    }

    // Step 3: Arbitrate
    const arbitration = this.router.arbitrate(routedOpps)

    // Record rejected opportunities
    for (const rejected of arbitration.rejected) {
      rejectedOpportunities.push({
        opportunity: rejected.opportunity.opportunity,
        reason: rejected.reason,
      })
    }

    if (!arbitration.selected) {
      return {
        selectedOpportunity: null,
        allocationDecision: null,
        rejectedOpportunities,
        warnings: [...warnings, "NO_SELECTION"],
      }
    }

    const selected = arbitration.selected.opportunity

    // Step 4: Check capital allocation
    const strategyExposures = this.getStrategyExposures()
    const marketExposures = this.getMarketExposures()

    const allocationDecision = this.capitalAllocator.checkAndDecide(
      selected,
      strategyExposures,
      marketExposures
    )

    if (!allocationDecision.checks.capitalCheck) {
      warnings.push(`CAPITAL_INSUFFICIENT: ${selected.strategy}`)
      rejectedOpportunities.push({
        opportunity: selected,
        reason: "CAPITAL_INSUFFICIENT",
      })
    }

    if (!allocationDecision.checks.exposureCheck) {
      warnings.push(`EXPOSURE_EXCEEDED: ${selected.strategy}`)
      rejectedOpportunities.push({
        opportunity: selected,
        reason: "EXPOSURE_EXCEEDED",
      })
    }

    // Step 5: Update strategy states
    const state = this.strategyStates.get(selected.strategy)
    if (state) {
      state.opportunitiesFound += 1
      if (allocationDecision.allowedAmount > 0) {
        state.opportunitiesExecuted += 1
      }
    }

    return {
      selectedOpportunity:
        allocationDecision.allowedAmount > 0 ? selected : null,
      allocationDecision:
        allocationDecision.allowedAmount > 0 ? allocationDecision : null,
      rejectedOpportunities,
      warnings,
    }
  }

  detectConflicts(opportunities: RoutedOpportunity[]): Conflict[] {
    const conflicts: Conflict[] = []
    const marketStrategies = new Map<string, StrategyType[]>()

    // Group by market
    for (const opp of opportunities) {
      for (const marketId of opp.opportunity.marketIds) {
        const existing = marketStrategies.get(marketId) ?? []
        existing.push(opp.sourceStrategy as StrategyType)
        marketStrategies.set(marketId, existing)
      }
    }

    // Find conflicts (same market, different strategies)
    for (const [marketId, strategies] of marketStrategies) {
      if (strategies.length > 1) {
        conflicts.push({
          type: "market",
          strategies,
          marketId,
          description: `Multiple strategies targeting market ${marketId}: ${strategies.join(", ")}`,
        })
      }
    }

    return conflicts
  }

  resolveConflicts(conflicts: Conflict[]): ConflictResolution[] {
    const resolutions: ConflictResolution[] = []

    for (const conflict of conflicts) {
      // Winner is determined by priority (first in list)
      const winner = conflict.strategies[0]
      resolutions.push({
        conflict,
        winner,
        reason: "Highest priority strategy wins",
      })
    }

    return resolutions
  }

  updateAfterExecution(
    strategy: StrategyType,
    success: boolean,
    pnl: number,
    exposure: number
  ): void {
    const state = this.strategyStates.get(strategy)
    if (!state) return

    state.currentExposure = exposure

    if (success) {
      state.intradayPnl += pnl
      state.consecutiveFails = 0
    } else {
      state.consecutiveFails += 1
    }

    // Update win rate
    if (state.opportunitiesExecuted > 0) {
      state.winRate =
        (state.opportunitiesExecuted - state.consecutiveFails) /
        state.opportunitiesExecuted
    }

    // Update capital allocator
    const usedCapital = this.positionManager.getStrategyExposure(strategy)
    this.capitalAllocator.updateUsage(
      strategy,
      usedCapital,
      Math.abs(state.intradayPnl)
    )
  }

  shouldAdjustWeights(now: number): boolean {
    return now - this.lastAdjustmentTs >= 60 * 60 * 1000 // 1 hour
  }

  adjustWeights(now: number): string[] {
    this.lastAdjustmentTs = now
    return this.capitalAllocator.adjustWeights(this.strategyStates, now)
  }

  getStrategyState(strategy: StrategyType): StrategyState | undefined {
    return this.strategyStates.get(strategy)
  }

  getAllStrategyStates(): Map<StrategyType, StrategyState> {
    return new Map(this.strategyStates)
  }

  private getStrategyExposures(): Map<StrategyType, number> {
    const exposures = new Map<StrategyType, number>()
    for (const strategy of this.strategyStates.keys()) {
      exposures.set(
        strategy,
        this.positionManager.getStrategyExposure(strategy)
      )
    }
    return exposures
  }

  private getMarketExposures(): Map<string, number> {
    const exposures = new Map<string, number>()
    // This would need to iterate through position manager's market exposures
    // For now, return empty map
    return exposures
  }

  pauseStrategy(strategy: StrategyType): void {
    const state = this.strategyStates.get(strategy)
    if (state) {
      state.status = "paused"
      this.router.disableStrategy(strategy)
    }
  }

  resumeStrategy(strategy: StrategyType): void {
    const state = this.strategyStates.get(strategy)
    if (state) {
      state.status = "active"
      state.consecutiveFails = 0
      this.router.enableStrategy(strategy)
    }
  }

  reset(): void {
    this.initializeStrategyStates()
    this.lastAdjustmentTs = Date.now()
  }
}
