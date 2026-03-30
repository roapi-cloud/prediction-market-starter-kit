import type { SemanticSource, SemanticEvent } from "../contracts/types"
import { getSemanticCache } from "../data/semantic-cache"
import { getSourceCredibility } from "../config/semantic-config"

type FetchResult = {
  events: SemanticEvent[]
  source: string
  success: boolean
  error?: string
}

export class SemanticFetcher {
  private rateLimiters: Map<string, RateLimiter> = new Map()
  private requestTimeoutMs: number = 10000

  constructor(requestTimeoutMs?: number) {
    if (requestTimeoutMs) {
      this.requestTimeoutMs = requestTimeoutMs
    }
  }

  async fetchAllSources(
    eventId: string,
    sources: SemanticSource[],
    keywords: string[]
  ): Promise<SemanticEvent[]> {
    const cache = getSemanticCache()
    const cached = cache.getEvents(eventId)
    if (cached && cached.length > 0) {
      return cached
    }

    const results = await Promise.allSettled(
      sources
        .filter((s) => s.enabled)
        .map((source) => this.fetchFromSource(eventId, source, keywords))
    )

    const allEvents: SemanticEvent[] = []
    for (const result of results) {
      if (result.status === "fulfilled") {
        const fetchResult = result.value
        if (fetchResult.success) {
          allEvents.push(...fetchResult.events)
        }
      }
    }

    if (allEvents.length > 0) {
      cache.setEvents(eventId, allEvents)
    }

    return allEvents
  }

  async fetchFromSource(
    eventId: string,
    source: SemanticSource,
    keywords: string[]
  ): Promise<FetchResult> {
    const limiter = this.getRateLimiter(source.type)
    if (!limiter.canRequest()) {
      return {
        events: [],
        source: source.type,
        success: false,
        error: "Rate limited",
      }
    }

    try {
      const events = await this.doFetch(eventId, source, keywords)
      limiter.recordRequest()
      return {
        events,
        source: source.type,
        success: true,
      }
    } catch (error) {
      return {
        events: [],
        source: source.type,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    }
  }

  private async doFetch(
    eventId: string,
    source: SemanticSource,
    keywords: string[]
  ): Promise<SemanticEvent[]> {
    switch (source.type) {
      case "news":
        return this.fetchNews(eventId, source, keywords)
      case "social":
        return this.fetchSocial(eventId, source, keywords)
      case "forum":
        return this.fetchForum(eventId, source, keywords)
      case "official":
        return this.fetchOfficial(eventId, source, keywords)
      default:
        return []
    }
  }

  private async fetchNews(
    eventId: string,
    source: SemanticSource,
    keywords: string[]
  ): Promise<SemanticEvent[]> {
    if (!source.apiKey) {
      return this.mockFetch(eventId, source, keywords)
    }

    const query = keywords.join(" OR ")
    const url = `${source.endpoint}?q=${encodeURIComponent(query)}&sortBy=relevance&pageSize=20`

    try {
      const response = await this.fetchWithTimeout(url, {
        headers: {
          "X-Api-Key": source.apiKey,
        },
      })

      const data = await response.json()
      const articles = data.articles ?? []

      return articles.map((article: Record<string, unknown>) =>
        this.articleToEvent(eventId, source.type, article)
      )
    } catch {
      return this.mockFetch(eventId, source, keywords)
    }
  }

  private async fetchSocial(
    eventId: string,
    source: SemanticSource,
    keywords: string[]
  ): Promise<SemanticEvent[]> {
    if (!source.apiKey) {
      return this.mockFetch(eventId, source, keywords)
    }

    return this.mockFetch(eventId, source, keywords)
  }

  private async fetchForum(
    eventId: string,
    source: SemanticSource,
    keywords: string[]
  ): Promise<SemanticEvent[]> {
    if (!source.apiKey) {
      return this.mockFetch(eventId, source, keywords)
    }

    return this.mockFetch(eventId, source, keywords)
  }

  private async fetchOfficial(
    eventId: string,
    source: SemanticSource,
    keywords: string[]
  ): Promise<SemanticEvent[]> {
    return this.mockFetch(eventId, source, keywords)
  }

  private mockFetch(
    eventId: string,
    source: SemanticSource,
    keywords: string[]
  ): SemanticEvent[] {
    const credibility = getSourceCredibility(source.type)
    const ts = Date.now()

    return keywords.slice(0, 3).map((keyword, i) => ({
      eventId,
      ts: ts - i * 60000,
      source: source.type,
      text: `Mock semantic data for ${keyword} from ${source.type}`,
      sentiment: "neutral",
      sentimentScore: 0,
      relevance: 0.5 + Math.random() * 0.3,
      credibility,
    }))
  }

  private articleToEvent(
    eventId: string,
    sourceType: string,
    article: Record<string, unknown>
  ): SemanticEvent {
    const text = `${article.title ?? ""} ${article.description ?? ""}`
    const credibility = getSourceCredibility(sourceType)

    return {
      eventId,
      ts: Date.now(),
      source: sourceType,
      text,
      sentiment: "neutral",
      sentimentScore: 0,
      relevance: 0.7,
      credibility,
    }
  }

  private async fetchWithTimeout(
    url: string,
    options: Record<string, unknown>
  ): Promise<Response> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs)

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      })
      clearTimeout(timeout)
      return response
    } catch (error) {
      clearTimeout(timeout)
      throw error
    }
  }

  private getRateLimiter(sourceType: string): RateLimiter {
    if (!this.rateLimiters.has(sourceType)) {
      this.rateLimiters.set(sourceType, new RateLimiter(10, 60000))
    }
    return this.rateLimiters.get(sourceType)!
  }
}

class RateLimiter {
  private requests: number[] = []
  private maxRequests: number
  private windowMs: number

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests
    this.windowMs = windowMs
  }

  canRequest(): boolean {
    this.prune()
    return this.requests.length < this.maxRequests
  }

  recordRequest(): void {
    this.requests.push(Date.now())
  }

  private prune(): void {
    const cutoff = Date.now() - this.windowMs
    this.requests = this.requests.filter((ts) => ts > cutoff)
  }
}

let globalFetcher: SemanticFetcher | null = null

export function getSemanticFetcher(): SemanticFetcher {
  if (!globalFetcher) {
    globalFetcher = new SemanticFetcher()
  }
  return globalFetcher
}

export function resetSemanticFetcher(): void {
  globalFetcher = null
}
