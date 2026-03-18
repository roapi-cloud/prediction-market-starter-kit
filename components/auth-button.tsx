"use client"

import Link from "next/link"
import { usePrivy, useFundWallet } from "@privy-io/react-auth"
import { HugeiconsIcon } from "@hugeicons/react"
import { Login01Icon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import Avatar from "boring-avatars"
import { useUsdcBalance } from "@/hooks/use-usdc-balance"
import { deriveSafeAddress } from "@/lib/polymarket/relayer"

function UserAvatar({ seed }: { seed: string }) {
  return (
    <div className="size-7 shrink-0">
      <Avatar name={seed} variant="beam" size={28} />
    </div>
  )
}

export function AuthButton() {
  const { ready, authenticated, login, user } = usePrivy()
  const { fundWallet } = useFundWallet()
  const walletAddr = user?.wallet?.address
  const safeAddress = walletAddr ? deriveSafeAddress(walletAddr) : undefined
  const { balance, loading: balanceLoading } = useUsdcBalance(safeAddress)

  if (!ready) {
    return (
      <Button size="sm" disabled>
        <Spinner />
      </Button>
    )
  }

  if (authenticated && user) {
    const displayName =
      user.email?.address ??
      (walletAddr ? walletAddr.slice(0, 6) + "..." + walletAddr.slice(-4) : null) ??
      "Account"

    const formattedBalance = balance
      ? `$${Number(balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : "$0.00"

    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 text-sm mr-1">
          <span className="text-xs text-muted-foreground">Portfolio:</span>
          <span className="font-medium">
            {balanceLoading ? <Spinner className="size-3" /> : formattedBalance}
          </span>
        </div>
        <Link href="/portfolio">
          <UserAvatar seed={walletAddr ?? displayName} />
        </Link>
      </div>
    )
  }

  return (
    <Button size="sm" onClick={login}>
      <HugeiconsIcon icon={Login01Icon} className="size-4" />
      Sign In
    </Button>
  )
}
