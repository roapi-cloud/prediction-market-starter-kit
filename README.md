# Prediction Market Starter Kit

A full-stack prediction market app built with Next.js and Polymarket. Browse markets, place trades, and manage positions — all with gasless onboarding through embedded wallets.

## Features

- **Browse & search** — Infinite-scroll event feed, real-time market search, price history charts
- **Trade** — Buy and sell outcome shares via Polymarket's CLOB orderbook
- **Gasless onboarding** — Gnosis Safe wallets deployed and configured automatically, no gas needed
- **Embedded wallets** — Users sign in with email or wallet via Privy, no extensions required
- **Portfolio** — View open positions, closed positions, and trade history

## Architecture

```
app/                    → Next.js App Router pages + API routes
components/             → React components (feature + shadcn/ui)
hooks/                  → Trading session, on-chain balance hooks
lib/polymarket/         → CLOB client, relayer, session persistence
lib/                    → Gamma API, Data API, price utils
```

**Trading flow:**

1. User signs in via Privy (email or wallet)
2. On first trade: derive Safe address → deploy Safe → create CLOB API keys → set token approvals (all gasless)
3. Session is persisted to localStorage — returning users skip setup
4. Orders are signed client-side (EIP-712) and attributed via server-side HMAC (Builder Program)

## Getting started

### Prerequisites

- [Node.js 18+](https://nodejs.org)
- [pnpm](https://pnpm.io)
- A [Privy](https://dashboard.privy.io) app ID
- [Polymarket Builder](https://polymarket.com/settings?tab=builder) API credentials

### Setup

```bash
git clone https://github.com/anthropics/prediction-market-starter-kit.git
cd prediction-market-starter-kit
pnpm install
```

Copy the example env file and fill in your credentials:

```bash
cp .env.example .env.local
```

Run the dev server:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

### Builder Program

The server-side signing endpoint at `/api/builder-sign` keeps your builder secret off the client.

## Tech stack

| Layer      | Tech                                                                                |
| ---------- | ----------------------------------------------------------------------------------- |
| Framework  | [Next.js 16](https://nextjs.org) (App Router, Turbopack)                            |
| Auth       | [Privy](https://privy.io) (embedded wallets, email login)                           |
| Trading    | [Polymarket CLOB](https://docs.polymarket.com) (limit orders, GTC)                  |
| Onboarding | [Polymarket Relayer](https://docs.polymarket.com) (gasless Safe deploy + approvals) |
| Styling    | [Tailwind CSS 4](https://tailwindcss.com) + [shadcn/ui](https://ui.shadcn.com)      |
| Charts     | [Recharts](https://recharts.org)                                                    |
| Chain      | Polygon PoS (USDC.e, CTF outcome tokens)                                            |

## Scripts

```bash
pnpm dev        # Start dev server with Turbopack
pnpm build      # Production build
pnpm start      # Start production server
pnpm lint       # Run ESLint
pnpm typecheck  # Run TypeScript compiler checks
pnpm format     # Format with Prettier
```

## License

MIT
