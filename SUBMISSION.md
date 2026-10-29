# Submission: Wallet Health Card (Astra Trading Co.)

**Repo:** https://github.com/astra-tc/wallet-health-card
**Live demo:** https://astra-tc.github.io/wallet-health-card/
**Demo video:** https://astra-tc.github.io/wallet-health-card/demo.mp4 (3:26, narrated)
**X showcase post:** https://x.com/AstraTradingCo/status/2112877027284164862

## Problem
Two silent wallet killers are stale unlimited approvals and address poisoning. Spotting them needs decoded calldata, contract verification data and pattern matching across many chains. Most users never check.

## Solution
A read-only, multichain wallet check. Paste an address and you get a graded report card with prioritised findings. Each finding links to its evidence in Blockscout Explorer.

## How Blockscout PRO API powers it
Every data point comes from the PRO API. One key works across Ethereum, Optimism, Arbitrum, Gnosis and Scroll (plus Base, Polygon and ZKsync on paid plans) by changing `chain_id`. It uses address info, counters, token balances, paginated ERC-20 transfers and paginated transactions with `decoded_input` for approvals, plus per-spender address metadata (verification, name, scam tags). It handles rate limits and reads credit headers. Without Blockscout there is no product.

## Technical
Zero-dependency ES module core shared by the web app (GitHub Pages) and a Node CLI, with an offline test suite that mocks the API. The heuristics are documented in the README. The tool never asks for wallet connection or signatures.

## What changed in Sprint 2
- **Approval value at risk:** each open approval is priced as min(allowance, balance) x token price, with per-chain and overall USD totals, a new critical tier, and findings sorted by dollars at risk.
- **Deep scan:** a Scan depth option (web) and `--pages/--deep` (CLI) follow Blockscout `next_page_params` past the recent-activity window, with a credit estimate before the run and a "truncated" badge when limits are hit.
- **Powered-by-Blockscout evidence panel:** every report lists the PRO API endpoints called, call counts, credits used (from `x-credits-remaining`) and per-chain latency.
- **Two Explorer links per finding** (the transaction and the spender's contract page) plus a revoke helper.
- **Shareable PNG report card** generated in the browser.
- Moved to github.com/astra-tc; offline test suite extended (deep scan, VaR, evidence panel, explorer links, revoke helper, PNG card, CLI) and passing.

## Team
Astra Trading Co.
STATUS: Sprint 01 SUBMITTED (submit flow run 2026-10-21 16:05 UTC+4 per box browser history; Craftora project 30d0028f-08cd-416a-9e7d-6fb866c963bc; submissions tab re-checked 2026-10-22 01:57 UTC+4). Judging Oct 22-24. Sprint 02: build 25-31 Oct, submit target 30 Oct.
