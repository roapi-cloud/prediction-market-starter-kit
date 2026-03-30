import {
  runMultiStrategyBacktest,
  formatStrategyComparison,
  type MultiStrategyConfig,
} from "../core/multi-strategy-engine"
import { createSyntheticData } from "../backtest/historical-loader"

async function main(): Promise<void> {
  console.log("═══════════════════════════════════════════════════════════════")
  console.log("         MULTI-STRATEGY BACKTEST COMPARISON")
  console.log(
    "═══════════════════════════════════════════════════════════════\n"
  )

  const config: Partial<MultiStrategyConfig> = {
    enabledStrategies: [
      "static_arb",
      "stat_arb",
      "microstructure",
      "term_structure",
    ],
    walletMode: "shared",
    initialEquity: 10_000,
    strategyAllocation: {
      static_arb: 0.4,
      stat_arb: 0.25,
      microstructure: 0.2,
      term_structure: 0.15,
    },
  }

  console.log("Configuration:")
  console.log(`  Wallet Mode:    ${config.walletMode}`)
  console.log(`  Initial Equity: $${config.initialEquity}`)
  console.log(`  Strategies:     ${config.enabledStrategies?.join(", ")}`)
  console.log(`\n  Allocation:`)
  const allocations = config.strategyAllocation ?? {}
  for (const [strategy, allocation] of Object.entries(allocations)) {
    console.log(
      `    ${strategy}: ${((allocation as number) * 100).toFixed(0)}%`
    )
  }
  console.log("\nGenerating synthetic data...")

  const data = createSyntheticData(1000)
  console.log(`  Ticks: ${data.ticks.length}`)

  console.log("\nRunning multi-strategy backtest...")
  const startTime = Date.now()
  const result = runMultiStrategyBacktest(data.ticks, config)
  const elapsed = Date.now() - startTime

  console.log(`  Completed in ${elapsed}ms\n`)

  console.log(formatStrategyComparison(result))

  console.log(
    "\n═══════════════════════════════════════════════════════════════"
  )
  console.log("                      DETAILED ANALYSIS")
  console.log(
    "═══════════════════════════════════════════════════════════════\n"
  )

  console.log("Performance Summary:")
  console.log(`  Total PnL:      $${result.totalPnl.toFixed(2)}`)
  console.log(`  Total PnL Bps:  ${result.totalPnlBps.toFixed(1)} bps`)
  console.log(`  Best Strategy:  ${result.bestStrategy}`)
  console.log(`  Worst Strategy: ${result.worstStrategy}`)

  console.log("\nStrategy Correlations:")
  for (const [pair, corr] of result.correlations) {
    const strength =
      Math.abs(corr) > 0.7 ? "HIGH" : Math.abs(corr) > 0.3 ? "MODERATE" : "LOW"
    console.log(`  ${pair}: ${corr.toFixed(3)} (${strength})`)
  }

  console.log(
    "\n═══════════════════════════════════════════════════════════════"
  )
  console.log("                    WALLET MODE COMPARISON")
  console.log(
    "═══════════════════════════════════════════════════════════════\n"
  )

  console.log("┌─────────────────┬────────────────────┬────────────────────┐")
  console.log("│ Aspect          │ Shared Wallet      │ Isolated Wallets   │")
  console.log("├─────────────────┼────────────────────┼────────────────────┤")
  console.log("│ Capital Usage   │ Higher efficiency  │ Lower efficiency   │")
  console.log("│ Risk            │ Correlated risk    │ Isolated risk      │")
  console.log("│ Complexity      │ Simple             │ Complex            │")
  console.log("│ Comparison      │ Direct PnL compare │ Need normalization │")
  console.log("│ Recommended For │ Same market types  │ Different markets  │")
  console.log("└─────────────────┴────────────────────┴────────────────────┘")

  console.log("\n  RECOMMENDATION: Start with SHARED wallet mode for")
  console.log("  easier strategy comparison. Switch to ISOLATED when")
  console.log("  deploying to production with real funds.")
}

main().catch(console.error)
