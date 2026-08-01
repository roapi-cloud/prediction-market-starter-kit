import pino from "pino"

const isProduction = process.env.NODE_ENV === "production"

export const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? "info" : "debug"),
  transport: isProduction
    ? undefined
    : {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
        },
      },
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
})

export function createChildLogger(module: string) {
  return logger.child({ module })
}

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal"

export function logAtLevel(
  level: LogLevel,
  module: string,
  message: string,
  data?: Record<string, unknown>
) {
  const childLogger = createChildLogger(module)
  childLogger[level](data ?? {}, message)
}
