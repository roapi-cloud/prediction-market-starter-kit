import type { AlertChannel, AlertEvent } from "../contracts/types"
import { appendFileSync, existsSync, mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"

export class AlertChannels {
  private logPath: string

  constructor(logPath = "./logs/alerts.log") {
    this.logPath = resolve(logPath)
    this.ensureLogDir()
  }

  private ensureLogDir(): void {
    const dir = dirname(this.logPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }

  send(alert: AlertEvent, channel: AlertChannel): void {
    switch (channel.type) {
      case "log":
        this.sendToLog(alert)
        break
      case "webhook":
        if (channel.endpoint) {
          this.sendToWebhook(alert, channel.endpoint)
        }
        break
      case "email":
        break
    }
  }

  private sendToLog(alert: AlertEvent): void {
    const line = `[${new Date(alert.ts).toISOString()}] [${alert.severity.toUpperCase()}] ${alert.rule}: ${alert.message}\n`
    appendFileSync(this.logPath, line, "utf8")
    console.log(line.trim())
  }

  private sendToWebhook(alert: AlertEvent, endpoint: string): void {
    const payload = {
      id: alert.id,
      rule: alert.rule,
      severity: alert.severity,
      message: alert.message,
      ts: alert.ts,
      value: alert.value,
      threshold: alert.threshold,
    }

    try {
      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch((err) => console.error(`[ALERT] Webhook failed: ${err}`))
    } catch (err) {
      console.error(`[ALERT] Webhook failed: ${err}`)
    }
  }

  formatForSlack(alert: AlertEvent): Record<string, unknown> {
    const color =
      alert.severity === "critical"
        ? "danger"
        : alert.severity === "warning"
          ? "warning"
          : "good"
    return {
      attachments: [
        {
          color,
          title: `Alert: ${alert.rule}`,
          text: alert.message,
          fields: [
            { title: "Value", value: String(alert.value), short: true },
            { title: "Threshold", value: String(alert.threshold), short: true },
          ],
          ts: alert.ts / 1000,
        },
      ],
    }
  }

  formatForTelegram(alert: AlertEvent): string {
    const icon =
      alert.severity === "critical"
        ? "🚨"
        : alert.severity === "warning"
          ? "⚠️"
          : "ℹ️"
    return `${icon} **${alert.rule}**\n${alert.message}\nValue: ${alert.value} | Threshold: ${alert.threshold}`
  }
}
