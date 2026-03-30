import WebSocket from "ws"
import { getEvents } from "@/lib/gamma"
import { parsePrices } from "@/lib/prices"
import { readFile } from "node:fs/promises"
import type { SyntheticTick } from "../ingest/adapter"
import type {
  IDataSource,
  DataSourceConfig,
  DataSourceCallbacks,
  WebSocketMessage,
} from "./types"

function clampPrice(value: number): number {
  return Math.max(0.01, Math.min(0.99, value))
}

type PolymarketBookMessage = {
  event_type: "book"
  asset_id: string
  market: string
  hash: string
  timestamp: string
  bids: Array<[string, string]>
  asks: Array<[string, string]>
}

type PolymarketTradeMessage = {
  event_type: "trade"
  asset_id: string
  market: string
  hash: string
  timestamp: string
  price: string
  size: string
  side: string
}

export class WebSocketDataSource implements IDataSource {
  private config: DataSourceConfig["websocket"]
  private ws: WebSocket | null = null
  private running = false
  private callbacks: DataSourceCallbacks = {}
  private reconnectTimer: NodeJS.Timeout | null = null
  private pingTimer: NodeJS.Timeout | null = null
  private marketCache: Map<
    string,
    { tokenId: string; outcome: "YES" | "NO"; marketId: string }
  > = new Map()
  private lastTicks: Map<string, SyntheticTick> = new Map()
  private pendingBookUpdates: Map<
    string,
    {
      yesBid: number
      yesAsk: number
      noBid: number
      noAsk: number
      volume: number
    }
  > = new Map()
  private subscribedMarketIds: Set<string> = new Set()

  constructor(config: DataSourceConfig["websocket"]) {
    this.config = config
  }

  async fetchOnce(): Promise<SyntheticTick[]> {
    let events: Awaited<ReturnType<typeof getEvents>>
    try {
      events = await getEvents({
        active: true,
        closed: false,
        archived: false,
        limit: 50,
      })
    } catch {
      const snapshot = await readFile(
        new URL("../fixtures/gamma-events.snapshot.json", import.meta.url),
        "utf8"
      )
      events = JSON.parse(snapshot)
    }

    const ticks: SyntheticTick[] = []
    const ts = Date.now()

    for (const event of events) {
      for (const market of event.markets ?? []) {
        const [yes, no] = parsePrices(market)
        if (yes <= 0 || no <= 0) continue

        const spread = 0.01
        const tick: SyntheticTick = {
          ts,
          marketId: market.id,
          yesBid: clampPrice(yes - spread),
          yesAsk: clampPrice(yes + spread),
          noBid: clampPrice(no - spread),
          noAsk: clampPrice(no + spread),
          volume: Math.max(1, market.volume_24hr || market.volume || 1),
        }
        ticks.push(tick)
        this.lastTicks.set(market.id, tick)
      }
    }

    return ticks
  }

  private async loadMarketCache(): Promise<string[]> {
    const marketIds: string[] = []
    try {
      const events = await getEvents({
        active: true,
        closed: false,
        archived: false,
        limit: 100,
      })
      for (const event of events) {
        for (const market of event.markets ?? []) {
          marketIds.push(market.id)
          if (market.tokens) {
            for (const token of market.tokens) {
              this.marketCache.set(token.token_id, {
                tokenId: token.token_id,
                outcome: token.outcome.toUpperCase() as "YES" | "NO",
                marketId: market.id,
              })
            }
          }
        }
      }
      console.log(
        `[WebSocket] Loaded ${this.marketCache.size} tokens from ${marketIds.length} markets`
      )
    } catch (err) {
      console.error("[WebSocket] Failed to load market cache:", err)
    }
    return marketIds
  }

  start(callbacks: DataSourceCallbacks): void {
    this.callbacks = callbacks
    this.running = true
    void this.connect()
  }

  private async connect(): Promise<void> {
    if (!this.running) return

    try {
      const marketIds = await this.loadMarketCache()

      if (marketIds.length === 0) {
        console.error(
          "[WebSocket] No markets found, falling back to REST polling"
        )
        this.startRestFallback()
        return
      }

      this.ws = new WebSocket(this.config.url)

      this.ws.on("open", () => {
        console.log("[WebSocket] Connected")
        this.callbacks.onConnect?.()
        this.subscribeToMarkets(marketIds)
        this.startPing()
      })

      this.ws.on("message", (data: WebSocket.RawData) => {
        try {
          const msg = JSON.parse(data.toString()) as
            | PolymarketBookMessage
            | PolymarketTradeMessage
          this.handleMessage(msg)
        } catch (err) {
          console.error("[WebSocket] Failed to parse message:", err)
        }
      })

      this.ws.on("close", () => {
        console.log("[WebSocket] Disconnected")
        this.callbacks.onDisconnect?.()
        this.stopPing()
        this.scheduleReconnect()
      })

      this.ws.on("error", (err: Error) => {
        console.error("[WebSocket] Error:", err.message)
        this.callbacks.onError?.(err)
      })
    } catch (err) {
      console.error("[WebSocket] Connection failed:", err)
      this.scheduleReconnect()
    }
  }

  private startRestFallback(): void {
    const pollInterval = this.config.reconnectIntervalMs || 5000
    const poll = async (): Promise<void> => {
      if (!this.running) return
      try {
        const ticks = await this.fetchOnce()
        for (const tick of ticks) {
          this.callbacks.onTick?.(tick)
        }
      } catch (err) {
        console.error("[WebSocket REST Fallback] Poll error:", err)
      }
      if (this.running) {
        setTimeout(() => void poll(), pollInterval)
      }
    }
    void poll()
  }

  private subscribeToMarkets(marketIds: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return

    const marketsToSubscribe =
      this.config.subscriptions.length > 0
        ? this.config.subscriptions
        : marketIds.slice(0, 50)

    const subscribeMsg = {
      type: "subscribe",
      channel: "market",
      markets: marketsToSubscribe,
    }
    this.ws.send(JSON.stringify(subscribeMsg))

    for (const id of marketsToSubscribe) {
      this.subscribedMarketIds.add(id)
    }

    console.log(
      `[WebSocket] Subscribed to ${marketsToSubscribe.length} markets`
    )
  }

  private subscribe(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    if (this.subscribedMarketIds.size === 0) return

    const subscribeMsg = {
      type: "subscribe",
      channel: "market",
      markets: Array.from(this.subscribedMarketIds),
    }
    this.ws.send(JSON.stringify(subscribeMsg))
  }

  private handleMessage(
    msg: PolymarketBookMessage | PolymarketTradeMessage
  ): void {
    const tokenInfo = this.marketCache.get(msg.asset_id)
    if (!tokenInfo) return

    const marketId = msg.market
    const outcome = tokenInfo.outcome

    let pending = this.pendingBookUpdates.get(marketId)
    if (!pending) {
      const lastTick = this.lastTicks.get(marketId)
      pending = lastTick
        ? {
            yesBid: lastTick.yesBid,
            yesAsk: lastTick.yesAsk,
            noBid: lastTick.noBid,
            noAsk: lastTick.noAsk,
            volume: lastTick.volume,
          }
        : { yesBid: 0.5, yesAsk: 0.51, noBid: 0.49, noAsk: 0.5, volume: 0 }
      this.pendingBookUpdates.set(marketId, pending)
    }

    if (msg.event_type === "book") {
      const bookMsg = msg as PolymarketBookMessage
      const bids = bookMsg.bids.map(([price, size]) => ({
        price: parseFloat(price),
        size: parseFloat(size),
      }))
      const asks = bookMsg.asks.map(([price, size]) => ({
        price: parseFloat(price),
        size: parseFloat(size),
      }))

      if (bids.length > 0 && asks.length > 0) {
        const bestBid = Math.max(...bids.map((b) => b.price))
        const bestAsk = Math.min(...asks.map((a) => a.price))

        if (outcome === "YES") {
          pending.yesBid = clampPrice(bestBid)
          pending.yesAsk = clampPrice(bestAsk)
        } else {
          pending.noBid = clampPrice(bestBid)
          pending.noAsk = clampPrice(bestAsk)
        }
      }
    } else if (msg.event_type === "trade") {
      const tradeMsg = msg as PolymarketTradeMessage
      pending.volume += parseFloat(tradeMsg.size)
    }

    if (
      pending.yesBid > 0 &&
      pending.yesAsk > 0 &&
      pending.noBid > 0 &&
      pending.noAsk > 0
    ) {
      const tick: SyntheticTick = {
        ts: Date.now(),
        marketId,
        yesBid: pending.yesBid,
        yesAsk: pending.yesAsk,
        noBid: pending.noBid,
        noAsk: pending.noAsk,
        volume: pending.volume,
      }

      this.lastTicks.set(marketId, tick)
      this.callbacks.onTick?.(tick)
    }
  }

  private startPing(): void {
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping()
      }
    }, this.config.pingIntervalMs)
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
  }

  private scheduleReconnect(): void {
    if (!this.running) return

    console.log(
      `[WebSocket] Reconnecting in ${this.config.reconnectIntervalMs}ms...`
    )
    this.reconnectTimer = setTimeout(() => {
      void this.connect()
    }, this.config.reconnectIntervalMs)
  }

  stop(): void {
    this.running = false
    this.stopPing()

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (this.ws) {
      this.ws.close()
      this.ws = null
    }

    this.callbacks.onDisconnect?.()
  }

  isRunning(): boolean {
    return this.running
  }
}
