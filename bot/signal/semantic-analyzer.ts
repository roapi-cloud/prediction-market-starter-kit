import type {
  SemanticEvent,
  SemanticSignal,
  SemanticSnapshot,
} from "../contracts/types"
import { getSourceCredibility } from "../config/semantic-config"

type SentimentKeywords = {
  positive: string[]
  negative: string[]
}

const DEFAULT_POSITIVE_KEYWORDS: string[] = [
  "success",
  "win",
  "victory",
  "approve",
  "confirm",
  "positive",
  "growth",
  "increase",
  "likely",
  "probable",
  "expected",
  "bullish",
  "optimistic",
  "gain",
  "advance",
]

const DEFAULT_NEGATIVE_KEYWORDS: string[] = [
  "fail",
  "loss",
  "reject",
  "deny",
  "negative",
  "decline",
  "decrease",
  "unlikely",
  "doubt",
  "risk",
  "bearish",
  "pessimistic",
  "drop",
  "cancel",
  "delay",
]

export function analyzeSentiment(text: string): {
  sentiment: "positive" | "negative" | "neutral"
  score: number
} {
  const normalizedText = text.toLowerCase()
  const keywords: SentimentKeywords = {
    positive: DEFAULT_POSITIVE_KEYWORDS,
    negative: DEFAULT_NEGATIVE_KEYWORDS,
  }

  const positiveCount = keywords.positive.filter((k) =>
    normalizedText.includes(k.toLowerCase())
  ).length

  const negativeCount = keywords.negative.filter((k) =>
    normalizedText.includes(k.toLowerCase())
  ).length

  const totalKeywords = positiveCount + negativeCount

  if (totalKeywords === 0) {
    return { sentiment: "neutral", score: 0 }
  }

  const rawScore = (positiveCount - negativeCount) / Math.max(totalKeywords, 1)
  const score = Math.max(-1, Math.min(1, rawScore * 2))

  const sentiment: "positive" | "negative" | "neutral" =
    score > 0.2 ? "positive" : score < -0.2 ? "negative" : "neutral"

  return { sentiment, score }
}

export function computeRelevance(
  text: string,
  eventKeywords: string[]
): number {
  if (!eventKeywords || eventKeywords.length === 0) return 0.5

  const normalizedText = text.toLowerCase()
  const matchedKeywords = eventKeywords.filter((k) =>
    normalizedText.includes(k.toLowerCase())
  )

  const baseRelevance = matchedKeywords.length / eventKeywords.length

  const textLength = text.length
  const lengthPenalty = textLength < 50 ? 0.1 : textLength > 500 ? 0.1 : 0

  const relevance = Math.max(
    0,
    Math.min(1, baseRelevance - lengthPenalty + 0.3)
  )

  return relevance
}

export function analyzeEvents(
  events: SemanticEvent[],
  eventKeywords: string[]
): SemanticEvent[] {
  return events.map((event) => {
    const sentimentResult = analyzeSentiment(event.text)
    const relevance = computeRelevance(event.text, eventKeywords)
    const credibility = getSourceCredibility(event.source)

    return {
      ...event,
      sentiment: sentimentResult.sentiment,
      sentimentScore: sentimentResult.score,
      relevance,
      credibility,
    }
  })
}

export function aggregateSignal(events: SemanticEvent[]): SemanticSignal {
  if (events.length === 0) {
    return {
      eventId: "",
      ts: Date.now(),
      aggregatedSentiment: 0,
      signalStrength: 0,
      priorAdjustment: 0,
      direction: "neutral",
      confidence: 0,
      sourcesUsed: [],
    }
  }

  const eventId = events[0].eventId
  const ts = Date.now()

  const weightedSum = events.reduce((acc, e) => {
    const weight = e.relevance * e.credibility
    return acc + e.sentimentScore * weight
  }, 0)

  const weightSum = events.reduce((acc, e) => {
    return acc + e.relevance * e.credibility
  }, 0)

  const aggregatedSentiment = weightSum > 0 ? weightedSum / weightSum : 0

  const mentionCount = events.length
  const signalStrength = Math.min(
    1,
    Math.abs(aggregatedSentiment) * Math.log(mentionCount + 1) * 0.3
  )

  const direction: "supports_yes" | "supports_no" | "neutral" =
    aggregatedSentiment > 0.3
      ? "supports_yes"
      : aggregatedSentiment < -0.3
        ? "supports_no"
        : "neutral"

  const confidence = computeConfidence(events, aggregatedSentiment)

  const sourcesUsed = [...new Set(events.map((e) => e.source))]

  const priorAdjustment = computePriorAdjustment(
    aggregatedSentiment,
    signalStrength
  )

  return {
    eventId,
    ts,
    aggregatedSentiment,
    signalStrength,
    priorAdjustment,
    direction,
    confidence,
    sourcesUsed,
  }
}

function computeConfidence(events: SemanticEvent[], sentiment: number): number {
  const sourceCount = new Set(events.map((e) => e.source)).size
  const sourceDiversityFactor = Math.min(1, sourceCount / 4)

  const avgCredibility =
    events.reduce((acc, e) => acc + e.credibility, 0) / events.length

  const avgRelevance =
    events.reduce((acc, e) => acc + e.relevance, 0) / events.length

  const magnitudeFactor = Math.abs(sentiment)

  const confidence =
    sourceDiversityFactor * 0.3 +
    avgCredibility * 0.3 +
    avgRelevance * 0.2 +
    magnitudeFactor * 0.2

  return Math.max(0, Math.min(1, confidence))
}

export function createSnapshot(events: SemanticEvent[]): SemanticSnapshot {
  if (events.length === 0) {
    return {
      eventId: "",
      ts: Date.now(),
      sentimentScore: 0,
      relevanceScore: 0,
      sourceCredibility: 0,
      mentionCount: 0,
      trendDirection: "stable",
    }
  }

  const eventId = events[0].eventId
  const ts = Date.now()

  const sortedEvents = [...events].sort((a, b) => a.ts - b.ts)

  const avgSentiment =
    events.reduce((acc, e) => acc + e.sentimentScore, 0) / events.length
  const avgRelevance =
    events.reduce((acc, e) => acc + e.relevance, 0) / events.length
  const avgCredibility =
    events.reduce((acc, e) => acc + e.credibility, 0) / events.length

  const mentionCount = events.length

  const trendDirection = computeTrendDirection(sortedEvents)

  return {
    eventId,
    ts,
    sentimentScore: avgSentiment,
    relevanceScore: avgRelevance,
    sourceCredibility: avgCredibility,
    mentionCount,
    trendDirection,
  }
}

function computeTrendDirection(
  sortedEvents: SemanticEvent[]
): "up" | "down" | "stable" {
  if (sortedEvents.length < 2) return "stable"

  const recentEvents = sortedEvents.slice(-Math.min(5, sortedEvents.length))
  const olderEvents = sortedEvents.slice(
    0,
    Math.max(1, sortedEvents.length - 5)
  )

  const recentAvg =
    recentEvents.reduce((acc, e) => acc + e.sentimentScore, 0) /
    recentEvents.length
  const olderAvg =
    olderEvents.reduce((acc, e) => acc + e.sentimentScore, 0) /
    olderEvents.length

  const diff = recentAvg - olderAvg

  if (diff > 0.1) return "up"
  if (diff < -0.1) return "down"
  return "stable"
}

function computePriorAdjustment(sentiment: number, strength: number): number {
  const baseAdjustment = sentiment * strength * 0.15
  return Math.max(-0.2, Math.min(0.2, baseAdjustment))
}
