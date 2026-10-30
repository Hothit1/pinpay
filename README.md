# PinPay

**Pay-per-result marketing for autonomous agents on NEAR.** A shop locks a NEAR budget in a campaign. AI agents decide whether the campaign is worth their gas, generate creatives and publish them. An oracle the shop trusts reports clicks, and the contract pays each agent for every new verified click, instantly, until the budget runs out. After the deadline the shop takes back whatever was not earned.

Built at **NEAR HACKATHON** (2026-11-01 → 2026-11-14 UTC).

- Tracks: Agent Economy (`agents`), Autonomous Business (`business`)
- Prize wallet (NEAR mainnet implicit account): `7282719d326efc49f024b38da5f9f2346b2413fa04eb1ee7042ae7a3c2588344`
- Sister project (independent, same author, per rule Q-015): **DeadDrop**, https://github.com/Hothit1/deaddrop
- Live dashboard (testnet run): https://hothit1.github.io/pinpay/

> **All audience data is synthetic.** Views and clicks come from a seeded simulator (`sim/src/market.js`), not a real social network. The money is real contract calls: on a local sandbox, or on NEAR testnet.

## Why

Paying marketers (human or AI) up front means paying for promises. PinPay flips it: the budget sits in escrow and moves only when results arrive. That makes it safe for a shop to hire agents it has never met, and gives agents a clear, on-chain price for their work: an open market where any agent can compete.

## How it works

```
 shop ──create_campaign(deposit, price/click, oracle, duration)──▶ ┌──────────────┐
 agent ─────────────────submit_post(content_hash, uri)───────────▶ │    PinPay    │ ──▶ NEAR to agent
 oracle ─────────report_clicks(post, cumulative clicks)──────────▶ │   contract   │     (new clicks × price)
 shop ───────────────close_campaign() after deadline─────────────▶ └──────────────┘ ──▶ refund to shop
```

| Piece | Path | What it does |
|---|---|---|
| Contract | `contract/src/lib.rs` | Escrow, per-click payouts capped by budget, monotonic click reports, refunds, leaderboard. NEP-297 style `EVENT_JSON` logs. |
| Agents | `sim/src/agent.js` | Each agent reads open campaigns, estimates expected earnings (CTR × impressions × price) against gas cost, and posts only if profitable. It learns per-campaign CTR from its own analytics (epsilon-greedy over creative styles). |
| Creatives | `sim/src/creative.js` | Captions + SVG ad cards. Offline templates by default; set `ANTHROPIC_API_KEY` and captions are written by Claude. `content_hash` = sha256 of the creative, stored on chain. |
| Oracle | `sim/src/oracle.js` | Reads platform analytics and reports cumulative clicks per post. |
| Market | `sim/src/market.js` | Deterministic synthetic audience: each campaign has a taste for creative styles; impressions decay with post age. |
| Dashboard | `web/index.html` | Static page: KPIs, leaderboard, every creative with its earnings, payout log with explorer links. |

### Contract rules (enforced on chain)
- Budget = attached deposit; agents are paid `new_clicks × price_per_click`, capped by remaining budget. Clicks beyond the budget are recorded as `clicks_unpaid`.
- Only the campaign's oracle can report, and click counts can only grow (no double pay).
- The shop cannot post to its own campaign; no posts after the deadline.
- Only the shop can close, only after the deadline, and closing refunds the rest.

### Trust model (honest limits)
The oracle is a **trusted party chosen per campaign by the shop**. PinPay removes the need to trust the agent; it does not remove the need to trust the measurement. Natural next steps: oracle in a TEE with attestation, multiple oracles with a quorum, or click proofs signed by the platform.

## Run it

Requirements: Rust (the pinned toolchain in `contract/rust-toolchain.toml` installs automatically via rustup), [`cargo-near`](https://github.com/near/cargo-near), Node.js ≥ 20. No keys, no accounts: the local demo starts its own NEAR sandbox.

```bash
make test        # contract unit tests + build wasm + end-to-end test on a local sandbox
make demo        # full story on a local sandbox, writes web/data/run-sandbox.json
make web         # dashboard at http://localhost:8080/?run=sandbox
```

On testnet (needs a funded testnet account whose key is in `~/.near-credentials/testnet/`):

```bash
PINPAY_MASTER=<you>.testnet make demo-testnet   # writes web/data/run-testnet.json
PINPAY_MASTER=<you>.testnet npm --prefix sim run sweep   # return leftover test NEAR
```

Example output (local sandbox):

```
=== Results (synthetic audience) ===
Lumen Candles — autumn launch: 9 posts, 421 paid clicks, spent 1.263 NEAR
Trailhead Coffee — cold brew: 9 posts, 400 paid clicks, spent 2 NEAR

Leaderboard:
  agent-gen-…        348 clicks  1.364 NEAR
  agent-muse-…       268 clicks  1.026 NEAR
  agent-blitz-…      205 clicks  0.873 NEAR
```

## Tests

- `contract/`: 8 unit tests (payout math, budget cap, oracle-only, monotonic clicks, self-dealing, deadline, refund).
- `sim/test/e2e.test.js`: deploys the real wasm to a local sandbox, runs the whole market and checks on chain that `payouts + refund = budget` for every campaign, `earned = price × paid clicks` for every post, agent wallets actually grew, and a non-oracle cannot report.
- CI runs both on every push (`.github/workflows/ci.yml`).

## Third-party code
`near-sdk` (Rust), `near-api-js`, `near-sandbox`. Shop names and all metrics are fictional.

## License
MIT
