import { NextResponse } from "next/server"
import { buildHmacSignature } from "@polymarket/builder-signing-sdk"

export async function POST(request: Request) {
  const origin = request.headers.get("origin")
  const referer = request.headers.get("referer")
  if (!origin && !referer) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const key = process.env.POLY_BUILDER_API_KEY
  const secret = process.env.POLY_BUILDER_SECRET
  const passphrase = process.env.POLY_BUILDER_PASSPHRASE

  if (!key || !secret || !passphrase) {
    return NextResponse.json({ error: "Builder credentials not configured" }, { status: 500 })
  }

  try {
    const { method, path, body } = await request.json()
    const sigTimestamp = Date.now().toString()

    const signature = buildHmacSignature(
      secret,
      parseInt(sigTimestamp),
      method,
      path,
      body,
    )

    return NextResponse.json({
      POLY_BUILDER_SIGNATURE: signature,
      POLY_BUILDER_TIMESTAMP: sigTimestamp,
      POLY_BUILDER_API_KEY: key,
      POLY_BUILDER_PASSPHRASE: passphrase,
    })
  } catch {
    return NextResponse.json({ error: "Internal signing error" }, { status: 500 })
  }
}
