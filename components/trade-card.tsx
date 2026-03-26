"use client"

import { useState, useEffect, useCallback } from "react"
import confetti from "canvas-confetti"
import { usePrivy, useWallets } from "@privy-io/react-auth"
import { toast } from "sonner"
import { parseUnits } from "viem"
import { polygon } from "viem/chains"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import type { Market } from "@/lib/gamma"
import { parsePrices } from "@/lib/prices"
import { useTrading } from "@/hooks/use-trading"
import { useUsdcBalance } from "@/hooks/use-usdc-balance"
import { usePositionBalance } from "@/hooks/use-position-balance"
import { deriveSafeAddress, createEthersSigner, transferToSafe } from "@/lib/polymarket/relayer"

export function TradeCard({
  markets,
  selectedMarketId,
  selectedSide,
}: {
  markets: Market[]
  selectedMarketId?: string
  selectedSide?: "yes" | "no"
}) {
  const [tab, setTab] = useState<"buy" | "sell">("buy")
  const [side, setSide] = useState<"yes" | "no">(selectedSide ?? "yes")
  const [amount, setAmount] = useState(0)
  const { authenticated, login, user } = usePrivy()
  const { wallets } = useWallets()
  const { isPlacingOrder, isInitializing, error, trade } = useTrading()
  const [isTransferring, setIsTransferring] = useState(false)

  const walletAddr = user?.wallet?.address
  const safeAddress = walletAddr ? deriveSafeAddress(walletAddr) : undefined

  const { balance: rawSafeBalance, loading: safeBalanceLoading } = useUsdcBalance(safeAddress)
  const safeBalanceNum = rawSafeBalance ? Number(rawSafeBalance) : 0

  const { balance: rawEoaBalance } = useUsdcBalance(walletAddr)
  const eoaBalanceNum = rawEoaBalance ? Number(rawEoaBalance) : 0
  const hasEoaFunds = authenticated && eoaBalanceNum > 0 && safeBalanceNum === 0

  const market = markets.find((m) => m.id === selectedMarketId) ?? markets[0]
  let tokenIds: string[] = []
  try {
    if (market) tokenIds = JSON.parse(market.clobTokenIds) as string[]
  } catch {}
  const tokenId = side === "yes" ? tokenIds[0] : tokenIds[1]

  const { balance: rawPositionBalance, loading: positionBalanceLoading } = usePositionBalance(safeAddress, tokenId)
  const positionBalanceNum = rawPositionBalance ? Number(rawPositionBalance) : 0

  const isBuy = tab === "buy"
  const balanceNum = isBuy ? safeBalanceNum : positionBalanceNum
  const balanceLoading = isBuy ? safeBalanceLoading : positionBalanceLoading
  const balanceLabel = isBuy ? "Balance" : "Shares"
  const balanceDisplay = isBuy
    ? `$${balanceNum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `${balanceNum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`

  const handleTransferToSafe = useCallback(async () => {
    if (!walletAddr || !safeAddress || eoaBalanceNum <= 0) return

    setIsTransferring(true)
    const toastId = toast.loading(`Transferring $${eoaBalanceNum.toFixed(2)} to trading wallet...`)

    try {
      const wallet = wallets.find((w) => w.address === walletAddr) ?? wallets[0]
      if (!wallet) throw new Error("No wallet found")
      await wallet.switchChain(polygon.id)
      const provider = await wallet.getEthereumProvider()
      const signer = createEthersSigner(provider)

      const amountRaw = parseUnits(rawEoaBalance!, 6)
      await transferToSafe(signer, safeAddress, amountRaw)

      toast.success(`Transferred $${eoaBalanceNum.toFixed(2)} to trading wallet`, { id: toastId })
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Transfer failed"
      toast.error(msg, { id: toastId })
    } finally {
      setIsTransferring(false)
    }
  }, [walletAddr, safeAddress, eoaBalanceNum, rawEoaBalance, wallets])

  useEffect(() => {
    if (selectedSide) setSide(selectedSide)
  }, [selectedSide])

  useEffect(() => {
    if (error && !isPlacingOrder) {
      toast.error(error)
    }
  }, [error, isPlacingOrder])

  if (!market) return null

  const [yesPrice, noPrice] = parsePrices(market)
  const yesCents = (yesPrice * 100).toFixed(1)
  const noCents = (noPrice * 100).toFixed(1)
  const price = side === "yes" ? yesPrice : noPrice
  const total = amount
  const toWin = price > 0 ? (amount / price - amount) : 0
  const label = market.groupItemTitle || market.question

  const handleTrade = async () => {
    if (!authenticated) {
      login()
      return
    }

    if (!tokenId || amount <= 0) return

    const sideLabel = side === "yes" ? "Yes" : "No"
    const actionLabel = isBuy ? "Buying" : "Selling"
    const toastId = toast.loading(`${actionLabel} ${sideLabel}...`)

    const result = await trade({
      tokenId,
      side,
      action: tab,
      amount,
      price,
    })

    if (result) {
      const end = Date.now() + 800
      const frame = () => {
        confetti({
          particleCount: 4,
          angle: 120,
          spread: 60,
          startVelocity: 40,
          origin: { x: 1, y: 0.5 },
        })
        if (Date.now() < end) requestAnimationFrame(frame)
      }
      frame()
      toast.success(
        isBuy
          ? `Bought ${sideLabel} for $${amount.toFixed(2)}`
          : `Sold ${amount} ${sideLabel} shares`,
        {
          id: toastId,
          description: isBuy
            ? `Potential payout: $${(amount / price).toFixed(2)}`
            : `Est. return: $${(amount * price).toFixed(2)}`,
        },
      )
      setAmount(0)
    } else {
      toast.error("Order failed", {
        id: toastId,
        description: error ?? "Something went wrong. Please try again.",
      })
    }
  }

  const isLoading = isPlacingOrder || isInitializing
  const insufficientBalance = authenticated && amount > 0 && amount > balanceNum

  return (
    <div className="rounded-2xl border bg-card p-5">
      <div className="flex items-center justify-between">
        <div className="flex border-b">
          <button
            onClick={() => { setTab("buy"); setAmount(0) }}
            className={`px-4 pb-2 text-sm font-medium border-b-2 transition-colors ${
              tab === "buy"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Buy
          </button>
          <button
            onClick={() => { setTab("sell"); setAmount(0) }}
            className={`px-4 pb-2 text-sm font-medium border-b-2 transition-colors ${
              tab === "sell"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Sell
          </button>
        </div>
        <span className="text-xs text-muted-foreground">Market</span>
      </div>

      <h3 className="font-semibold text-lg mt-4 line-clamp-2">{label}</h3>

      <div className="grid grid-cols-2 gap-2 mt-3">
        <button
          onClick={() => setSide("yes")}
          className={`rounded-lg py-2.5 text-sm font-semibold transition-colors ${
            side === "yes"
              ? "bg-teal-100 text-teal-700 dark:bg-teal-950/40 dark:text-teal-400"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
        >
          Yes {yesCents}¢
        </button>
        <button
          onClick={() => setSide("no")}
          className={`rounded-lg py-2.5 text-sm font-semibold transition-colors ${
            side === "no"
              ? "bg-red-100 text-red-700/80 dark:bg-red-950/30 dark:text-red-400"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
        >
          No {noCents}¢
        </button>
      </div>

      <div className="flex items-center justify-between mt-5">
        <span className="text-sm text-muted-foreground">Amount</span>
        <div className="flex items-center border rounded-full overflow-hidden">
          <button
            onClick={() => setAmount(Math.max(0, amount - 1))}
            className="px-3 py-1.5 text-sm hover:bg-muted transition-colors"
          >
            −
          </button>
          <div className="flex items-center px-1 py-1.5">
            <span className="text-sm text-muted-foreground">$</span>
            <input
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
              className="w-12 text-sm font-medium text-center bg-transparent outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          </div>
          <button
            onClick={() => setAmount(amount + 1)}
            className="px-3 py-1.5 text-sm hover:bg-muted transition-colors"
          >
            +
          </button>
        </div>
      </div>

      {hasEoaFunds && (
        <div className="mt-4 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/20 p-3">
          <p className="text-xs text-amber-700 dark:text-amber-400">
            You have <strong>${eoaBalanceNum.toFixed(2)}</strong> on your wallet. Transfer to your trading wallet to start trading.
          </p>
          <Button
            size="sm"
            className="mt-2 w-full h-8 text-xs bg-amber-600 hover:bg-amber-700 text-white"
            disabled={isTransferring}
            onClick={handleTransferToSafe}
          >
            {isTransferring ? <Spinner className="size-3" /> : `Transfer $${eoaBalanceNum.toFixed(2)} to Trading Wallet`}
          </Button>
        </div>
      )}

      <div className="flex items-center justify-between mt-3">
        <span className="text-sm text-muted-foreground">{balanceLabel}</span>
        <span className="text-sm font-medium">
          {balanceLoading ? <Spinner className="size-3" /> : balanceDisplay}
        </span>
      </div>
      <div className="flex gap-1.5 justify-end mt-2">
        {[10, 50, 100].map((v) => (
          <button
            key={v}
            onClick={() => setAmount(v)}
            disabled={authenticated && v > balanceNum}
            className="rounded-full bg-muted px-3 py-1 text-xs font-medium hover:bg-muted/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {v}
          </button>
        ))}
        <button
          onClick={() => setAmount(Math.floor(balanceNum / 2))}
          disabled={!authenticated || balanceNum <= 0}
          className="rounded-full bg-muted px-3 py-1 text-xs font-medium hover:bg-muted/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Half
        </button>
        <button
          onClick={() => setAmount(Math.floor(balanceNum))}
          disabled={!authenticated || balanceNum <= 0}
          className="rounded-full bg-muted px-3 py-1 text-xs font-medium hover:bg-muted/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Max
        </button>
      </div>

      <Separator className="my-4" />

      {isBuy ? (
        <>
          <div className="flex items-center justify-between">
            <span className="text-sm">Total</span>
            <span className="text-sm font-medium">${total.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between mt-2">
            <span className="text-sm text-muted-foreground underline decoration-dotted">To Win</span>
            <span className="text-sm font-medium text-teal-600 dark:text-teal-400">${toWin.toFixed(2)}</span>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <span className="text-sm">Shares</span>
            <span className="text-sm font-medium">{amount}</span>
          </div>
          <div className="flex items-center justify-between mt-2">
            <span className="text-sm text-muted-foreground underline decoration-dotted">Est. Return</span>
            <span className="text-sm font-medium text-teal-600 dark:text-teal-400">${(amount * price).toFixed(2)}</span>
          </div>
        </>
      )}

      {insufficientBalance && (
        <div className="mt-3 text-xs text-amber-600 dark:text-amber-400">
          {isBuy
            ? `Insufficient balance. You need $${(amount - balanceNum).toFixed(2)} more.`
            : `Not enough shares. You have ${balanceNum.toFixed(2)} shares.`}
        </div>
      )}

      <Button
        className={`w-full h-12 text-sm font-semibold mt-4 border-0 transition-opacity ${
          side === "yes"
            ? "bg-teal-100 text-teal-700 hover:bg-teal-200 dark:bg-teal-950/40 dark:text-teal-400 dark:hover:bg-teal-950/60"
            : "bg-red-100 text-red-700/80 hover:bg-red-200 dark:bg-red-950/30 dark:text-red-400 dark:hover:bg-red-950/50"
        } ${amount <= 0 || insufficientBalance ? "opacity-40" : "opacity-100"}`}
        disabled={isLoading || insufficientBalance || (authenticated && amount <= 0)}
        onClick={handleTrade}
      >
        {isLoading ? (
          <Spinner className="size-4" />
        ) : !authenticated ? (
          "Sign In to Trade"
        ) : insufficientBalance ? (
          "Insufficient Balance"
        ) : (
          <>
            {tab === "buy" ? "Buy" : "Sell"} {markets.length > 1 ? `${label} — ` : ""}{side === "yes" ? "Yes" : "No"}!
          </>
        )}
      </Button>
    </div>
  )
}
