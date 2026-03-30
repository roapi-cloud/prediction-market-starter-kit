export type MarketEvent = {
  eventId: string
  tsExchange: number
  tsLocal: number
  marketId: string
  type: "book_update" | "trade_print" | "snapshot" | "order_ack" | "fill"
  payload: Record<string, unknown>
}

export type FeatureSnapshot = {
  marketId: string
  ts: number
  imbalanceL1: number
  imbalanceL5: number
  microPrice: number
  spreadZScore?: number
  volatility1s?: number
}

export type Opportunity = {
  id: string
  strategy: "static_arb" | "stat_arb" | "microstructure" | "term_structure"
  marketIds: string[]
  evBps: number
  confidence: number
  ttlMs: number
  createdAt: number
}

export type RiskDecision = {
  allow: boolean
  reason?: string
  maxSize?: number
  maxSlippageBps?: number
  killSwitch: boolean
}

export type OrderIntent = {
  opportunityId: string
  marketId: string
  side: "buy" | "sell"
  price: number
  size: number
  tif: "GTC" | "IOC" | "FOK"
}

export type OrderUpdate = {
  orderId: string
  status: "accepted" | "partial_fill" | "filled" | "canceled" | "rejected"
  filledSize: number
  avgPrice?: number
  ts: number
}

export type StatArbConfig = {
  pairId: string
  marketA: string
  marketB: string
  hedgeRatio: number
  lookbackWindow: number
  entryZThreshold: number
  exitZThreshold: number
  maxHoldingMs: number
  stopLossZThreshold: number
}

export type SpreadSnapshot = {
  pairId: string
  ts: number
  spread: number
  mean: number
  std: number
  zScore: number
  halfLife?: number
}

export type StatArbSignal = {
  pairId: string
  zScore: number
  direction: "long_spread" | "short_spread" | "neutral"
  evBps: number
  confidence: number
  ttlMs: number
}

export type SpreadHistoryEntry = {
  ts: number
  priceA: number
  priceB: number
  spread: number
}

export type MicrostructureConfig = {
  imbalanceThreshold: number
  microPriceDevThreshold: number
  largeTradeMultiplier: number
  queueCollapseWindowMs: number
  sparseTradeThreshold: number
}

export type BookMetrics = {
  imbalanceL1: number
  imbalanceL5: number
  imbalanceL10: number
  microPrice: number
  microPriceDev: number
  queueDepthBid: number
  queueDepthAsk: number
  queueConsumptionRate: number
}

export type TradeMetrics = {
  largeTradeCount: number
  largeTradeVolume: number
  largeTradeDirection: "buy" | "sell" | "neutral"
  tradeFrequency: number
  avgTradeSize: number
}

export type MicrostructureSignal = {
  marketId: string
  ts: number
  signals: {
    imbalance: boolean
    microPriceDev: boolean
    largeTrade: boolean
    queueCollapse: boolean
    sparseTrade: boolean
  }
  combinedScore: number
  evBps: number
  direction: "buy" | "sell" | "neutral"
  confidence: number
}

export type TermStructureConfig = {
  eventId: string
  markets: Array<{ marketId: string; expiryTs: number }>
  termSpreadThreshold: number
  maxHoldingBeforeExpiryMs: number
  timeValueDecayRate: number
}

export type TermSpreadSnapshot = {
  eventId: string
  ts: number
  shortTermPrice: number
  longTermPrice: number
  termSpread: number
  theoreticalSpread: number
  spreadDeviation: number
  shortExpiryMs: number
  longExpiryMs: number
}

export type TermStructureSignal = {
  eventId: string
  direction: "long_short" | "short_short" | "neutral"
  shortMarketId: string
  longMarketId: string
  termSpreadDev: number
  evBps: number
  confidence: number
  urgency: number
  ttlMs: number
}

export type MarketInfo = {
  marketId: string
  eventId: string
  expiryTs: number
  question?: string
}

export type Position = {
  marketId: string
  side: "YES" | "NO"
  size: number
  avgEntry: number
  currentPrice: number
  unrealizedPnl: number
}

export type ExecutionResult = {
  opportunityId: string
  marketId: string
  strategy: "static_arb" | "stat_arb" | "microstructure" | "term_structure"
  success: boolean
  pnl: number
  slippageBps: number
  ts: number
  reason?: string
}

export type RiskConfigEnhanced = {
  maxPositionSize: number
  maxMarketExposure: number
  maxIntradayLoss: number
  maxIntradayLossPct: number
  maxDrawdownPct: number
  consecutiveFailThreshold: number
  failCooldownMs: number
  correlationMatrix: Map<string, Map<string, number>>
  maxCombinedExposure: number
  slippageAlertThreshold: number
  slippageCalibrationWindow: number
}

export type CorrelationGroup = {
  groupId: string
  markets: string[]
  avgCorrelation: number
  combinedExposure: number
  maxAllowedExposure: number
}

export type SlippageStats = {
  marketId: string
  strategy: string
  count: number
  meanBps: number
  stdBps: number
  p95Bps: number
  p99Bps: number
  lastUpdate: number
  samples: number[]
}

export type RiskStateEnhanced = {
  equity: number
  intradayPnl: number
  peakEquity: number
  drawdown: number
  openExposure: number
  combinedExposure: number
  consecutiveFails: number
  consecutiveFailsByStrategy: Map<string, number>
  killSwitch: boolean
  restrictedStrategies: string[]
  lastFailTime: number
  slippageStats: Map<string, SlippageStats>
  positions: Map<string, Position>
  killSwitchReason?: string
}

export type RiskDecisionEnhanced = {
  allow: boolean
  reason?: string
  maxSize?: number
  maxSlippageBps?: number
  killSwitch: boolean
  warnings: string[]
  slippageAdjustment: number
  correlationWarning: boolean
}

export type SlippageFeedback = {
  marketId: string
  strategy: string
  expectedSlippageBps: number
  actualSlippageBps: number
  ts: number
}

export type MarketRegime = "up" | "down" | "range" | "volatile"

export type ParticleParams = {
  imbalanceWeight: number
  zScoreWeight: number
  volatilityWeight: number
}

export type ParticleState = {
  regime: MarketRegime
  weight: number
  params: ParticleParams
}

export type ObservationModel = {
  imbalanceMean: Record<MarketRegime, number>
  imbalanceStd: Record<MarketRegime, number>
  zScoreMean: Record<MarketRegime, number>
  zScoreStd: Record<MarketRegime, number>
  volatilityMean: Record<MarketRegime, number>
  volatilityStd: Record<MarketRegime, number>
}

export type BayesianConfig = {
  particleCount: number
  states: MarketRegime[]
  transitionMatrix: Record<MarketRegime, Record<MarketRegime, number>>
  observationModel: ObservationModel
  resampleThreshold: number
  paramConstraints: {
    imbalanceWeight: { min: number; max: number }
    zScoreWeight: { min: number; max: number }
    volatilityWeight: { min: number; max: number }
  }
}

export type BayesianOutputEnhanced = {
  pUp: number
  pDown: number
  regime: MarketRegime
  regimeConfidence: number
  confidence: number
  nextRegimeProb: Record<MarketRegime, number>
  predictedPriceMove: "up" | "down" | "neutral"
  effectiveParticleCount: number
}

export type StrategyType =
  | "static_arb"
  | "stat_arb"
  | "microstructure"
  | "term_structure"

export type StrategyConfig = {
  name: string
  type: StrategyType
  enabled: boolean
  priority: number
  weight: number
  maxCapitalAllocation: number
  maxExposurePerMarket: number
  riskBudgetPct: number
  cooldownAfterFailMs: number
}

export type StrategyState = {
  name: string
  type: StrategyType
  status: "active" | "paused" | "disabled" | "cooldown"
  currentExposure: number
  intradayPnl: number
  opportunitiesFound: number
  opportunitiesExecuted: number
  consecutiveFails: number
  lastFailTime?: number
  lastOpportunityTime?: number
  avgEvBps: number
  winRate: number
  lockedMarkets: Set<string>
}

export type StrategyStats = {
  name: string
  type: StrategyType
  totalOpportunities: number
  executedOpportunities: number
  totalPnl: number
  avgEvBps: number
  winRate: number
  avgHoldTimeMs: number
  sharpeRatio?: number
}

export type StrategyRegistry = {
  strategies: Map<string, StrategyConfig>
  states: Map<string, StrategyState>
}

export type ResourceClaim = {
  marketIds: string[]
  estimatedExposure: number
  estimatedDurationMs: number
}

export type RoutedOpportunity = {
  opportunity: Opportunity
  sourceStrategy: string
  priority: number
  resourceClaim: ResourceClaim
}

export type RejectedOpportunity = {
  opportunity: RoutedOpportunity
  reason: string
}

export type ArbitrationResult = {
  selected: RoutedOpportunity | null
  rejected: RejectedOpportunity[]
  reason: string
}

export type AllocationConstraint = {
  type: "capital" | "exposure" | "risk_budget"
  strategy?: string
  market?: string
  limit: number
  current: number
  available: number
}

export type AllocationDecision = {
  strategyAllocations: Map<string, number>
  totalAvailable: number
  constraints: AllocationConstraint[]
}

export type StrategyExecutionResult = {
  strategyName: string
  success: boolean
  pnl?: number
  exposure?: number
  marketIds: string[]
  ts: number
}

export type RouterState = {
  totalEquity: number
  totalExposure: number
  availableCapital: number
  lockedMarkets: Map<string, string>
  strategyExposures: Map<string, number>
}

export type TwoLegExecutionConfig = {
  strategy: "passive_then_ioc" | "simultaneous" | "ioc_both"
  legsTTLMs: number
  hedgeTTLMs: number
  maxSlippageBps: number
  maxHedgeAttempts: number
  partialFillThreshold: number
  queuePositionSimulation: boolean
}

export type Leg = {
  marketId: string
  side: "buy" | "sell"
  targetPrice: number
  targetSize: number
  filledSize: number
  avgPrice: number
  orderId?: string
  status: "pending" | "submitted" | "partial" | "filled" | "failed"
}

export type ExecutionState = {
  opportunityId: string
  legs: Leg[]
  phase:
    | "init"
    | "passive_wait"
    | "hedge_active"
    | "completed"
    | "failed"
    | "aborted"
  startTime: number
  elapsedMs: number
  remainingSize: number
  hedgeAttempts: number
  totalPnl: number
}

export type ExecutionPlan = {
  opportunityId: string
  legs: Leg[]
  config: TwoLegExecutionConfig
  estimatedFillTime: number
  queuePositions: number[]
}

export type TwoLegExecutionResult = {
  opportunityId: string
  success: boolean
  legsFilled: number[]
  avgPrices: number[]
  actualSlippageBps: number
  executionTimeMs: number
  pnlBps: number
  phaseReached: ExecutionState["phase"]
  hedgeAttemptsUsed: number
}

export type OrderAction = {
  type: "submit" | "cancel" | "modify"
  orderId?: string
  legIndex: number
  order: OrderIntent
}

export type SemanticSource = {
  type: "news" | "social" | "forum" | "official"
  endpoint: string
  apiKey?: string
  enabled: boolean
}

export type SemanticConfig = {
  sources: SemanticSource[]
  updateIntervalMs: number
  signalTTLMs: number
  credibilityWeights: Record<string, number>
  enabled: boolean
}

export type SemanticEvent = {
  eventId: string
  ts: number
  source: string
  text: string
  sentiment: "positive" | "negative" | "neutral"
  sentimentScore: number
  relevance: number
  credibility: number
}

export type SemanticSignal = {
  eventId: string
  ts: number
  aggregatedSentiment: number
  signalStrength: number
  priorAdjustment: number
  direction: "supports_yes" | "supports_no" | "neutral"
  confidence: number
  sourcesUsed: string[]
}

export type SemanticSnapshot = {
  eventId: string
  ts: number
  sentimentScore: number
  relevanceScore: number
  sourceCredibility: number
  mentionCount: number
  trendDirection: "up" | "down" | "stable"
}

export type BayesianOutputWithSemantic = BayesianOutputEnhanced & {
  semanticAdjustment?: number
  semanticSignal?: SemanticSignal
}

export type DelayDistribution = {
  meanMs: number
  stdMs: number
  p99Ms: number
  spikeProbability: number
  spikeMs: number
}

export type PerturbationRanges = {
  slippageMultiplier: [number, number]
  delayMultiplier: [number, number]
  fillRateRange: [number, number]
  probabilityError: number
  correlationDrift: number
  volatilityMultiplier: [number, number]
}

export type QueueSimulationConfig = {
  trackQueuePosition: boolean
  consumeRate: number
  frontCancelRate: number
}

export type ExecutionConfigBacktest = {
  kellyCap: number
  stoikovRiskAversion: number
  slippageBps: number
  partialFillBaseRate: number
  partialFillSizeDecay: number
}

export type BacktestConfigEnhanced = {
  dataStart: number
  dataEnd: number
  dataPath: string
  replaySpeed: number
  simulateQueue: boolean
  simulateDepth: number
  injectDelay: boolean
  delayConfig: DelayDistribution
  monteCarloRuns: number
  perturbationRanges: PerturbationRanges
  samplingMethod: "random" | "lhs"
  strategiesEnabled: string[]
  riskConfig: RiskConfigEnhanced
  executionConfig: ExecutionConfigBacktest
}

export type BacktestResultEnhanced = {
  totalPnl: number
  totalPnlBps: number
  sharpeRatio: number
  sortinoRatio: number
  maxDrawdown: number
  maxDrawdownPct: number
  totalOpportunities: number
  totalExecuted: number
  winRate: number
  avgEvBps: number
  avgHoldingTimeMs: number
  avgSlippageBps: number
  p95SlippageBps: number
  avgDelayMs: number
  p99DelayMs: number
  legCompletionRate: number
  killSwitchTriggered: number
  riskLimitBreaches: number
  consecutiveFailEvents: number
  signalPnl: number
  executionLoss: number
  inventoryLoss: number
  riskControlLoss: number
  mcPnLMean: number
  mcPnLP05: number
  mcPnLP95: number
  mcMaxDdMean: number
  mcMaxDdP95: number
  mcRuinProbability: number
  sensitivityAnalysis: Record<string, number>
}

export type ExecutionEvent = {
  ts: number
  opportunityId: string
  marketId: string
  side: "buy" | "sell"
  intendedSize: number
  filledSize: number
  intendedPrice: number
  avgPrice: number
  slippageBps: number
  delayMs: number
  queuePosition?: number
  status: "filled" | "partial" | "failed"
}

export type RiskEventBacktest = {
  ts: number
  type: "kill_switch" | "limit_breach" | "consecutive_fail"
  reason: string
  impact: number
}

export type BacktestReport = {
  summary: BacktestResultEnhanced
  pnlCurve: Array<{ ts: number; pnl: number; equity: number }>
  strategyBreakdown: Record<string, BacktestResultEnhanced>
  marketBreakdown: Record<string, BacktestResultEnhanced>
  executionEvents: ExecutionEvent[]
  riskEvents: RiskEventBacktest[]
  mcDistribution: Array<{ pnl: number; probability: number }>
}

export type BacktestParams = {
  slippageMultiplier: number
  delayMultiplier: number
  fillRate: number
  probabilityError: number
  correlationDrift: number
  volatilityMultiplier: number
}

export type MonteCarloResult = {
  pnlDistribution: number[]
  maxDrawdowns: number[]
  meanPnl: number
  p05Pnl: number
  p95Pnl: number
  meanMaxDd: number
  p95MaxDd: number
  ruinProbability: number
}

export type HistoricalData = {
  ticks: HistoricalTick[]
  snapshots: BookSnapshot[]
  trades: HistoricalTrade[]
}

export type HistoricalTick = {
  ts: number
  marketId: string
  yesBid: number
  yesAsk: number
  noBid: number
  noAsk: number
  volume: number
}

export type BookSnapshot = {
  ts: number
  marketId: string
  bids: Array<{ price: number; size: number }>
  asks: Array<{ price: number; size: number }>
}

export type HistoricalTrade = {
  ts: number
  marketId: string
  side: "buy" | "sell"
  price: number
  size: number
}

export type BacktestEvent = {
  ts: number
  type: "opportunity" | "execution" | "risk" | "market"
  data: Record<string, unknown>
  pnl?: number
  signalPnl?: number
  executionLoss?: number
  inventoryLoss?: number
  riskControlLoss?: number
}

export type AttributionResult = {
  signalPnl: number
  executionLoss: number
  inventoryLoss: number
  riskControlLoss: number
  totalPnl: number
}

export type BookDepthLevel = {
  price: number
  size: number
  cumulativeSize: number
}

export type DepthSimulatorConfig = {
  levels: number
  tickSize: number
  minSpread: number
  liquidityDecayRate: number
}

export type MetricsConfig = {
  collectionIntervalMs: number
  persistenceEnabled: boolean
  persistencePath: string
  pushEnabled: boolean
  pushEndpoint?: string
}

export type AlertConfig = {
  rules: AlertRule[]
  channels: AlertChannel[]
  cooldownMs: number
}

export type AlertRule = {
  name: string
  metric: string
  condition: "gt" | "lt" | "eq"
  threshold: number
  severity: "info" | "warning" | "critical"
  message: string
}

export type AlertChannel = {
  type: "log" | "webhook" | "email"
  endpoint?: string
  enabled: boolean
}

export type DeploymentStage = "paper" | "grayscale" | "production"

export type DeploymentConfig = {
  stage: DeploymentStage
  capitalLimitPct: number
  grayscalePct: number
  passCriteria: PassCriteria
}

export type PassCriteria = {
  minLegCompletionRate: number
  minAvgEvBps: number
  maxDrawdownPct: number
  maxKillSwitchTriggers: number
  minDurationDays: number
}

export type MetricsSnapshot = {
  ts: number
  pnl: number
  pnlPct: number
  drawdown: number
  drawdownPct: number
  winRate: number
  legCompletionRate: number
  avgSlippageBps: number
  avgDelayMs: number
  orderFillRate: number
  hedgeSuccessRate: number
  dataLatencyMs: number
  eventThroughput: number
  activeStrategies: number
  riskState: "normal" | "warning" | "kill_switch"
  strategyMetrics: Map<string, StrategyMetrics>
}

export type StrategyMetrics = {
  opportunities: number
  executed: number
  pnl: number
  avgEvBps: number
  winRate: number
}

export type AlertEvent = {
  id: string
  rule: string
  severity: "info" | "warning" | "critical"
  message: string
  ts: number
  value: number
  threshold: number
  acknowledged: boolean
}

export type DailyReport = {
  date: string
  summary: {
    pnl: number
    pnlPct: number
    opportunities: number
    executed: number
    winRate: number
    maxDrawdown: number
  }
  strategyBreakdown: Map<string, StrategyMetrics>
  marketBreakdown: Map<string, MarketMetrics>
  executionQuality: {
    legCompletionRate: number
    avgSlippageBps: number
    avgDelayMs: number
  }
  riskEvents: RiskEventSummary[]
  alerts: AlertEvent[]
  comparison: {
    vsYesterday: number
    vsWeeklyAvg: number
  }
}

export type MarketMetrics = {
  opportunities: number
  executed: number
  pnl: number
  avgSpread: number
}

export type RiskEventSummary = {
  ts: number
  type: string
  description: string
}

export type DeploymentStatus = {
  stage: DeploymentStage
  startTime: number
  durationDays: number
  capitalUsedPct: number
  criteriaMet: boolean
  metricsSinceStart: MetricsSnapshot
  canAdvance: boolean
  canRollback: boolean
}

export type EngineState = {
  equity: number
  cash: number
  totalPnl: number
  drawdownPct: number
  openNotional: number
  orderCount: number
  fillCount: number
  partialCount: number
  totalSlippageCost: number
  positions: Map<
    string,
    { size: number; avgEntry: number; currentPrice: number }
  >
  orders: Array<{
    id: string
    ts: number
    marketId: string
    status: string
    filledSize: number
    pnl: number
  }>
  strategyEvents: StrategyEvent[]
  riskState: "normal" | "warning" | "kill_switch"
}

export type StrategyEvent = {
  strategy: string
  marketId: string
  ts: number
  type: "opportunity" | "executed" | "skipped" | "blocked"
  evBps: number
  pnl?: number
  success?: boolean
}

export type HealthStatus = {
  healthy: boolean
  uptime: number
  lastCycle: number
  cycles: number
  errors: string[]
  metrics: {
    equity: number
    drawdownPct: number
    positions: number
    pendingOrders: number
  }
}

export type WeeklyReport = {
  startDate: string
  endDate: string
  summary: {
    pnl: number
    pnlPct: number
    totalOpportunities: number
    totalExecuted: number
    winRate: number
    maxDrawdown: number
    avgDailyPnl: number
    bestDay: string
    worstDay: string
  }
  dailyReports: DailyReport[]
  strategyBreakdown: Map<string, StrategyMetrics>
}
