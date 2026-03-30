import type { MetricsConfig } from "../contracts/types"

export const DEFAULT_METRICS_CONFIG: MetricsConfig = {
  collectionIntervalMs: 1000,
  persistenceEnabled: true,
  persistencePath: "./data/metrics",
  pushEnabled: false,
  pushEndpoint: undefined,
}

export function createMetricsConfig(
  overrides: Partial<MetricsConfig> = {}
): MetricsConfig {
  return { ...DEFAULT_METRICS_CONFIG, ...overrides }
}

export function loadMetricsConfig(path: string): MetricsConfig {
  try {
    const raw = require("node:fs").readFileSync(path, "utf8")
    const config = JSON.parse(raw) as Partial<MetricsConfig>
    return createMetricsConfig(config)
  } catch {
    return DEFAULT_METRICS_CONFIG
  }
}
