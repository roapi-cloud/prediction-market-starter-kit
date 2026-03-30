"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts"

type StrategyType =
  | "static_arb"
  | "stat_arb"
  | "microstructure"
  | "term_structure"

type StrategyStats = {
  strategy: StrategyType
  totalTrades: number
  filledTrades: number
  winRate: number
  totalPnl: number
  avgEvBps: number
  maxDrawdown: number
  equityCurve: number[]
}

type PaperPosition = {
  marketId: string
  side: "YES" | "NO"
  size: number
  avgEntry: number
  currentPrice: number
  unrealizedPnl: number
}

type PaperOrder = {
  id: string
  ts: number
  marketId: string
  side: "YES" | "NO"
  action: "BUY" | "SELL"
  price: number
  size: number
  status: "FILLED" | "PARTIAL" | "REJECTED"
  filledSize: number
  pnl: number
  strategy: StrategyType
}

type SessionData = {
  exists: boolean
  message?: string
  wallet?: {
    address: string
    safeAddress: string
  }
  updatedAt?: string
  portfolio?: {
    initialEquity: number
    cash: number
    equity: number
    peakEquity: number
  }
  positions?: PaperPosition[]
  orders?: PaperOrder[]
  stats?: {
    totalTrades: number
    fillRate: number
    totalArbProfit: number
    totalSlippageCost: number
    sessionsRun: number
  }
  strategyStats?: StrategyStats[]
}

const STRATEGY_LABELS: Record<StrategyType, string> = {
  static_arb: "Static Arb",
  stat_arb: "Stat Arb",
  microstructure: "Microstructure",
  term_structure: "Term Structure",
}

const STRATEGY_COLORS: Record<StrategyType, string> = {
  static_arb: "#22c55e",
  stat_arb: "#3b82f6",
  microstructure: "#f59e0b",
  term_structure: "#ec4899",
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString()
}

function formatPnl(value: number): string {
  const sign = value >= 0 ? "+" : ""
  return `${sign}$${value.toFixed(2)}`
}

function formatPct(value: number): string {
  const sign = value >= 0 ? "+" : ""
  return `${sign}${value.toFixed(2)}%`
}

function formatDrawdown(value: number): string {
  return `${(value * 100).toFixed(2)}%`
}

export default function PaperTradingPage() {
  const [data, setData] = useState<SessionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())
  const [selectedStrategy, setSelectedStrategy] = useState<
    StrategyType | "all"
  >("all")
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 20

  const fetchData = async () => {
    try {
      const res = await fetch("/api/paper-session")
      const json = await res.json()
      setData(json)
      setError(null)
      setLastRefresh(new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 10000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    setCurrentPage(1)
  }, [selectedStrategy])

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner className="size-8" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto max-w-[90rem] px-6 py-6">
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive">
          Error: {error}
        </div>
      </div>
    )
  }

  if (!data?.exists) {
    return (
      <div className="mx-auto max-w-[90rem] px-6 py-6">
        <div className="rounded-lg border bg-card p-8 text-center">
          <h2 className="mb-2 text-xl font-semibold">No Active Session</h2>
          <p className="text-muted-foreground">
            {data?.message || "Start the paper trading bot to see data here."}
          </p>
          <code className="mt-4 inline-block rounded bg-muted px-3 py-1.5 text-sm">
            pnpm bot:daemon
          </code>
        </div>
      </div>
    )
  }

  const {
    portfolio,
    positions,
    orders,
    stats,
    wallet,
    updatedAt,
    strategyStats,
  } = data
  const totalPnl = portfolio ? portfolio.equity - portfolio.initialEquity : 0
  const pnlPct = portfolio ? (totalPnl / portfolio.initialEquity) * 100 : 0
  const drawdown = portfolio
    ? ((portfolio.peakEquity - portfolio.equity) / portfolio.peakEquity) * 100
    : 0

  const filteredOrders =
    selectedStrategy === "all"
      ? orders
      : orders?.filter((o) => o.strategy === selectedStrategy)

  const equityChartData =
    strategyStats?.flatMap((s) =>
      s.equityCurve.map((eq, i) => ({
        index: i,
        [s.strategy]: eq,
      }))
    ) ?? []

  const mergedChartData: Array<{ index: number; [key: string]: number }> = []
  for (const point of equityChartData) {
    const existing = mergedChartData.find((p) => p.index === point.index)
    if (existing) {
      Object.assign(existing, point)
    } else {
      mergedChartData.push(point)
    }
  }

  return (
    <div className="mx-auto max-w-[90rem] space-y-6 px-6 py-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Multi-Strategy Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Last updated:{" "}
            {updatedAt ? new Date(updatedAt).toLocaleString() : "N/A"}
          </p>
        </div>
        <button
          onClick={fetchData}
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          Refresh ({lastRefresh.toLocaleTimeString()})
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Equity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${portfolio?.equity.toFixed(2) ?? "0.00"}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Cash
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${portfolio?.cash.toFixed(2) ?? "0.00"}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total P&L
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${totalPnl >= 0 ? "text-green-600" : "text-red-600"}`}
            >
              {formatPnl(totalPnl)}
            </div>
            <div
              className={`text-sm ${pnlPct >= 0 ? "text-green-600" : "text-red-600"}`}
            >
              {formatPct(pnlPct)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Drawdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {drawdown.toFixed(2)}%
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Positions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{positions?.length ?? 0}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Trades
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.totalTrades ?? 0}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Strategy Performance Comparison</CardTitle>
        </CardHeader>
        <CardContent>
          {strategyStats && strategyStats.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Strategy</TableHead>
                    <TableHead className="text-right">Trades</TableHead>
                    <TableHead className="text-right">Filled</TableHead>
                    <TableHead className="text-right">Win Rate</TableHead>
                    <TableHead className="text-right">P&L</TableHead>
                    <TableHead className="text-right">Avg EV (bps)</TableHead>
                    <TableHead className="text-right">Max DD</TableHead>
                    <TableHead className="text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {strategyStats.map((s) => (
                    <TableRow
                      key={s.strategy}
                      className={
                        selectedStrategy === s.strategy ? "bg-muted/50" : ""
                      }
                    >
                      <TableCell>
                        <button
                          onClick={() =>
                            setSelectedStrategy(
                              selectedStrategy === s.strategy
                                ? "all"
                                : s.strategy
                            )
                          }
                          className="flex items-center gap-2 hover:underline"
                        >
                          <span
                            className="inline-block h-3 w-3 rounded-full"
                            style={{
                              backgroundColor: STRATEGY_COLORS[s.strategy],
                            }}
                          />
                          <span className="font-medium">
                            {STRATEGY_LABELS[s.strategy]}
                          </span>
                        </button>
                      </TableCell>
                      <TableCell className="text-right">
                        {s.totalTrades}
                      </TableCell>
                      <TableCell className="text-right">
                        {s.filledTrades}
                      </TableCell>
                      <TableCell className="text-right">
                        {(s.winRate * 100).toFixed(1)}%
                      </TableCell>
                      <TableCell
                        className={`text-right font-medium ${s.totalPnl >= 0 ? "text-green-600" : "text-red-600"}`}
                      >
                        {formatPnl(s.totalPnl)}
                      </TableCell>
                      <TableCell className="text-right">
                        {s.avgEvBps.toFixed(1)}
                      </TableCell>
                      <TableCell className="text-right text-red-600">
                        {formatDrawdown(s.maxDrawdown)}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`rounded px-2 py-0.5 text-xs font-medium ${
                            s.filledTrades > 0
                              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                              : "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400"
                          }`}
                        >
                          {s.filledTrades > 0 ? "Active" : "Idle"}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="py-8 text-center text-muted-foreground">
              No strategy data available
            </div>
          )}
        </CardContent>
      </Card>

      {strategyStats && strategyStats.some((s) => s.equityCurve.length > 1) && (
        <Card>
          <CardHeader>
            <CardTitle>Strategy Equity Curves</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={mergedChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="index"
                    label={{ value: "Trade #", position: "bottom" }}
                  />
                  <YAxis
                    label={{
                      value: "Equity ($)",
                      angle: -90,
                      position: "insideLeft",
                    }}
                  />
                  <Tooltip
                    formatter={(value: number) => `$${value.toFixed(2)}`}
                  />
                  <Legend />
                  {strategyStats.map((s) =>
                    s.equityCurve.length > 1 ? (
                      <Line
                        key={s.strategy}
                        type="monotone"
                        dataKey={s.strategy}
                        name={STRATEGY_LABELS[s.strategy]}
                        stroke={STRATEGY_COLORS[s.strategy]}
                        strokeWidth={2}
                        dot={false}
                      />
                    ) : null
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Filter:</span>
        <button
          onClick={() => setSelectedStrategy("all")}
          className={`rounded px-3 py-1 text-sm transition-colors ${
            selectedStrategy === "all"
              ? "bg-primary text-primary-foreground"
              : "bg-muted hover:bg-muted/80"
          }`}
        >
          All Strategies
        </button>
        {strategyStats?.map((s) => (
          <button
            key={s.strategy}
            onClick={() => setSelectedStrategy(s.strategy)}
            className={`flex items-center gap-1 rounded px-3 py-1 text-sm transition-colors ${
              selectedStrategy === s.strategy
                ? "bg-primary text-primary-foreground"
                : "bg-muted hover:bg-muted/80"
            }`}
          >
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: STRATEGY_COLORS[s.strategy] }}
            />
            {STRATEGY_LABELS[s.strategy]}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            Open Positions ({positions?.length ?? 0})
            {selectedStrategy !== "all" &&
              ` - ${STRATEGY_LABELS[selectedStrategy]}`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!positions || positions.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              No open positions
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Market</TableHead>
                    <TableHead>Side</TableHead>
                    <TableHead className="text-right">Size</TableHead>
                    <TableHead className="text-right">Avg Entry</TableHead>
                    <TableHead className="text-right">Current Price</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead className="text-right">Unrealized P&L</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {positions.map((pos, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs">
                        {pos.marketId.slice(0, 20)}...
                      </TableCell>
                      <TableCell>
                        <span
                          className={`rounded px-2 py-0.5 text-xs font-medium ${pos.side === "YES" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"}`}
                        >
                          {pos.side}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        {pos.size.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">
                        ${pos.avgEntry.toFixed(4)}
                      </TableCell>
                      <TableCell className="text-right">
                        ${pos.currentPrice.toFixed(4)}
                      </TableCell>
                      <TableCell className="text-right">
                        ${(pos.size * pos.currentPrice).toFixed(2)}
                      </TableCell>
                      <TableCell
                        className={`text-right font-medium ${pos.unrealizedPnl >= 0 ? "text-green-600" : "text-red-600"}`}
                      >
                        {formatPnl(pos.unrealizedPnl)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            Trade History ({filteredOrders?.length ?? 0})
            {selectedStrategy !== "all" &&
              ` - ${STRATEGY_LABELS[selectedStrategy]}`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!filteredOrders || filteredOrders.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              No trades yet
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>ID</TableHead>
                      <TableHead>Strategy</TableHead>
                      <TableHead>Market</TableHead>
                      <TableHead>Side</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right">Size</TableHead>
                      <TableHead className="text-right">Filled</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredOrders
                      .slice()
                      .reverse()
                      .slice(
                        (currentPage - 1) * pageSize,
                        currentPage * pageSize
                      )
                      .map((order) => (
                        <TableRow key={order.id}>
                          <TableCell className="text-xs text-muted-foreground">
                            {formatTime(order.ts)}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {order.id}
                          </TableCell>
                          <TableCell>
                            <span className="flex items-center gap-1">
                              <span
                                className="inline-block h-2 w-2 rounded-full"
                                style={{
                                  backgroundColor:
                                    STRATEGY_COLORS[
                                      order.strategy ?? "static_arb"
                                    ],
                                }}
                              />
                              <span className="text-xs">
                                {
                                  STRATEGY_LABELS[
                                    order.strategy ?? "static_arb"
                                  ]
                                }
                              </span>
                            </span>
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {order.marketId.slice(0, 16)}...
                          </TableCell>
                          <TableCell>
                            <span
                              className={`rounded px-2 py-0.5 text-xs font-medium ${order.side === "YES" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"}`}
                            >
                              {order.side}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span
                              className={`rounded px-2 py-0.5 text-xs font-medium ${order.action === "BUY" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" : "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400"}`}
                            >
                              {order.action}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            ${order.price.toFixed(4)}
                          </TableCell>
                          <TableCell className="text-right">
                            {order.size.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right">
                            {order.filledSize.toFixed(2)}
                          </TableCell>
                          <TableCell>
                            <span
                              className={`rounded px-2 py-0.5 text-xs font-medium ${
                                order.status === "FILLED"
                                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                  : order.status === "PARTIAL"
                                    ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                                    : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                              }`}
                            >
                              {order.status}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex items-center justify-between pt-4">
                <div className="text-sm text-muted-foreground">
                  Page {currentPage} of{" "}
                  {Math.ceil(filteredOrders.length / pageSize)} (
                  {filteredOrders.length} trades)
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage(1)}
                    disabled={currentPage === 1}
                    className="rounded bg-muted px-2 py-1 text-sm transition-colors hover:bg-muted/80 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    First
                  </button>
                  <button
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="rounded bg-muted px-3 py-1 text-sm transition-colors hover:bg-muted/80 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Prev
                  </button>
                  <input
                    type="number"
                    value={currentPage}
                    onChange={(e) => {
                      const val = parseInt(e.target.value)
                      if (
                        val >= 1 &&
                        val <= Math.ceil(filteredOrders.length / pageSize)
                      ) {
                        setCurrentPage(val)
                      }
                    }}
                    min={1}
                    max={Math.ceil(filteredOrders.length / pageSize)}
                    className="w-12 rounded border bg-background px-2 py-1 text-center text-sm"
                  />
                  <button
                    onClick={() =>
                      setCurrentPage((p) =>
                        Math.min(
                          Math.ceil(filteredOrders.length / pageSize),
                          p + 1
                        )
                      )
                    }
                    disabled={
                      currentPage >= Math.ceil(filteredOrders.length / pageSize)
                    }
                    className="rounded bg-muted px-3 py-1 text-sm transition-colors hover:bg-muted/80 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Next
                  </button>
                  <button
                    onClick={() =>
                      setCurrentPage(
                        Math.ceil(filteredOrders.length / pageSize)
                      )
                    }
                    disabled={
                      currentPage >= Math.ceil(filteredOrders.length / pageSize)
                    }
                    className="rounded bg-muted px-2 py-1 text-sm transition-colors hover:bg-muted/80 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Last
                  </button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {wallet && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Wallet Info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="w-20 text-sm text-muted-foreground">EOA:</span>
              <code className="rounded bg-muted px-2 py-0.5 text-xs">
                {wallet.address || "N/A"}
              </code>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-20 text-sm text-muted-foreground">Safe:</span>
              <code className="rounded bg-muted px-2 py-0.5 text-xs">
                {wallet.safeAddress || "N/A"}
              </code>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
