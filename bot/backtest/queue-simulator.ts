import type {
  OrderIntent,
  QueueSimulationConfig,
  BookSnapshot,
} from "../contracts/types"

export class QueueSimulator {
  private config: QueueSimulationConfig
  private queuePositions: Map<string, number> = new Map()

  constructor(config: QueueSimulationConfig) {
    this.config = {
      trackQueuePosition: config.trackQueuePosition ?? true,
      consumeRate: config.consumeRate ?? 0.1,
      frontCancelRate: config.frontCancelRate ?? 0.05,
    }
  }

  simulateQueuePosition(order: OrderIntent, snapshot: BookSnapshot): number {
    if (!this.config.trackQueuePosition) return 0

    const levels = order.side === "buy" ? snapshot.bids : snapshot.asks
    const matchingLevel = levels.find((l) => l.price === order.price)

    if (!matchingLevel) {
      return levels.length > 0 ? this.estimateQueuePosition(order, levels) : 0
    }

    const queuePosition = Math.random() * matchingLevel.size
    this.queuePositions.set(order.opportunityId, queuePosition)
    return queuePosition
  }

  private estimateQueuePosition(
    order: OrderIntent,
    levels: Array<{ price: number; size: number }>
  ): number {
    const priceDiff = Math.abs(order.price - levels[0].price)
    const estimatedQueue =
      priceDiff * 100 + Math.random() * levels[0].size * 0.1
    return Math.max(0, estimatedQueue)
  }

  simulateConsume(
    queuePosition: number,
    trades: Array<{ side: string; size: number }>
  ): number {
    const consumeVolume =
      trades.reduce((acc, t) => acc + t.size, 0) * this.config.consumeRate
    const cancelVolume = queuePosition * this.config.frontCancelRate
    const newPosition = Math.max(
      0,
      queuePosition - consumeVolume - cancelVolume
    )
    return newPosition
  }

  simulateFill(
    queuePosition: number,
    orderSize: number
  ): { filledSize: number; remainingQueue: number } {
    const fillProbability = Math.exp(-queuePosition / orderSize)
    const filledSize = orderSize * fillProbability * (0.8 + Math.random() * 0.2)
    const remainingQueue = Math.max(0, queuePosition - filledSize)

    return {
      filledSize: Math.min(orderSize, filledSize),
      remainingQueue,
    }
  }

  simulateCancel(queuePosition: number): number {
    const cancelSuccess = queuePosition > 0 ? 0.95 : 1
    if (Math.random() < cancelSuccess) {
      this.queuePositions.clear()
      return 0
    }
    return queuePosition
  }

  getQueuePosition(opportunityId: string): number {
    return this.queuePositions.get(opportunityId) ?? 0
  }

  clearQueuePositions(): void {
    this.queuePositions.clear()
  }

  getQueueStats(): {
    avgPosition: number
    maxPosition: number
    activeQueues: number
  } {
    const positions = Array.from(this.queuePositions.values())
    return {
      avgPosition:
        positions.length > 0
          ? positions.reduce((a, b) => a + b, 0) / positions.length
          : 0,
      maxPosition: positions.length > 0 ? Math.max(...positions) : 0,
      activeQueues: positions.length,
    }
  }
}

export function createDefaultQueueConfig(): QueueSimulationConfig {
  return {
    trackQueuePosition: true,
    consumeRate: 0.1,
    frontCancelRate: 0.05,
  }
}
