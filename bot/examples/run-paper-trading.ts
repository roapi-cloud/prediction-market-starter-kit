import { fetchRealTicks } from '../integration/real-data'
import { FeatureEngine } from '../features/engine'
import { PaperPortfolio } from '../paper/portfolio'
import { generateWallet } from '../paper/wallet'
import { saveSession, getSessionPath } from '../paper/persistence'
import { loadConfig } from '../config'
import { monteCarloPnl } from '../montecarlo/sim'
import { runCycle } from '../core/cycle'

async function main(): Promise<void> {
  const config = loadConfig()
  console.log('=== Polymarket Arbitrage Bot — Paper Trading ===\n')

  console.log('--- Config ---')
  console.log(`  Slippage:       ${config.execution.slippageBps} bps`)
  console.log(`  Fill base rate: ${(config.execution.partialFillBaseRate * 100).toFixed(0)}%`)
  console.log(`  Kelly cap:      ${(config.execution.kellyCap * 100).toFixed(0)}%`)
  console.log(`  Cost bps:       ${config.signal.costBps}`)
  console.log(`  Min EV bps:     ${config.signal.minEvBps}`)

  const wallet = generateWallet()
  console.log('\n--- Wallet ---')
  console.log(`  EOA Address:  ${wallet.address}`)
  console.log(`  Safe Address: ${wallet.safeAddress}`)
  console.log(`  Mnemonic:     ${wallet.mnemonic}`)

  const ticks = await fetchRealTicks(config.data.tickLimit)
  if (ticks.length === 0) throw new Error('No market data available')

  const portfolio = new PaperPortfolio(config.portfolio.initialEquity)
  const featureEngine = new FeatureEngine()
  const result = runCycle(ticks, portfolio, featureEngine, config)

  // Orders
  const filled = portfolio.orders.filter((o) => o.status === 'FILLED')
  const partial = portfolio.orders.filter((o) => o.status === 'PARTIAL')
  const rejected = portfolio.orders.filter((o) => o.status === 'REJECTED')
  console.log(`\n--- Cycle Result ---`)
  console.log(`  Markets scanned: ${ticks.length}`)
  console.log(`  Trades:          ${result.trades}`)
  console.log(`  Skips:           ${result.skips}`)
  console.log(`  Blocks:          ${result.blocks}`)
  console.log(`  Orders:          ${portfolio.orders.length} (${filled.length} full, ${partial.length} partial, ${rejected.length} rejected)`)

  // Positions
  if (portfolio.positions.size > 0) {
    console.log(`\n--- Open Positions (${portfolio.positions.size}) ---`)
    for (const p of portfolio.positions.values()) {
      console.log(
        `  ${p.marketId.padEnd(25)} ${p.side.padEnd(3)} ` +
          `size=${p.size.toFixed(2)} entry=${p.avgEntry.toFixed(4)} mark=${p.currentPrice.toFixed(4)}`,
      )
    }
  }

  // Portfolio
  const snap = portfolio.snapshot()
  const mc = monteCarloPnl(snap.lockedArbProfit)
  console.log(`\n--- Portfolio ---`)
  console.log(`  Equity:            $${snap.equity.toFixed(2)}`)
  console.log(`  Cash:              $${snap.cash.toFixed(2)}`)
  console.log(`  Locked arb profit: $${snap.lockedArbProfit.toFixed(4)}`)
  console.log(`  Slippage cost:     $${snap.totalSlippageCost.toFixed(4)}`)
  console.log(`  Net after slip:    $${(snap.lockedArbProfit - snap.totalSlippageCost).toFixed(4)}`)
  console.log(`  MC P05:            $${mc.p05.toFixed(4)}`)

  if (result.alerts.length > 0) {
    console.log('\n--- Alerts ---')
    for (const a of result.alerts) console.log(`  ${a}`)
  }

  // Save session
  const filledOrders = portfolio.orders.filter((o) => o.status !== 'REJECTED')
  saveSession({
    wallet: { address: wallet.address, safeAddress: wallet.safeAddress, privateKey: wallet.privateKey },
    updatedAt: new Date().toISOString(),
    portfolio: { initialEquity: config.portfolio.initialEquity, cash: portfolio.cashBalance, equity: portfolio.equity, peakEquity: portfolio.peakEquity },
    positions: Array.from(portfolio.positions.values()),
    orders: portfolio.orders,
    stats: {
      totalTrades: portfolio.orders.length,
      fillRate: filledOrders.length / Math.max(1, portfolio.orders.length),
      totalArbProfit: snap.lockedArbProfit,
      totalSlippageCost: snap.totalSlippageCost,
      sessionsRun: 1,
    },
  })

  console.log(`\n  Session saved to: ${getSessionPath()}`)
  console.log('=== Done ===')
}

void main()
