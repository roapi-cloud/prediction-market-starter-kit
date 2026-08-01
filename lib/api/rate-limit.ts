import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { API } from "@/bot/config/constants"

type RateLimitEntry = {
  count: number
  firstRequestTime: number
}

const rateLimitStore = new Map<string, RateLimitEntry>()

function cleanupRateLimitStore(): void {
  const now = Date.now()
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now - entry.firstRequestTime > API.RATE_LIMIT_WINDOW_MS) {
      rateLimitStore.delete(key)
    }
  }
}

setInterval(cleanupRateLimitStore, API.RATE_LIMIT_WINDOW_MS)

function getClientIdentifier(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for")
  const realIp = request.headers.get("x-real-ip")
  const ip = forwarded?.split(",")[0]?.trim() ?? realIp ?? "unknown"
  return ip
}

export function checkRateLimit(request: NextRequest): {
  allowed: boolean
  remaining: number
  resetTime: number
} {
  const clientId = getClientIdentifier(request)
  const now = Date.now()
  const entry = rateLimitStore.get(clientId)

  if (!entry || now - entry.firstRequestTime > API.RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(clientId, {
      count: 1,
      firstRequestTime: now,
    })
    return {
      allowed: true,
      remaining: API.RATE_LIMIT_MAX_REQUESTS - 1,
      resetTime: now + API.RATE_LIMIT_WINDOW_MS,
    }
  }

  if (entry.count >= API.RATE_LIMIT_MAX_REQUESTS) {
    return {
      allowed: false,
      remaining: 0,
      resetTime: entry.firstRequestTime + API.RATE_LIMIT_WINDOW_MS,
    }
  }

  entry.count += 1
  return {
    allowed: true,
    remaining: API.RATE_LIMIT_MAX_REQUESTS - entry.count,
    resetTime: entry.firstRequestTime + API.RATE_LIMIT_WINDOW_MS,
  }
}

export function withRateLimit(
  handler: (request: NextRequest) => Promise<NextResponse>
): (request: NextRequest) => Promise<NextResponse> {
  return async (request: NextRequest) => {
    const rateLimitResult = checkRateLimit(request)

    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        {
          error: "Rate limit exceeded",
          retryAfter: Math.ceil(
            (rateLimitResult.resetTime - Date.now()) / 1000
          ),
        },
        {
          status: 429,
          headers: {
            "X-RateLimit-Limit": String(API.RATE_LIMIT_MAX_REQUESTS),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(rateLimitResult.resetTime),
            "Retry-After": String(
              Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000)
            ),
          },
        }
      )
    }

    const response = await handler(request)

    response.headers.set(
      "X-RateLimit-Limit",
      String(API.RATE_LIMIT_MAX_REQUESTS)
    )
    response.headers.set(
      "X-RateLimit-Remaining",
      String(rateLimitResult.remaining)
    )
    response.headers.set("X-RateLimit-Reset", String(rateLimitResult.resetTime))

    return response
  }
}
