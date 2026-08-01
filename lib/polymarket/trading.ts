"use client"

import { ClobClient, Side, OrderType } from "@polymarket/clob-client"
import { BuilderConfig } from "@polymarket/builder-signing-sdk"
import type { providers } from "ethers"
import { CHAIN_ID, CLOB_URL } from "./constants"

export type TradeParams = {
  tokenId: string
  side: "yes" | "no"
  action: "buy" | "sell"
  amount: number
  price: number
}

export type ApiCredentials = {
  key: string
  secret: string
  passphrase: string
}

const REMOTE_SIGNING_URL = () =>
  typeof window !== "undefined"
    ? `${window.location.origin}/api/builder-sign`
    : "/api/builder-sign"

export async function getOrCreateApiCredentials(
  ethersSigner: providers.JsonRpcSigner
): Promise<ApiCredentials> {
  const tempClient = new ClobClient(CLOB_URL, CHAIN_ID, ethersSigner)

  const derived = await tempClient.deriveApiKey().catch(() => null)
  if (derived?.key && derived?.secret && derived?.passphrase) {
    return derived
  }

  return tempClient.createApiKey()
}

export function createTradingClient(
  ethersSigner: providers.JsonRpcSigner,
  apiCreds: ApiCredentials,
  safeAddress: string
) {
  const builderConfig = new BuilderConfig({
    remoteBuilderConfig: {
      url: REMOTE_SIGNING_URL(),
    },
  })

  return new ClobClient(
    CLOB_URL,
    CHAIN_ID,
    ethersSigner,
    apiCreds,
    2,
    safeAddress,
    undefined,
    false,
    builderConfig
  )
}

export async function placeOrder(client: ClobClient, params: TradeParams) {
  if (
    isNaN(params.price) ||
    isNaN(params.amount) ||
    params.price <= 0 ||
    params.amount <= 0
  ) {
    throw new Error(
      `Invalid order params: price=${params.price}, amount=${params.amount}`
    )
  }

  return client.createAndPostOrder(
    {
      tokenID: params.tokenId,
      price: params.price,
      size: params.amount,
      side: params.action === "sell" ? Side.SELL : Side.BUY,
      feeRateBps: 0,
      expiration: 0,
      taker: "0x0000000000000000000000000000000000000000",
    },
    {},
    OrderType.GTC
  )
}

export async function getOpenOrders(client: ClobClient) {
  return client.getOpenOrders()
}

export async function cancelOrder(client: ClobClient, orderId: string) {
  return client.cancelOrder({ orderID: orderId })
}
