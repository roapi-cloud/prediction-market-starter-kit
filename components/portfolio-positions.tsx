"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePrivy } from "@privy-io/react-auth"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table"
import { Spinner } from "@/components/ui/spinner"
import { getPositions, getClosedPositions, getActivity } from "@/lib/data-api"
import { deriveSafeAddress } from "@/lib/polymarket/relayer"
import type { Position, ClosedPosition, Activity } from "@/lib/data-api"

function formatUsd(n: number) {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function PnlCell({ value, percent }: { value: number; percent?: number }) {
  const color = value > 0 ? "text-teal-600 dark:text-teal-400" : value < 0 ? "text-red-600/80 dark:text-red-400" : "text-muted-foreground"
  return (
    <span className={color}>
      {value >= 0 ? "+" : ""}{formatUsd(value)}
      {percent !== undefined && (
        <span className="text-xs ml-1">({percent >= 0 ? "+" : ""}{percent.toFixed(1)}%)</span>
      )}
    </span>
  )
}

function EmptyState({ message }: { message: string }) {
  return <div className="py-12 text-center text-muted-foreground text-sm">{message}</div>
}

function PositionsTable({ positions }: { positions: Position[] }) {
  if (positions.length === 0) return <EmptyState message="No open positions" />
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Market</TableHead>
          <TableHead>Outcome</TableHead>
          <TableHead className="text-right">Shares</TableHead>
          <TableHead className="text-right">Avg Price</TableHead>
          <TableHead className="text-right">Current</TableHead>
          <TableHead className="text-right">P&L</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {positions.map((p) => (
          <TableRow key={`${p.conditionId}-${p.outcomeIndex}`} className="h-14">
            <TableCell>
              <Link href={`/${p.eventSlug}`} className="flex items-center gap-3 hover:underline">
                {p.icon && <img src={p.icon} alt="" className="size-8 rounded-lg object-cover shrink-0" />}
                <span className="text-sm font-medium line-clamp-1 max-w-xs">{p.title}</span>
              </Link>
            </TableCell>
            <TableCell>
              <span className={`text-sm font-medium ${p.outcome === "Yes" ? "text-teal-600 dark:text-teal-400" : "text-red-600/80 dark:text-red-400"}`}>
                {p.outcome}
              </span>
            </TableCell>
            <TableCell className="text-right text-sm">{p.size.toFixed(2)}</TableCell>
            <TableCell className="text-right text-sm">{(p.avgPrice * 100).toFixed(1)}¢</TableCell>
            <TableCell className="text-right text-sm font-medium">{formatUsd(p.currentValue)}</TableCell>
            <TableCell className="text-right text-sm">
              <PnlCell value={p.cashPnl} percent={p.percentPnl} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function ClosedTable({ positions }: { positions: ClosedPosition[] }) {
  if (positions.length === 0) return <EmptyState message="No closed positions" />
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Market</TableHead>
          <TableHead>Outcome</TableHead>
          <TableHead className="text-right">Avg Price</TableHead>
          <TableHead className="text-right">Invested</TableHead>
          <TableHead className="text-right">Realized P&L</TableHead>
          <TableHead className="text-right">Date</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {positions.map((p) => (
          <TableRow key={`${p.conditionId}-${p.outcomeIndex}`} className="h-14">
            <TableCell>
              <Link href={`/${p.eventSlug}`} className="flex items-center gap-3 hover:underline">
                {p.icon && <img src={p.icon} alt="" className="size-8 rounded-lg object-cover shrink-0" />}
                <span className="text-sm font-medium line-clamp-1 max-w-xs">{p.title}</span>
              </Link>
            </TableCell>
            <TableCell>
              <span className={`text-sm font-medium ${p.outcome === "Yes" ? "text-teal-600 dark:text-teal-400" : "text-red-600/80 dark:text-red-400"}`}>
                {p.outcome}
              </span>
            </TableCell>
            <TableCell className="text-right text-sm">{(p.avgPrice * 100).toFixed(1)}¢</TableCell>
            <TableCell className="text-right text-sm">{formatUsd(p.totalBought)}</TableCell>
            <TableCell className="text-right text-sm">
              <PnlCell value={p.realizedPnl} />
            </TableCell>
            <TableCell className="text-right text-sm text-muted-foreground">
              {new Date(p.timestamp * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function ActivityTable({ activities }: { activities: Activity[] }) {
  if (activities.length === 0) return <EmptyState message="No activity" />
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Market</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Side</TableHead>
          <TableHead>Outcome</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          <TableHead className="text-right">Price</TableHead>
          <TableHead className="text-right">Date</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {activities.map((a, i) => (
          <TableRow key={`${a.transactionHash}-${i}`} className="h-14">
            <TableCell>
              <Link href={`/${a.eventSlug}`} className="flex items-center gap-3 hover:underline">
                {a.icon && <img src={a.icon} alt="" className="size-8 rounded-lg object-cover shrink-0" />}
                <span className="text-sm font-medium line-clamp-1 max-w-xs">{a.title}</span>
              </Link>
            </TableCell>
            <TableCell>
              <span className="text-xs rounded-full bg-muted px-2 py-0.5 font-medium">{a.type}</span>
            </TableCell>
            <TableCell>
              <span className={`text-sm font-medium ${a.side === "BUY" ? "text-teal-600 dark:text-teal-400" : "text-red-600/80 dark:text-red-400"}`}>
                {a.side}
              </span>
            </TableCell>
            <TableCell className="text-sm">{a.outcome}</TableCell>
            <TableCell className="text-right text-sm font-medium">{formatUsd(a.usdcSize)}</TableCell>
            <TableCell className="text-right text-sm">{(a.price * 100).toFixed(1)}¢</TableCell>
            <TableCell className="text-right text-sm text-muted-foreground">
              {new Date(a.timestamp * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function PortfolioPositions() {
  const { user } = usePrivy()
  const eoaAddr = user?.wallet?.address
  const walletAddr = eoaAddr ? deriveSafeAddress(eoaAddr) : undefined

  const [positions, setPositions] = useState<Position[]>([])
  const [closed, setClosed] = useState<ClosedPosition[]>([])
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(!!walletAddr)

  useEffect(() => {
    if (!walletAddr) return

    setLoading(true)
    Promise.all([
      getPositions(walletAddr),
      getClosedPositions(walletAddr),
      getActivity(walletAddr),
    ]).then(([pos, cls, act]) => {
      setPositions(pos)
      setClosed(cls)
      setActivities(act)
    }).finally(() => setLoading(false))
  }, [walletAddr])

  if (!walletAddr) {
    return <EmptyState message="Connect your wallet to view positions" />
  }

  if (loading) {
    return <div className="flex justify-center py-16"><Spinner className="size-6" /></div>
  }

  return (
    <Tabs defaultValue="positions">
      <TabsList variant="line">
        <TabsTrigger value="positions">Positions ({positions.length})</TabsTrigger>
        <TabsTrigger value="closed">Closed ({closed.length})</TabsTrigger>
        <TabsTrigger value="activity">Activity ({activities.length})</TabsTrigger>
      </TabsList>
      <TabsContent value="positions" className="pt-2">
        <PositionsTable positions={positions} />
      </TabsContent>
      <TabsContent value="closed" className="pt-2">
        <ClosedTable positions={closed} />
      </TabsContent>
      <TabsContent value="activity" className="pt-2">
        <ActivityTable activities={activities} />
      </TabsContent>
    </Tabs>
  )
}
