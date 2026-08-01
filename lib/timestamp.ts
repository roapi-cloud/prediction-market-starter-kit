export type TimestampInput = Date | number | string

export type TimestampFormat = "iso" | "unix_ms" | "unix_s"

export function normalizeTimestamp(input: TimestampInput): number {
  if (input instanceof Date) {
    return input.getTime()
  }
  if (typeof input === "number") {
    if (input < 1e12) {
      return input * 1000
    }
    return input
  }
  if (typeof input === "string") {
    const parsed = new Date(input).getTime()
    if (isNaN(parsed)) {
      throw new Error(`Invalid timestamp string: ${input}`)
    }
    return parsed
  }
  throw new Error(`Invalid timestamp input: ${input}`)
}

export function toIsoString(input: TimestampInput): string {
  return new Date(normalizeTimestamp(input)).toISOString()
}

export function toUnixMs(input: TimestampInput): number {
  return normalizeTimestamp(input)
}

export function toUnixSeconds(input: TimestampInput): number {
  return Math.floor(normalizeTimestamp(input) / 1000)
}

export function formatTimestamp(
  input: TimestampInput,
  format: TimestampFormat = "iso"
): string | number {
  switch (format) {
    case "iso":
      return toIsoString(input)
    case "unix_ms":
      return toUnixMs(input)
    case "unix_s":
      return toUnixSeconds(input)
    default:
      throw new Error(`Unknown timestamp format: ${format}`)
  }
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function nowUnixMs(): number {
  return Date.now()
}

export function nowUnixSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

export function elapsedMs(since: TimestampInput): number {
  return Date.now() - normalizeTimestamp(since)
}

export function elapsedSeconds(since: TimestampInput): number {
  return elapsedMs(since) / 1000
}

export function isValidTimestamp(input: unknown): input is TimestampInput {
  try {
    normalizeTimestamp(input as TimestampInput)
    return true
  } catch {
    return false
  }
}
