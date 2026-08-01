import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { z } from "zod"
import type { DataSourceConfig } from "../integration/types"
import { createChildLogger } from "../lib/logger"

const log = createChildLogger("config")

const DataSourceConfigSchema = z.object({
  type: z.enum(["rest", "websocket", "mock"]),
  rest: z
    .object({
      pollIntervalMs: z.number().positive(),
      tickLimit: z.number().positive(),
    })
    .optional(),
  websocket: z
    .object({
      url: z.string(),
      reconnectIntervalMs: z.number().positive(),
      pingIntervalMs: z.number().positive().optional(),
      subscriptions: z.array(z.string()).optional(),
    })
    .optional(),
})

const BotConfigSchema = z.object({
  portfolio: z.object({
    initialEquity: z.number().positive(),
    maxOpenNotional: z.number().positive(),
  }),
  execution: z.object({
    kellyCap: z.number().min(0).max(1),
    stoikovRiskAversion: z.number().positive(),
    slippageBps: z.number().min(0),
    partialFillBaseRate: z.number().min(0).max(1),
    partialFillSizeDecay: z.number().min(0),
  }),
  signal: z.object({
    costBps: z.number().min(0),
    minEvBps: z.number().min(0),
    confidenceThreshold: z.number().min(0).max(1),
  }),
  risk: z.object({
    intradayStopPct: z.number().min(0).max(100),
    maxDrawdownPct: z.number().min(0).max(100),
    maxPositionPct: z.number().min(0).max(100),
  }),
  data: z.object({
    tickLimit: z.number().positive(),
    spreadOverride: z.number().min(0).optional(),
    dataSource: DataSourceConfigSchema,
  }),
  exit: z
    .object({
      thresholdCycles: z.number().positive().optional(),
      minHoldTimeMs: z.number().positive().optional(),
      spreadExitRatio: z.number().min(0).max(1).optional(),
    })
    .optional(),
})

export type BotConfig = z.infer<typeof BotConfigSchema>

export type ConfigValidationError = {
  path: string
  message: string
  value?: unknown
}

export type ConfigValidationResult = {
  success: boolean
  config?: BotConfig
  errors: ConfigValidationError[]
}

function extractErrors(error: z.ZodError): ConfigValidationError[] {
  return error.issues.map((e) => ({
    path: e.path.join(".") || "root",
    message: e.message,
    value: e.path.length > 0 ? undefined : e.input,
  }))
}

export function validateConfig(raw: unknown): ConfigValidationResult {
  const result = BotConfigSchema.safeParse(raw)
  if (result.success) {
    return { success: true, config: result.data, errors: [] }
  }
  return { success: false, errors: extractErrors(result.error) }
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const DEFAULT_PATH = resolve(__dirname, "default.json")

let cached: BotConfig | null = null

export function loadConfig(path?: string): BotConfig {
  if (cached && !path) return cached

  const filePath = path ?? process.env.BOT_CONFIG_PATH ?? DEFAULT_PATH
  const raw = readFileSync(filePath, "utf8")

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (parseError) {
    log.error(
      { path: filePath, error: parseError },
      "Failed to parse config JSON"
    )
    throw new Error(`Failed to parse config file: ${filePath}`)
  }

  const validation = validateConfig(parsed)
  if (!validation.success) {
    log.error(
      { path: filePath, errors: validation.errors },
      "Config validation failed"
    )
    const errorMessages = validation.errors
      .map((e) => `${e.path}: ${e.message}`)
      .join("; ")
    throw new Error(`Config validation failed: ${errorMessages}`)
  }

  log.info({ path: filePath }, "Config loaded and validated successfully")
  const validatedConfig = validation.config!
  if (!path) cached = validatedConfig
  return validatedConfig
}

export function resetConfigCache(): void {
  cached = null
  log.debug("Config cache reset")
}
