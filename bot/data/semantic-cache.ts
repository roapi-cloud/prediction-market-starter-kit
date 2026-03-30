import type {
  SemanticEvent,
  SemanticSignal,
  SemanticSnapshot,
} from "../contracts/types"

type CacheEntry<T> = {
  data: T
  ts: number
  ttlMs: number
}

export class SemanticCache {
  private eventCache: Map<string, CacheEntry<SemanticEvent[]>> = new Map()
  private signalCache: Map<string, CacheEntry<SemanticSignal>> = new Map()
  private snapshotCache: Map<string, CacheEntry<SemanticSnapshot[]>> = new Map()
  private defaultTTL: number

  constructor(defaultTTLMs = 300000) {
    this.defaultTTL = defaultTTLMs
  }

  getEvents(eventId: string): SemanticEvent[] | null {
    const entry = this.eventCache.get(eventId)
    if (!entry) return null
    if (this.isExpired(entry)) {
      this.eventCache.delete(eventId)
      return null
    }
    return entry.data
  }

  setEvents(eventId: string, events: SemanticEvent[], ttlMs?: number): void {
    this.eventCache.set(eventId, {
      data: events,
      ts: Date.now(),
      ttlMs: ttlMs ?? this.defaultTTL,
    })
  }

  getSignal(eventId: string): SemanticSignal | null {
    const entry = this.signalCache.get(eventId)
    if (!entry) return null
    if (this.isExpired(entry)) {
      this.signalCache.delete(eventId)
      return null
    }
    return this.applyDecay(entry)
  }

  setSignal(eventId: string, signal: SemanticSignal, ttlMs?: number): void {
    this.signalCache.set(eventId, {
      data: signal,
      ts: Date.now(),
      ttlMs: ttlMs ?? this.defaultTTL,
    })
  }

  getSnapshots(eventId: string): SemanticSnapshot[] | null {
    const entry = this.snapshotCache.get(eventId)
    if (!entry) return null
    if (this.isExpired(entry)) {
      this.snapshotCache.delete(eventId)
      return null
    }
    return entry.data
  }

  setSnapshots(
    eventId: string,
    snapshots: SemanticSnapshot[],
    ttlMs?: number
  ): void {
    this.snapshotCache.set(eventId, {
      data: snapshots,
      ts: Date.now(),
      ttlMs: ttlMs ?? this.defaultTTL,
    })
  }

  clearEvent(eventId: string): void {
    this.eventCache.delete(eventId)
    this.signalCache.delete(eventId)
    this.snapshotCache.delete(eventId)
  }

  clearAll(): void {
    this.eventCache.clear()
    this.signalCache.clear()
    this.snapshotCache.clear()
  }

  pruneExpired(): void {
    this.pruneMap(this.eventCache)
    this.pruneMap(this.signalCache)
    this.pruneMap(this.snapshotCache)
  }

  getStats(): {
    eventCacheSize: number
    signalCacheSize: number
    snapshotCacheSize: number
    expiredCount: number
  } {
    const expiredEvents = this.countExpired(this.eventCache)
    const expiredSignals = this.countExpired(this.signalCache)
    const expiredSnapshots = this.countExpired(this.snapshotCache)

    return {
      eventCacheSize: this.eventCache.size,
      signalCacheSize: this.signalCache.size,
      snapshotCacheSize: this.snapshotCache.size,
      expiredCount: expiredEvents + expiredSignals + expiredSnapshots,
    }
  }

  private isExpired<T>(entry: CacheEntry<T>): boolean {
    return Date.now() - entry.ts > entry.ttlMs
  }

  private applyDecay(entry: CacheEntry<SemanticSignal>): SemanticSignal {
    const elapsed = Date.now() - entry.ts
    const remaining = entry.ttlMs - elapsed
    const decayFactor = Math.max(0, remaining / entry.ttlMs)

    return {
      ...entry.data,
      signalStrength: entry.data.signalStrength * decayFactor,
      priorAdjustment: entry.data.priorAdjustment * decayFactor,
      confidence: entry.data.confidence * decayFactor,
    }
  }

  private pruneMap<T>(map: Map<string, CacheEntry<T>>): void {
    for (const [key, entry] of map) {
      if (this.isExpired(entry)) {
        map.delete(key)
      }
    }
  }

  private countExpired<T>(map: Map<string, CacheEntry<T>>): number {
    let count = 0
    for (const entry of map.values()) {
      if (this.isExpired(entry)) count++
    }
    return count
  }
}

let globalCache: SemanticCache | null = null

export function getSemanticCache(): SemanticCache {
  if (!globalCache) {
    globalCache = new SemanticCache()
  }
  return globalCache
}

export function resetSemanticCache(): void {
  globalCache = null
}
