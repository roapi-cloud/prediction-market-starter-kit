import type { DelayDistribution } from "../contracts/types"

export class DelayInjector {
  private config: DelayDistribution
  private delayHistory: number[] = []
  private spikeHistory: number[] = []

  constructor(config: DelayDistribution) {
    this.config = {
      meanMs: config.meanMs ?? 50,
      stdMs: config.stdMs ?? 30,
      p99Ms: config.p99Ms ?? 200,
      spikeProbability: config.spikeProbability ?? 0.01,
      spikeMs: config.spikeMs ?? 1000,
    }
  }

  injectDelay(): number {
    if (Math.random() < this.config.spikeProbability) {
      const spikeDelay = Math.max(
        0,
        this.config.spikeMs + this.generateGaussian(0, 100)
      )
      this.spikeHistory.push(spikeDelay)
      this.delayHistory.push(spikeDelay)
      return spikeDelay
    }

    const normalDelay = this.generateGaussian(
      this.config.meanMs,
      this.config.stdMs
    )
    const cappedDelay = Math.max(
      0,
      Math.min(normalDelay, this.config.p99Ms * 1.5)
    )
    this.delayHistory.push(cappedDelay)
    return cappedDelay
  }

  private generateGaussian(mean: number, std: number): number {
    const u1 = Math.random()
    const u2 = Math.random()
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
    return mean + z * std
  }

  injectBatchDelay(count: number): number[] {
    return Array.from({ length: count }, () => this.injectDelay())
  }

  getDelayStats(): {
    mean: number
    std: number
    p99: number
    spikeCount: number
    spikeRate: number
  } {
    if (this.delayHistory.length === 0) {
      return { mean: 0, std: 0, p99: 0, spikeCount: 0, spikeRate: 0 }
    }

    const sorted = [...this.delayHistory].sort((a, b) => a - b)
    const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length
    const variance =
      sorted.reduce((a, b) => a + (b - mean) ** 2, 0) / sorted.length
    const std = Math.sqrt(variance)
    const p99Index = Math.floor(sorted.length * 0.99)
    const p99 = sorted[p99Index] ?? sorted[sorted.length - 1]

    return {
      mean,
      std,
      p99,
      spikeCount: this.spikeHistory.length,
      spikeRate: this.spikeHistory.length / this.delayHistory.length,
    }
  }

  reset(): void {
    this.delayHistory = []
    this.spikeHistory = []
  }

  simulateNetworkCondition(condition: "good" | "medium" | "bad"): void {
    const configs: Record<string, Partial<DelayDistribution>> = {
      good: { meanMs: 20, stdMs: 10, p99Ms: 50, spikeProbability: 0.001 },
      medium: { meanMs: 50, stdMs: 30, p99Ms: 200, spikeProbability: 0.01 },
      bad: { meanMs: 150, stdMs: 100, p99Ms: 500, spikeProbability: 0.05 },
    }

    const update = configs[condition]
    this.config = {
      ...this.config,
      ...update,
    }
  }
}

export function createDefaultDelayConfig(): DelayDistribution {
  return {
    meanMs: 50,
    stdMs: 30,
    p99Ms: 200,
    spikeProbability: 0.01,
    spikeMs: 1000,
  }
}
