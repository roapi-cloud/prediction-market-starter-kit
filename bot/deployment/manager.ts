import type {
  DeploymentConfig,
  DeploymentStatus,
  DeploymentStage,
  MetricsSnapshot,
  PassCriteria,
} from "../contracts/types"
import {
  DEFAULT_PASS_CRITERIA,
  checkPaperCriteria,
  checkGrayscaleCriteria,
  computeConfidenceScore,
} from "./criteria"
import { writeFileSync, readFileSync, existsSync } from "node:fs"

const DEFAULT_DEPLOYMENT_CONFIG: DeploymentConfig = {
  stage: "paper",
  capitalLimitPct: 1.0,
  grayscalePct: 0.05,
  passCriteria: DEFAULT_PASS_CRITERIA,
}

export class DeploymentManager {
  private config: DeploymentConfig
  private startTime: number
  private killSwitchCount = 0
  private snapshots: MetricsSnapshot[] = []
  private statePath: string

  constructor(
    config: Partial<DeploymentConfig> = {},
    statePath = "./data/deployment-state.json"
  ) {
    this.config = { ...DEFAULT_DEPLOYMENT_CONFIG, ...config }
    this.startTime = Date.now()
    this.statePath = statePath
    this.loadState()
  }

  private loadState(): void {
    if (existsSync(this.statePath)) {
      try {
        const raw = readFileSync(this.statePath, "utf8")
        const state = JSON.parse(raw) as {
          stage: DeploymentStage
          startTime: number
          killSwitchCount: number
        }
        this.config.stage = state.stage
        this.startTime = state.startTime
        this.killSwitchCount = state.killSwitchCount
      } catch {}
    }
  }

  private saveState(): void {
    const state = {
      stage: this.config.stage,
      startTime: this.startTime,
      killSwitchCount: this.killSwitchCount,
    }
    writeFileSync(this.statePath, JSON.stringify(state, null, 2), "utf8")
  }

  getStage(): DeploymentStage {
    return this.config.stage
  }

  getCapitalLimitPct(): number {
    switch (this.config.stage) {
      case "paper":
        return 0
      case "grayscale":
        return this.config.grayscalePct
      case "production":
        return this.config.capitalLimitPct
      default:
        return 0
    }
  }

  addSnapshot(snapshot: MetricsSnapshot): void {
    this.snapshots.push(snapshot)
  }

  recordKillSwitch(): void {
    this.killSwitchCount += 1
    this.saveState()
  }

  getStatus(): DeploymentStatus {
    const now = Date.now()
    const durationDays = (now - this.startTime) / (24 * 60 * 60 * 1000)

    const criteriaMet = this.checkCriteria().passed
    const canAdvance = this.canAdvanceToNextStage()
    const canRollback = this.canRollback()

    const metricsSinceStart = this.aggregateMetrics()

    return {
      stage: this.config.stage,
      startTime: this.startTime,
      durationDays,
      capitalUsedPct: this.getCapitalLimitPct(),
      criteriaMet,
      metricsSinceStart,
      canAdvance,
      canRollback,
    }
  }

  checkCriteria(): { passed: boolean; reasons: string[] } {
    switch (this.config.stage) {
      case "paper":
        return checkPaperCriteria(this.snapshots, this.config.passCriteria)
      case "grayscale":
        return checkGrayscaleCriteria(
          this.snapshots,
          this.killSwitchCount,
          this.config.passCriteria
        )
      case "production":
        return { passed: true, reasons: [] }
      default:
        return { passed: false, reasons: ["Unknown stage"] }
    }
  }

  private canAdvanceToNextStage(): boolean {
    const result = this.checkCriteria()
    const durationDays = (Date.now() - this.startTime) / (24 * 60 * 60 * 1000)

    if (!result.passed) return false
    if (durationDays < this.config.passCriteria.minDurationDays) return false

    switch (this.config.stage) {
      case "paper":
        return true
      case "grayscale":
        return (
          this.killSwitchCount <= this.config.passCriteria.maxKillSwitchTriggers
        )
      case "production":
        return false
      default:
        return false
    }
  }

  private canRollback(): boolean {
    return this.config.stage !== "paper"
  }

  advanceToGrayscale(): void {
    if (this.config.stage !== "paper") {
      throw new Error("Cannot advance to grayscale from current stage")
    }
    if (!this.canAdvanceToNextStage()) {
      throw new Error("Criteria not met for advancement")
    }
    this.config.stage = "grayscale"
    this.startTime = Date.now()
    this.snapshots = []
    this.killSwitchCount = 0
    this.saveState()
  }

  advanceToProduction(): void {
    if (this.config.stage !== "grayscale") {
      throw new Error("Cannot advance to production from current stage")
    }
    if (!this.canAdvanceToNextStage()) {
      throw new Error("Criteria not met for advancement")
    }
    this.config.stage = "production"
    this.startTime = Date.now()
    this.snapshots = []
    this.killSwitchCount = 0
    this.saveState()
  }

  rollbackToGrayscale(): void {
    if (this.config.stage !== "production") {
      throw new Error("Cannot rollback from current stage")
    }
    this.config.stage = "grayscale"
    this.startTime = Date.now()
    this.snapshots = []
    this.killSwitchCount = 0
    this.saveState()
  }

  rollbackToPaper(): void {
    if (this.config.stage === "paper") {
      throw new Error("Already at paper stage")
    }
    this.config.stage = "paper"
    this.startTime = Date.now()
    this.snapshots = []
    this.killSwitchCount = 0
    this.saveState()
  }

  forceAdvance(stage: DeploymentStage): void {
    this.config.stage = stage
    this.startTime = Date.now()
    this.snapshots = []
    this.killSwitchCount = 0
    this.saveState()
  }

  updateCapitalLimit(pct: number): void {
    this.config.capitalLimitPct = pct
  }

  updateGrayscalePct(pct: number): void {
    this.config.grayscalePct = pct
  }

  updateCriteria(criteria: Partial<PassCriteria>): void {
    this.config.passCriteria = { ...this.config.passCriteria, ...criteria }
  }

  getConfidenceScore(): number {
    return computeConfidenceScore(this.snapshots, this.config.passCriteria)
  }

  private aggregateMetrics(): MetricsSnapshot {
    if (this.snapshots.length === 0) {
      return this.createEmptySnapshot()
    }

    const count = this.snapshots.length
    const latest = this.snapshots[this.snapshots.length - 1]

    return {
      ts: latest.ts,
      pnl: avg(this.snapshots.map((s) => s.pnl)),
      pnlPct: avg(this.snapshots.map((s) => s.pnlPct)),
      drawdown: Math.max(...this.snapshots.map((s) => s.drawdown)),
      drawdownPct: Math.max(...this.snapshots.map((s) => s.drawdownPct)),
      winRate: avg(this.snapshots.map((s) => s.winRate)),
      legCompletionRate: avg(this.snapshots.map((s) => s.legCompletionRate)),
      avgSlippageBps: avg(this.snapshots.map((s) => s.avgSlippageBps)),
      avgDelayMs: avg(this.snapshots.map((s) => s.avgDelayMs)),
      orderFillRate: avg(this.snapshots.map((s) => s.orderFillRate)),
      hedgeSuccessRate: avg(this.snapshots.map((s) => s.hedgeSuccessRate)),
      dataLatencyMs: avg(this.snapshots.map((s) => s.dataLatencyMs)),
      eventThroughput: avg(this.snapshots.map((s) => s.eventThroughput)),
      activeStrategies: Math.round(
        avg(this.snapshots.map((s) => s.activeStrategies))
      ),
      riskState: latest.riskState,
      strategyMetrics: this.aggregateStrategies(),
    }
  }

  private aggregateStrategies(): Map<
    string,
    {
      opportunities: number
      executed: number
      pnl: number
      avgEvBps: number
      winRate: number
    }
  > {
    const result = new Map<
      string,
      {
        opportunities: number
        executed: number
        pnl: number
        avgEvBps: number
        winRate: number
      }
    >()

    for (const snap of this.snapshots) {
      for (const [strategy, metrics] of snap.strategyMetrics) {
        const existing = result.get(strategy)
        if (existing) {
          existing.opportunities += metrics.opportunities
          existing.executed += metrics.executed
          existing.pnl += metrics.pnl
          existing.avgEvBps = (existing.avgEvBps + metrics.avgEvBps) / 2
          existing.winRate = (existing.winRate + metrics.winRate) / 2
        } else {
          result.set(strategy, { ...metrics })
        }
      }
    }

    return result
  }

  private createEmptySnapshot(): MetricsSnapshot {
    return {
      ts: Date.now(),
      pnl: 0,
      pnlPct: 0,
      drawdown: 0,
      drawdownPct: 0,
      winRate: 0,
      legCompletionRate: 1,
      avgSlippageBps: 0,
      avgDelayMs: 0,
      orderFillRate: 0,
      hedgeSuccessRate: 1,
      dataLatencyMs: 0,
      eventThroughput: 0,
      activeStrategies: 0,
      riskState: "normal",
      strategyMetrics: new Map(),
    }
  }
}

function avg(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, v) => sum + v, 0) / values.length
}
