import type { MetricsSnapshot, StrategyMetrics } from "../contracts/types"
import {
  appendFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs"
import { dirname, resolve } from "node:path"

export class MetricsPersistence {
  private basePath: string
  private currentFile: string

  constructor(basePath: string) {
    this.basePath = resolve(basePath)
    this.currentFile = this.getDailyFile(Date.now())
    this.ensureDirectory()
  }

  private ensureDirectory(): void {
    const dir = dirname(this.basePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }

  private getDailyFile(ts: number): string {
    const date = new Date(ts).toISOString().slice(0, 10)
    return resolve(this.basePath, `metrics-${date}.json`)
  }

  persist(snapshot: MetricsSnapshot): void {
    const file = this.getDailyFile(snapshot.ts)
    if (file !== this.currentFile) {
      this.currentFile = file
    }

    const line = JSON.stringify(this.serializeSnapshot(snapshot)) + "\n"
    appendFileSync(file, line, "utf8")
  }

  persistBatch(snapshots: MetricsSnapshot[]): void {
    for (const snap of snapshots) {
      this.persist(snap)
    }
  }

  loadRange(start: number, end: number): MetricsSnapshot[] {
    const result: MetricsSnapshot[] = []
    const startDate = new Date(start)
    const endDate = new Date(end)

    while (startDate <= endDate) {
      const file = this.getDailyFile(startDate.getTime())
      if (existsSync(file)) {
        const snaps = this.loadFile(file)
        for (const snap of snaps) {
          if (snap.ts >= start && snap.ts <= end) {
            result.push(snap)
          }
        }
      }
      startDate.setDate(startDate.getDate() + 1)
    }

    return result
  }

  loadDay(dateStr: string): MetricsSnapshot[] {
    const ts = new Date(dateStr).getTime()
    const file = this.getDailyFile(ts)
    if (!existsSync(file)) return []
    return this.loadFile(file)
  }

  loadFile(file: string): MetricsSnapshot[] {
    const content = readFileSync(file, "utf8")
    const lines = content.trim().split("\n")
    return lines.map((line) => this.deserializeSnapshot(JSON.parse(line)))
  }

  private serializeSnapshot(snap: MetricsSnapshot): Record<string, unknown> {
    const strategyObj: Record<string, StrategyMetrics> = {}
    for (const [key, value] of snap.strategyMetrics) {
      strategyObj[key] = value
    }
    return {
      ...snap,
      strategyMetrics: strategyObj,
    }
  }

  private deserializeSnapshot(data: Record<string, unknown>): MetricsSnapshot {
    const strategyMetrics = new Map<string, StrategyMetrics>()
    const stratData = data.strategyMetrics as Record<string, StrategyMetrics>
    if (stratData) {
      for (const [key, value] of Object.entries(stratData)) {
        strategyMetrics.set(key, value)
      }
    }
    return {
      ts: data.ts as number,
      pnl: data.pnl as number,
      pnlPct: data.pnlPct as number,
      drawdown: data.drawdown as number,
      drawdownPct: data.drawdownPct as number,
      winRate: data.winRate as number,
      legCompletionRate: data.legCompletionRate as number,
      avgSlippageBps: data.avgSlippageBps as number,
      avgDelayMs: data.avgDelayMs as number,
      orderFillRate: data.orderFillRate as number,
      hedgeSuccessRate: data.hedgeSuccessRate as number,
      dataLatencyMs: data.dataLatencyMs as number,
      eventThroughput: data.eventThroughput as number,
      activeStrategies: data.activeStrategies as number,
      riskState: data.riskState as MetricsSnapshot["riskState"],
      strategyMetrics,
    }
  }

  cleanup(olderThanDays: number): number {
    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000
    const cutoffDate = new Date(cutoff)
    let deletedCount = 0

    const startDate = new Date(this.basePath)
    while (startDate < cutoffDate) {
      const file = this.getDailyFile(startDate.getTime())
      if (existsSync(file)) {
        writeFileSync(file, "", "utf8")
        deletedCount++
      }
      startDate.setDate(startDate.getDate() + 1)
    }

    return deletedCount
  }

  getStats(): {
    totalFiles: number
    totalSnapshots: number
    oldestTs: number
    newestTs: number
  } {
    const files = this.listMetricFiles()
    let totalSnapshots = 0
    let oldestTs = Date.now()
    let newestTs = 0

    for (const file of files) {
      if (existsSync(file)) {
        const snaps = this.loadFile(file)
        totalSnapshots += snaps.length
        for (const snap of snaps) {
          if (snap.ts < oldestTs) oldestTs = snap.ts
          if (snap.ts > newestTs) newestTs = snap.ts
        }
      }
    }

    return {
      totalFiles: files.length,
      totalSnapshots,
      oldestTs: files.length > 0 ? oldestTs : 0,
      newestTs,
    }
  }

  private listMetricFiles(): string[] {
    const dir = dirname(this.basePath)
    if (!existsSync(dir)) return []
    const fs = require("node:fs")
    return fs
      .readdirSync(dir)
      .filter((f: string) => f.startsWith("metrics-") && f.endsWith(".json"))
      .map((f: string) => resolve(dir, f))
  }
}
