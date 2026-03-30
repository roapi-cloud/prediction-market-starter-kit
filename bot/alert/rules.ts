import type { AlertRule, AlertConfig } from "../contracts/types"

export const DEFAULT_ALERT_RULES: AlertRule[] = [
  {
    name: "intraday_loss_threshold",
    metric: "pnlPct",
    condition: "lt",
    threshold: -2,
    severity: "critical",
    message:
      "Intraday loss exceeds threshold: {{value}}% (limit: {{threshold}}%)",
  },
  {
    name: "drawdown_threshold",
    metric: "drawdownPct",
    condition: "gt",
    threshold: 4,
    severity: "critical",
    message: "Drawdown exceeds threshold: {{value}}% (limit: {{threshold}}%)",
  },
  {
    name: "consecutive_failures",
    metric: "hedgeSuccessRate",
    condition: "lt",
    threshold: 0.5,
    severity: "warning",
    message: "Hedge success rate too low: {{value}} (limit: {{threshold}})",
  },
  {
    name: "leg_completion_rate_low",
    metric: "legCompletionRate",
    condition: "lt",
    threshold: 0.95,
    severity: "warning",
    message:
      "Leg completion rate below threshold: {{value}} (limit: {{threshold}})",
  },
  {
    name: "slippage_high",
    metric: "avgSlippageBps",
    condition: "gt",
    threshold: 50,
    severity: "warning",
    message:
      "Average slippage too high: {{value}} bps (limit: {{threshold}} bps)",
  },
  {
    name: "data_latency_high",
    metric: "dataLatencyMs",
    condition: "gt",
    threshold: 1000,
    severity: "info",
    message: "Data latency high: {{value}} ms (limit: {{threshold}} ms)",
  },
  {
    name: "kill_switch_triggered",
    metric: "riskState",
    condition: "eq",
    threshold: 1,
    severity: "critical",
    message: "Kill switch triggered - trading halted",
  },
  {
    name: "order_fill_rate_low",
    metric: "orderFillRate",
    condition: "lt",
    threshold: 0.7,
    severity: "warning",
    message: "Order fill rate too low: {{value}} (limit: {{threshold}})",
  },
]

export function createAlertConfig(
  customRules?: Partial<AlertRule>[],
  cooldownMs = 60000
): AlertConfig {
  const rules = customRules
    ? customRules.map((r) => ({
        ...(DEFAULT_ALERT_RULES.find((d) => d.name === r.name) ?? {
          name: r.name ?? "custom_rule",
          metric: r.metric ?? "pnl",
          condition: r.condition ?? "gt",
          threshold: r.threshold ?? 0,
          severity: r.severity ?? "warning",
          message: r.message ?? "Custom alert triggered",
        }),
        ...r,
      }))
    : DEFAULT_ALERT_RULES

  return {
    rules,
    channels: [{ type: "log", enabled: true }],
    cooldownMs,
  }
}

export function evaluateRule(rule: AlertRule, value: number): boolean {
  switch (rule.condition) {
    case "gt":
      return value > rule.threshold
    case "lt":
      return value < rule.threshold
    case "eq":
      return value === rule.threshold
    default:
      return false
  }
}

export function formatMessage(
  template: string,
  value: number,
  threshold: number
): string {
  return template
    .replace(/\{\{value\}\}/g, String(value))
    .replace(/\{\{threshold\}\}/g, String(threshold))
}

export function getMetricValue(
  metricName: string,
  data: Record<string, number | string>
): number {
  const value = data[metricName]
  if (typeof value === "number") return value
  if (typeof value === "string") {
    if (value === "kill_switch") return 1
    if (value === "warning") return 0.5
    return 0
  }
  return 0
}
