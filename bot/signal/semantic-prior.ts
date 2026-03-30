import type {
  BayesianOutputEnhanced,
  SemanticSignal,
  BayesianOutputWithSemantic,
} from "../contracts/types"
import { getSemanticCache } from "../data/semantic-cache"

export function injectSemanticPrior(
  bayesian: BayesianOutputEnhanced,
  semantic: SemanticSignal | null,
  basePrior = 0.5
): BayesianOutputWithSemantic {
  if (!semantic || semantic.signalStrength < 0.1) {
    return {
      ...bayesian,
      semanticAdjustment: 0,
      semanticSignal: semantic ?? undefined,
    }
  }

  const priorAdjustment = semantic.priorAdjustment
  const adjustedPrior = basePrior + priorAdjustment

  const currentPUp = bayesian.pUp
  const blendedPUp = blendProbabilities(
    currentPUp,
    adjustedPrior,
    semantic.confidence
  )

  const pUp = Math.max(0.01, Math.min(0.99, blendedPUp))
  const pDown = 1 - pUp

  const newConfidence = Math.max(
    bayesian.confidence,
    semantic.confidence * semantic.signalStrength
  )

  return {
    ...bayesian,
    pUp,
    pDown,
    confidence: newConfidence,
    semanticAdjustment: priorAdjustment,
    semanticSignal: semantic,
  }
}

function blendProbabilities(
  currentPUp: number,
  semanticPrior: number,
  semanticWeight: number
): number {
  const featureWeight = 1 - semanticWeight
  const blended = currentPUp * featureWeight + semanticPrior * semanticWeight
  return blended
}

export function computePriorFromSignal(
  signal: SemanticSignal,
  basePrior = 0.5
): number {
  const adjustment = signal.priorAdjustment
  return Math.max(0.01, Math.min(0.99, basePrior + adjustment))
}

export function adjustBayesianConfidence(
  bayesian: BayesianOutputEnhanced,
  semantic: SemanticSignal
): number {
  const bayesianConf = bayesian.confidence
  const semanticConf = semantic.confidence
  const semanticStrength = semantic.signalStrength

  if (semanticStrength < 0.1) {
    return bayesianConf
  }

  const blended = bayesianConf + semanticConf * semanticStrength * 0.2
  return Math.min(1, blended)
}

export function shouldUseSemanticSignal(signal: SemanticSignal): boolean {
  return (
    signal.signalStrength >= 0.1 &&
    signal.confidence >= 0.3 &&
    signal.sourcesUsed.length > 0
  )
}

export function getSemanticPriorForEvent(
  eventId: string,
  basePrior = 0.5
): { prior: number; signal: SemanticSignal | null } {
  const cache = getSemanticCache()
  const signal = cache.getSignal(eventId)

  if (!signal) {
    return { prior: basePrior, signal: null }
  }

  if (!shouldUseSemanticSignal(signal)) {
    return { prior: basePrior, signal }
  }

  const prior = computePriorFromSignal(signal, basePrior)
  return { prior, signal }
}

export function computeSemanticContribution(
  original: BayesianOutputEnhanced,
  adjusted: BayesianOutputWithSemantic
): {
  priorChange: number
  confidenceChange: number
  directionImpact: string
  contributionScore: number
} {
  const priorChange = adjusted.pUp - original.pUp
  const confidenceChange = adjusted.confidence - original.confidence

  let directionImpact = "none"
  if (adjusted.semanticSignal) {
    directionImpact = adjusted.semanticSignal.direction
  }

  const contributionScore = Math.abs(priorChange) + confidenceChange * 0.5

  return {
    priorChange,
    confidenceChange,
    directionImpact,
    contributionScore,
  }
}
