"use client"

import { useEffect, useState } from "react"
import { createPublicClient, http, formatUnits } from "viem"
import { polygon } from "viem/chains"
import { CTF_ADDRESS } from "@/lib/polymarket/constants"

const ERC1155_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "id", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const

const client = createPublicClient({
  chain: polygon,
  transport: http(),
})

export function usePositionBalance(address: string | undefined, tokenId: string | undefined) {
  const [balance, setBalance] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!address || !tokenId) return

    let cancelled = false
    setLoading(true)

    client
      .readContract({
        address: CTF_ADDRESS as `0x${string}`,
        abi: ERC1155_ABI,
        functionName: "balanceOf",
        args: [address as `0x${string}`, BigInt(tokenId)],
      })
      .then((raw) => {
        if (!cancelled) setBalance(formatUnits(raw, 6))
      })
      .catch(() => {
        if (!cancelled) setBalance(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [address, tokenId])

  return { balance, loading }
}
