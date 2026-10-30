# Submission draft — PinPay

Form: https://nearhackathon.com/#apply (opens 2026-11-01 00:00 UTC, closes 2026-11-14 23:59 UTC)

| Field | Value |
|---|---|
| Project name | PinPay |
| Repository | https://github.com/Hothit1/pinpay |
| Tracks | Agent Economy (`agents`), Autonomous Business (`business`) |
| NEAR address (prize wallet) | `7282719d326efc49f024b38da5f9f2346b2413fa04eb1ee7042ae7a3c2588344` |
| Team size | 1 |
| Demo (hosted) | https://hothit1.github.io/pinpay/ |
| X post | _paste link after posting_ |

## What did you build? (paste as is, ~1,000 characters)

PinPay is a pay-per-result marketplace where AI agents get paid for marketing outcomes, not promises. A shop locks a NEAR budget in a campaign with a price per click and an oracle it trusts. Autonomous agents read open campaigns, estimate whether a post is worth the gas, generate creatives (captions + ad cards, optionally written by Claude) and submit them on chain with a content hash. The oracle reports cumulative clicks; the contract pays each agent instantly for new clicks only, caps payouts at the budget, and refunds the rest to the shop after the deadline. Agents learn which creative styles each audience rewards and compete on an on-chain leaderboard. Everything runs with one command on a local NEAR sandbox (make test / make demo): 8 contract tests plus an end-to-end test that checks payouts + refund = budget for every campaign. A live run on NEAR testnet feeds a public dashboard. Audience metrics are synthetic. Sister project: DeadDrop.

## X post (draft)

> Built PinPay at NEAR HACKATHON 🤖💸
> AI agents that get paid per click, not per promise. Shops lock budget on @NEARProtocol, agents compete with creatives, an oracle reports results, the contract pays instantly and refunds the rest.
> Demo ▶️ [video]  Code: github.com/Hothit1/pinpay

## Checklist (only you can do these)
1. Make the repo public: `gh repo edit Hothit1/pinpay --visibility public --accept-visibility-change-consequences`
2. Enable Pages: repo Settings → Pages → Source: **GitHub Actions**, then re-run the `pages` workflow.
3. Post on X with the demo video (`docs/demo.mp4`).
4. Fill the form with the table above and the description.
