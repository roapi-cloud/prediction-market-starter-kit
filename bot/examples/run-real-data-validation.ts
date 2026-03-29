import { fetchRealTicks } from '../integration/real-data'
import { runEngine } from '../core/run-engine'

async function main(): Promise<void> {
  const ticks = await fetchRealTicks(30)
  if (ticks.length === 0) {
    throw new Error('No real ticks fetched from Polymarket Gamma API')
  }

  console.log(`Loaded ${ticks.length} market ticks`)
  for (const tick of ticks) {
    const sum = tick.yesAsk + tick.noAsk
    const grossBps = Math.round((1 - sum) * 10_000)
    console.log(
      `  ${tick.marketId.padEnd(25)} YES=${tick.yesAsk.toFixed(2)} NO=${tick.noAsk.toFixed(2)} ` +
        `Sum=${sum.toFixed(4)} GrossEV=${grossBps}bps`,
    )
  }

  const result = runEngine(ticks)
  console.log('\n' + JSON.stringify({ source: 'real-data', ticks: ticks.length, ...result }, null, 2))
}

void main()
