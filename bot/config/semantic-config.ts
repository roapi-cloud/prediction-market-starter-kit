import type { SemanticConfig, SemanticSource } from "../contracts/types"

const DEFAULT_CREDIBILITY_WEIGHTS: Record<string, number> = {
  news: 0.8,
  social: 0.5,
  forum: 0.6,
  official: 1.0,
}

const DEFAULT_SOURCES: SemanticSource[] = [
  {
    type: "news",
    endpoint: "https://newsapi.org/v2/everything",
    enabled: false,
  },
  {
    type: "social",
    endpoint: "https://api.twitter.com/2/search/recent",
    enabled: false,
  },
  {
    type: "forum",
    endpoint: "https://www.reddit.com/search",
    enabled: false,
  },
  {
    type: "official",
    endpoint: "",
    enabled: true,
  },
]

export const DEFAULT_SEMANTIC_CONFIG: SemanticConfig = {
  sources: DEFAULT_SOURCES,
  updateIntervalMs: 60000,
  signalTTLMs: 300000,
  credibilityWeights: DEFAULT_CREDIBILITY_WEIGHTS,
  enabled: false,
}

let cachedConfig: SemanticConfig | null = null

export function loadSemanticConfig(path?: string): SemanticConfig {
  if (cachedConfig && !path) return cachedConfig

  const configPath = path ?? process.env.SEMANTIC_CONFIG_PATH

  if (configPath) {
    try {
      const raw = require("fs").readFileSync(configPath, "utf8")
      const config = JSON.parse(raw) as SemanticConfig
      if (!path) cachedConfig = config
      return config
    } catch {
      return DEFAULT_SEMANTIC_CONFIG
    }
  }

  const envConfig = buildConfigFromEnv()
  if (envConfig) {
    cachedConfig = envConfig
    return envConfig
  }

  return DEFAULT_SEMANTIC_CONFIG
}

function buildConfigFromEnv(): SemanticConfig | null {
  const enabled = process.env.SEMANTIC_ENABLED === "true"
  if (!enabled) return null

  const sources: SemanticSource[] = []

  if (process.env.NEWS_API_KEY) {
    sources.push({
      type: "news",
      endpoint:
        process.env.NEWS_API_ENDPOINT ?? "https://newsapi.org/v2/everything",
      apiKey: process.env.NEWS_API_KEY,
      enabled: true,
    })
  }

  if (process.env.TWITTER_API_KEY) {
    sources.push({
      type: "social",
      endpoint:
        process.env.TWITTER_API_ENDPOINT ??
        "https://api.twitter.com/2/search/recent",
      apiKey: process.env.TWITTER_API_KEY,
      enabled: true,
    })
  }

  if (process.env.REDDIT_API_KEY) {
    sources.push({
      type: "forum",
      endpoint:
        process.env.REDDIT_API_ENDPOINT ?? "https://www.reddit.com/search",
      apiKey: process.env.REDDIT_API_KEY,
      enabled: true,
    })
  }

  sources.push({
    type: "official",
    endpoint: "",
    enabled: true,
  })

  return {
    sources,
    updateIntervalMs: parseInt(
      process.env.SEMANTIC_UPDATE_INTERVAL_MS ?? "60000",
      10
    ),
    signalTTLMs: parseInt(process.env.SEMANTIC_TTL_MS ?? "300000", 10),
    credibilityWeights: DEFAULT_CREDIBILITY_WEIGHTS,
    enabled,
  }
}

export function resetSemanticConfigCache(): void {
  cachedConfig = null
}

export function isSemanticEnabled(): boolean {
  const config = loadSemanticConfig()
  return config.enabled && config.sources.some((s) => s.enabled)
}

export function getEnabledSources(): SemanticSource[] {
  const config = loadSemanticConfig()
  return config.sources.filter((s) => s.enabled)
}

export function getSourceCredibility(sourceType: string): number {
  const config = loadSemanticConfig()
  return config.credibilityWeights[sourceType] ?? 0.5
}
