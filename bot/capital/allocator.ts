import type {
  StrategyType,
  StrategyState,
  StrategyConfig,
  Opportunity,
} from "../contracts/types"

export type AllocationConstraints = {
  reservePct: number // 储备金比例，默认 0.1
  maxSingleStrategyPct: number // 单策略最大比例，默认 0.4
  maxMarketExposurePct: number // 单市场最大敞口，默认 0.15
  minAllocationAmount: number // 最小分配金额，默认 100
}

export const DEFAULT_CONSTRAINTS: AllocationConstraints = {
  reservePct: 0.1,
  maxSingleStrategyPct: 0.4,
  maxMarketExposurePct: 0.15,
  minAllocationAmount: 100,
}

export type StrategyAllocation = {
  strategy: StrategyType
  baseWeight: number
  adjustedWeight: number
  allocatedCapital: number
  usedCapital: number
  availableCapital: number
  riskBudget: number
  usedRiskBudget: number
  maxPositionSize: number
  maxMarketExposure: number
  adjustmentReason?: string
}

export type CapitalAllocation = {
  totalEquity: number
  reservedCapital: number
  availableCapital: number
  strategyAllocations: Map<StrategyType, StrategyAllocation>
  constraints: AllocationConstraints
  lastRebalanceTs: number
  rebalanceReason?: string
}

export type AllocationDecision = {
  strategy: StrategyType
  allowedAmount: number
  reason: string
  warnings: string[]
  checks: {
    capitalCheck: boolean
    riskBudgetCheck: boolean
    exposureCheck: boolean
    correlationCheck: boolean
  }
}

export type RebalanceTrigger = {
  type: "drawdown" | "exposure" | "hourly" | "manual"
  strategy?: StrategyType
  currentValue: number
  threshold: number
  reason: string
}

export class CapitalAllocator {
  private constraints: AllocationConstraints
  private allocation: CapitalAllocation
  private lastAdjustmentTs: number = 0
  private adjustmentIntervalMs: number = 60 * 60 * 1000 // 1小时

  constructor(
    initialEquity: number,
    strategyWeights: Partial<Record<StrategyType, number>>,
    constraints: Partial<AllocationConstraints> = {}
  ) {
    this.constraints = { ...DEFAULT_CONSTRAINTS, ...constraints }
    this.allocation = this.initializeAllocation(initialEquity, strategyWeights)
  }

  private initializeAllocation(
    equity: number,
    weights: Partial<Record<StrategyType, number>>
  ): CapitalAllocation {
    const reservedCapital = equity * this.constraints.reservePct
    const availableCapital = equity - reservedCapital

    const strategyAllocations = new Map<StrategyType, StrategyAllocation>()
    const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0)

    for (const [strategy, weight] of Object.entries(weights)) {
      const normalizedWeight = weight / totalWeight
      const allocatedCapital = availableCapital * normalizedWeight

      strategyAllocations.set(strategy as StrategyType, {
        strategy: strategy as StrategyType,
        baseWeight: normalizedWeight,
        adjustedWeight: normalizedWeight,
        allocatedCapital,
        usedCapital: 0,
        availableCapital: allocatedCapital,
        riskBudget: allocatedCapital * 0.1, // 10% risk budget
        usedRiskBudget: 0,
        maxPositionSize:
          allocatedCapital * this.constraints.maxSingleStrategyPct,
        maxMarketExposure: equity * this.constraints.maxMarketExposurePct,
      })
    }

    return {
      totalEquity: equity,
      reservedCapital,
      availableCapital,
      strategyAllocations,
      constraints: this.constraints,
      lastRebalanceTs: Date.now(),
    }
  }

  getAllocation(): CapitalAllocation {
    return this.allocation
  }

  getStrategyAllocation(
    strategy: StrategyType
  ): StrategyAllocation | undefined {
    return this.allocation.strategyAllocations.get(strategy)
  }

  checkAndDecide(
    opportunity: Opportunity,
    strategyExposures: Map<StrategyType, number>,
    marketExposures: Map<string, number>
  ): AllocationDecision {
    const strategy = opportunity.strategy
    const allocation = this.allocation.strategyAllocations.get(strategy)
    const warnings: string[] = []

    if (!allocation) {
      return {
        strategy,
        allowedAmount: 0,
        reason: "Strategy not found in allocation",
        warnings: ["STRATEGY_NOT_CONFIGURED"],
        checks: {
          capitalCheck: false,
          riskBudgetCheck: false,
          exposureCheck: false,
          correlationCheck: true,
        },
      }
    }

    const strategyExposure = strategyExposures.get(strategy) ?? 0
    const marketExposure =
      marketExposures.get(opportunity.marketIds[0] ?? "") ?? 0

    // 资金检查
    const capitalAvailable = allocation.availableCapital - strategyExposure
    const capitalCheck =
      capitalAvailable >= this.constraints.minAllocationAmount
    if (!capitalCheck) {
      warnings.push(`INSUFFICIENT_CAPITAL: ${capitalAvailable.toFixed(2)}`)
    }

    // 风险预算检查
    const riskBudgetRemaining =
      allocation.riskBudget - allocation.usedRiskBudget
    const riskBudgetCheck = riskBudgetRemaining > 0
    if (!riskBudgetCheck) {
      warnings.push(`RISK_BUDGET_EXHAUSTED: ${riskBudgetRemaining.toFixed(2)}`)
    }

    // 敞口检查
    const exposureCheck = marketExposure < allocation.maxMarketExposure
    if (!exposureCheck) {
      warnings.push(
        `MARKET_EXPOSURE_EXCEEDED: ${marketExposure.toFixed(2)} > ${allocation.maxMarketExposure}`
      )
    }

    // 相关性检查（简化版：检查是否已在同一市场有仓位）
    const correlationCheck =
      marketExposure === 0 || opportunity.strategy === "static_arb"

    // 计算允许金额
    let allowedAmount = Math.min(
      capitalAvailable,
      allocation.maxPositionSize,
      allocation.maxMarketExposure - marketExposure
    )
    allowedAmount = Math.max(0, allowedAmount)

    const allChecksPassed = capitalCheck && riskBudgetCheck && exposureCheck

    return {
      strategy,
      allowedAmount: allChecksPassed ? allowedAmount : 0,
      reason: allChecksPassed ? "OK" : "CHECKS_FAILED",
      warnings,
      checks: {
        capitalCheck,
        riskBudgetCheck,
        exposureCheck,
        correlationCheck,
      },
    }
  }

  updateUsage(
    strategy: StrategyType,
    usedCapital: number,
    usedRiskBudget: number
  ): void {
    const allocation = this.allocation.strategyAllocations.get(strategy)
    if (!allocation) return

    allocation.usedCapital = usedCapital
    allocation.usedRiskBudget = usedRiskBudget
    allocation.availableCapital = allocation.allocatedCapital - usedCapital
  }

  updateEquity(newEquity: number): void {
    const oldEquity = this.allocation.totalEquity
    const ratio = newEquity / oldEquity

    this.allocation.totalEquity = newEquity
    this.allocation.reservedCapital = newEquity * this.constraints.reservePct
    this.allocation.availableCapital =
      newEquity - this.allocation.reservedCapital

    // 按比例调整各策略分配
    for (const [, allocation] of this.allocation.strategyAllocations) {
      allocation.allocatedCapital *= ratio
      allocation.availableCapital =
        allocation.allocatedCapital - allocation.usedCapital
      allocation.maxPositionSize =
        allocation.allocatedCapital * this.constraints.maxSingleStrategyPct
      allocation.maxMarketExposure =
        newEquity * this.constraints.maxMarketExposurePct
    }
  }

  shouldRebalance(
    states: Map<StrategyType, StrategyState>,
    now: number
  ): RebalanceTrigger | null {
    // 每小时检查
    if (now - this.lastAdjustmentTs >= this.adjustmentIntervalMs) {
      return {
        type: "hourly",
        currentValue: now - this.lastAdjustmentTs,
        threshold: this.adjustmentIntervalMs,
        reason: "Hourly weight adjustment",
      }
    }

    // 检查策略级风控触发
    for (const [strategy, state] of states) {
      // 连续失败
      if (state.consecutiveFails >= 3) {
        return {
          type: "drawdown",
          strategy,
          currentValue: state.consecutiveFails,
          threshold: 3,
          reason: `Strategy ${strategy} consecutive failures: ${state.consecutiveFails}`,
        }
      }

      // 日内亏损超风险预算50%
      const allocation = this.allocation.strategyAllocations.get(strategy)
      if (
        allocation &&
        Math.abs(state.intradayPnl) > allocation.riskBudget * 0.5
      ) {
        return {
          type: "drawdown",
          strategy,
          currentValue: Math.abs(state.intradayPnl),
          threshold: allocation.riskBudget * 0.5,
          reason: `Strategy ${strategy} intraday loss exceeds 50% risk budget`,
        }
      }
    }

    return null
  }

  adjustWeights(
    states: Map<StrategyType, StrategyState>,
    now: number
  ): string[] {
    const adjustments: string[] = []
    this.lastAdjustmentTs = now

    for (const [strategy, state] of states) {
      const allocation = this.allocation.strategyAllocations.get(strategy)
      if (!allocation) continue

      const oldWeight = allocation.adjustedWeight
      let newWeight = allocation.baseWeight
      let reason = "base_weight"

      // 连续失败降权
      if (state.consecutiveFails >= 3) {
        newWeight = allocation.baseWeight * 0.5
        reason = "consecutive_fails"
      }
      // 胜率过低降权
      else if (state.opportunitiesExecuted > 5) {
        const winRate =
          state.opportunitiesExecuted > 0
            ? (state.opportunitiesExecuted - state.consecutiveFails) /
              state.opportunitiesExecuted
            : 0
        if (winRate < 0.3) {
          newWeight = allocation.baseWeight * 0.7
          reason = "low_win_rate"
        }
        // 表现良好提权
        else if (winRate > 0.7 && state.intradayPnl > 0) {
          newWeight = Math.min(allocation.baseWeight * 1.2, 0.5)
          reason = "good_performance"
        }
      }

      allocation.adjustedWeight = newWeight
      allocation.adjustmentReason = reason

      if (Math.abs(newWeight - oldWeight) > 0.01) {
        adjustments.push(
          `${strategy}: ${(oldWeight * 100).toFixed(1)}% → ${(newWeight * 100).toFixed(1)}% (${reason})`
        )
      }
    }

    // 归一化权重并重新分配资金
    this.normalizeAndRedistribute()

    return adjustments
  }

  private normalizeAndRedistribute(): void {
    const totalWeight = Array.from(
      this.allocation.strategyAllocations.values()
    ).reduce((sum, a) => sum + a.adjustedWeight, 0)

    if (totalWeight === 0) return

    const availableCapital = this.allocation.availableCapital

    for (const [, allocation] of this.allocation.strategyAllocations) {
      const normalizedWeight = allocation.adjustedWeight / totalWeight
      allocation.allocatedCapital = availableCapital * normalizedWeight
      allocation.availableCapital =
        allocation.allocatedCapital - allocation.usedCapital
    }
  }

  getAvailableCapital(): number {
    return this.allocation.availableCapital
  }

  getTotalEquity(): number {
    return this.allocation.totalEquity
  }

  getReservedCapital(): number {
    return this.allocation.reservedCapital
  }

  reset(): void {
    const weights: Partial<Record<StrategyType, number>> = {}
    for (const [strategy, allocation] of this.allocation.strategyAllocations) {
      weights[strategy] = allocation.baseWeight
    }
    this.allocation = this.initializeAllocation(
      this.allocation.totalEquity,
      weights
    )
    this.lastAdjustmentTs = Date.now()
  }
}

export function createDefaultAllocator(
  equity: number = 10_000
): CapitalAllocator {
  const defaultWeights: Record<StrategyType, number> = {
    static_arb: 0.4,
    stat_arb: 0.25,
    microstructure: 0.2,
    term_structure: 0.15,
  }
  return new CapitalAllocator(equity, defaultWeights)
}
