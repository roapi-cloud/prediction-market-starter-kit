import type { AlertConfig } from "../contracts/types"
import { DEFAULT_ALERT_RULES } from "../alert/rules"

export const DEFAULT_ALERT_CONFIG: AlertConfig = {
  rules: DEFAULT_ALERT_RULES,
  channels: [{ type: "log", enabled: true }],
  cooldownMs: 60000,
}

export function createAlertConfig(
  customRules: Partial<AlertConfig> = {}
): AlertConfig {
  return {
    rules: customRules.rules ?? DEFAULT_ALERT_RULES,
    channels: customRules.channels ?? DEFAULT_ALERT_CONFIG.channels,
    cooldownMs: customRules.cooldownMs ?? DEFAULT_ALERT_CONFIG.cooldownMs,
  }
}

export function addWebhookChannel(
  config: AlertConfig,
  endpoint: string,
  type: "slack" | "telegram" | "generic" = "generic"
): AlertConfig {
  const channels = [...config.channels]
  channels.push({
    type: "webhook",
    endpoint,
    enabled: true,
  })
  return { ...config, channels }
}

export function loadAlertConfig(path: string): AlertConfig {
  try {
    const raw = require("node:fs").readFileSync(path, "utf8")
    const config = JSON.parse(raw) as Partial<AlertConfig>
    return createAlertConfig(config)
  } catch {
    return DEFAULT_ALERT_CONFIG
  }
}
