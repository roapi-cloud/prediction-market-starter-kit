import type { PaperPortfolio } from "../paper/portfolio"
import type { BotConfig } from "../config"

export type ExitDecision = {
  shouldExit: boolean
  yesSize: number
  noSize: number
  reason: string
}

/**
 * Check if we should exit (take profit) when spread narrows.
 *
 * Strategy: When YES+NO spread narrows below entry spread,
 * the hedged position gains value. We can exit to lock profit.
 */
export function checkExitOpportunity(
  marketId: string,
  portfolio: PaperPortfolio,
  currentSpread: number,
  entrySpread: number,
  config: BotConfig
): ExitDecision {
  const yesPos = portfolio.positions.get(`${marketId}:YES`)
  const noPos = portfolio.positions.get(`${marketId}:NO`)

  if (!yesPos || !noPos) {
    return {
      shouldExit: false,
      yesSize: 0,
      noSize: 0,
      reason: "No hedged position",
    }
  }

  const hedgedSize = Math.min(yesPos.size, noPos.size)
  if (hedgedSize < 0.1) {
    return {
      shouldExit: false,
      yesSize: 0,
      noSize: 0,
      reason: "Position too small",
    }
  }

  // Entry cost per pair
  const entryCostPerPair = yesPos.avgEntry + noPos.avgEntry

  // Current value if we sell at bid prices
  // We need to get bid prices from the caller
  // For now, estimate: currentSpread represents the discount from $1
  // If spread < entrySpread, we're closer to $1, meaning profit

  const spreadImprovement = entrySpread - currentSpread

  // Exit threshold: spread improved by at least 50% of entry spread
  // Or spread is now very tight (< 0.5%)
  const shouldExit =
    spreadImprovement > entrySpread * 0.5 || currentSpread < 0.005

  if (!shouldExit) {
    return {
      shouldExit: false,
      yesSize: 0,
      noSize: 0,
      reason: "Spread not improved enough",
    }
  }

  // Calculate profit if we exit
  // Entry: paid entryCostPerPair for each pair
  // Exit: receive (1 - currentSpread) for each pair (approximately)
  // But more accurately: sell YES at bid, sell NO at bid
  // For hedged pair, bid_YES + bid_NO ≈ 1 - spread
  const exitValuePerPair = 1 - currentSpread
  const profitPerPair = exitValuePerPair - entryCostPerPair

  // Only exit if profit is positive
  if (profitPerPair <= 0) {
    return {
      shouldExit: false,
      yesSize: 0,
      noSize: 0,
      reason: "No profit to lock",
    }
  }

  // Exit entire hedged position
  return {
    shouldExit: true,
    yesSize: hedgedSize,
    noSize: hedgedSize,
    reason: `Lock profit: spread ${entrySpread.toFixed(4)} → ${currentSpread.toFixed(4)}, profit ${(profitPerPair * hedgedSize).toFixed(4)}`,
  }
}
