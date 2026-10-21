# Submission: Wallet Health Card (Astra Trading Co.)

**Repo:** https://github.com/astratc/wallet-health-card
**Live demo:** https://astratc.github.io/wallet-health-card/
**Demo video:** https://astratc.github.io/wallet-health-card/demo.mp4 (3:26, narrated)
**X showcase post:** <add link; must tag @blockscout and @craftorahq, include a visual and the live/GitHub link>

## Problem
Two silent wallet killers are stale unlimited approvals and address poisoning. Spotting them needs decoded calldata, contract verification data and pattern matching across many chains. Most users never check.

## Solution
A read-only, multichain wallet check. Paste an address and you get a graded report card with prioritised findings. Each finding links to its evidence in Blockscout Explorer.

## How Blockscout PRO API powers it
Every data point comes from the PRO API. One key works across Ethereum, Optimism, Arbitrum, Gnosis and Scroll (plus Base, Polygon and ZKsync on paid plans) by changing `chain_id`. It uses address info, counters, token balances, paginated ERC-20 transfers and paginated transactions with `decoded_input` for approvals, plus per-spender address metadata (verification, name, scam tags). It handles rate limits and reads credit headers. Without Blockscout there is no product.

## Technical
Zero-dependency ES module core shared by the web app (GitHub Pages) and a Node CLI, with an offline test suite that mocks the API. The heuristics are documented in the README. The tool never asks for wallet connection or signatures.

## What's next (Sprint 2)
Watch mode alerts, an approval value-at-risk metric, a shareable card image, and an x402 pay-per-scan endpoint for AI agents.

## Team
Astra Trading Co.
