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

export type Position = {
  marketId: string
  side: "YES" | "NO"
  size: number
  avgEntry: number
  currentPrice: number
  unrealizedPnl: number
}

export type MarketInfo = {
  marketId: string
  eventId: string
  expiryTs: number
  question?: string
}

export type BookDepthLevel = {
  price: number
  size: number
  cumulativeSize: number
}
