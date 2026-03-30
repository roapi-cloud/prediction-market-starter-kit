import type { SyntheticTick } from "../ingest/adapter"

export type DataSourceType = "rest" | "websocket"

export type DataSourceConfig = {
  type: DataSourceType
  rest: {
    pollIntervalMs: number
    tickLimit: number
  }
  websocket: {
    url: string
    reconnectIntervalMs: number
    pingIntervalMs: number
    subscriptions: string[]
  }
}

export type MarketSubscription = {
  marketId: string
  tokenId?: string
}

export type WebSocketMessage = {
  type: "book" | "trade" | "tick"
  marketId: string
  data: {
    yesBid?: number
    yesAsk?: number
    noBid?: number
    noAsk?: number
    price?: number
    volume?: number
    timestamp?: number
  }
}

export type DataSourceCallbacks = {
  onTick?: (tick: SyntheticTick) => void
  onConnect?: () => void
  onDisconnect?: () => void
  onError?: (error: Error) => void
}

export interface IDataSource {
  start(callbacks: DataSourceCallbacks): void
  stop(): void
  isRunning(): boolean
  fetchOnce(): Promise<SyntheticTick[]>
}
