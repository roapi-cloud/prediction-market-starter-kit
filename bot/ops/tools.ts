import type {
  HealthStatus,
  StrategyConfig,
  MetricsSnapshot,
} from "../contracts/types"
import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
} from "node:fs"
import { resolve, dirname } from "node:path"

export class OpsTools {
  private startTime: number
  private cycleCount = 0
  private lastCycleTime = 0
  private errors: string[] = []
  private killSwitchActive = false
  private killSwitchReason: string | null = null
  private metrics: {
    equity: number
    drawdownPct: number
    positions: number
    pendingOrders: number
  } = {
    equity: 0,
    drawdownPct: 0,
    positions: 0,
    pendingOrders: 0,
  }
  private configPath: string
  private logPath: string

  constructor(
    configPath = "./data/bot-state.json",
    logPath = "./logs/bot.log"
  ) {
    this.startTime = Date.now()
    this.configPath = resolve(configPath)
    this.logPath = resolve(logPath)
    this.ensureDirectories()
  }

  private ensureDirectories(): void {
    const configDir = dirname(this.configPath)
    const logDir = dirname(this.logPath)
    if (!existsSync(configDir)) {
      require("node:fs").mkdirSync(configDir, { recursive: true })
    }
    if (!existsSync(logDir)) {
      require("node:fs").mkdirSync(logDir, { recursive: true })
    }
  }

  checkHealth(): HealthStatus {
    const now = Date.now()
    const uptime = now - this.startTime

    const healthy = !this.killSwitchActive && this.errors.length < 5

    return {
      healthy,
      uptime,
      lastCycle: this.lastCycleTime,
      cycles: this.cycleCount,
      errors: this.errors.slice(-10),
      metrics: this.metrics,
    }
  }

  recordCycle(snapshot?: MetricsSnapshot): void {
    this.cycleCount += 1
    this.lastCycleTime = Date.now()
    if (snapshot) {
      this.updateMetrics(snapshot)
    }
  }

  private updateMetrics(snapshot: MetricsSnapshot): void {
    this.metrics = {
      equity: snapshot.pnl + 10000,
      drawdownPct: snapshot.drawdownPct,
      positions: snapshot.activeStrategies,
      pendingOrders: Math.round(snapshot.eventThroughput),
    }
  }

  recordError(error: string): void {
    this.errors.push(`[${new Date().toISOString()}] ${error}`)
    if (this.errors.length > 100) {
      this.errors = this.errors.slice(-100)
    }
  }

  triggerKillSwitch(reason: string = "Manual trigger"): void {
    this.killSwitchActive = true
    this.killSwitchReason = reason
    this.recordError(`Kill switch triggered: ${reason}`)
    this.saveKillSwitchState()
  }

  releaseKillSwitch(): void {
    this.killSwitchActive = false
    this.killSwitchReason = null
    this.saveKillSwitchState()
  }

  isKillSwitchActive(): boolean {
    return this.killSwitchActive
  }

  getKillSwitchReason(): string | null {
    return this.killSwitchReason
  }

  private saveKillSwitchState(): void {
    const state = {
      killSwitchActive: this.killSwitchActive,
      killSwitchReason: this.killSwitchReason,
      ts: Date.now(),
    }
    writeFileSync(this.configPath, JSON.stringify(state, null, 2), "utf8")
  }

  viewLogs(lines: number = 100): string {
    if (!existsSync(this.logPath)) {
      return "No logs found"
    }
    const content = readFileSync(this.logPath, "utf8")
    const allLines = content.split("\n")
    return allLines.slice(-lines).join("\n")
  }

  viewAlerts(path: string = "./logs/alerts.log", lines: number = 50): string {
    const alertPath = resolve(path)
    if (!existsSync(alertPath)) {
      return "No alerts found"
    }
    const content = readFileSync(alertPath, "utf8")
    const allLines = content.split("\n")
    return allLines.slice(-lines).join("\n")
  }

  hotUpdateParams(params: Partial<StrategyConfig>): void {
    const state = this.loadState()
    const existingParams = state.params as Record<string, unknown> | undefined
    state.params = { ...(existingParams ?? {}), ...params }
    state.updatedAt = Date.now()
    writeFileSync(this.configPath, JSON.stringify(state, null, 2), "utf8")
  }

  updateConfig(key: string, value: unknown): void {
    const state = this.loadState()
    state[key] = value
    state.updatedAt = Date.now()
    writeFileSync(this.configPath, JSON.stringify(state, null, 2), "utf8")
  }

  private loadState(): Record<string, unknown> {
    if (!existsSync(this.configPath)) {
      return { params: {}, updatedAt: Date.now() }
    }
    const raw = readFileSync(this.configPath, "utf8")
    return JSON.parse(raw)
  }

  getState(): Record<string, unknown> {
    return this.loadState()
  }

  listDataFiles(): string[] {
    const dataDir = dirname(this.configPath)
    if (!existsSync(dataDir)) return []
    return readdirSync(dataDir)
      .filter((f) => statSync(resolve(dataDir, f)).isFile())
      .sort(
        (a, b) =>
          statSync(resolve(dataDir, b)).mtimeMs -
          statSync(resolve(dataDir, a)).mtimeMs
      )
  }

  listMetricFiles(): string[] {
    const metricsDir = "./data/metrics"
    if (!existsSync(metricsDir)) return []
    return readdirSync(metricsDir)
      .filter((f) => f.startsWith("metrics-") && f.endsWith(".json"))
      .sort(
        (a, b) =>
          statSync(resolve(metricsDir, b)).mtimeMs -
          statSync(resolve(metricsDir, a)).mtimeMs
      )
  }

  getUptime(): {
    seconds: number
    minutes: number
    hours: number
    days: number
  } {
    const uptimeMs = Date.now() - this.startTime
    const seconds = Math.floor(uptimeMs / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)
    return { seconds, minutes, hours, days }
  }

  reset(): void {
    this.startTime = Date.now()
    this.cycleCount = 0
    this.lastCycleTime = 0
    this.errors = []
    this.killSwitchActive = false
    this.killSwitchReason = null
  }
}
