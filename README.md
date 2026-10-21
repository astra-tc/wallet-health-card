# Wallet Health Card

**Paste any address → get a multichain security report card in seconds, powered by the Blockscout PRO API.**

Live: https://astratc.github.io/wallet-health-card/ · CLI: `node cli/health.mjs`

## The problem
Wallets get drained by two quiet things: old **unlimited token approvals** and **address poisoning** (look-alike addresses that send you zero-value transfers so you copy the wrong address from history). Checking for both means visiting several explorers, decoding approve() calls and comparing addresses by eye, on every chain you use.

## What it does
With one PRO API key and one `chain_id` switch, it scans Ethereum, Base, Optimism, Arbitrum, Polygon and Gnosis and produces:
- **Open approvals**: decoded `approve` / `increaseAllowance` / `setApprovalForAll` calls (latest per token+spender, revocations removed), with the spender's name, verification status and scam tags from Blockscout. It flags unlimited approvals to unverified contracts.
- **Address-poisoning detection**: builds the set of addresses you really paid, then flags inbound transfers from look-alikes (same first 4 and last 4 hex). It's a critical finding if you ever sent funds to one.
- **Spam / bait tokens**: Blockscout token reputation plus bait-name heuristics.
- **Score and grade (A–F)**, a findings list where every item links to the transaction in **Blockscout Explorer**, plus revoke links.
- Read-only. No wallet connect, no signatures, and the key stays in your browser.

## Blockscout PRO API usage (core, not decorative)
Base URL `https://api.blockscout.com/{chain_id}/api/v2`, auth via `Authorization: Bearer proapi_…`.

| Endpoint | Used for |
|---|---|
| `/addresses/{a}` | native balance, contract flag; spender name / `is_verified` / scam metadata |
| `/addresses/{a}/counters` | activity detection per chain |
| `/addresses/{a}/token-balances` | holdings, USD value, token reputation |
| `/addresses/{a}/token-transfers?type=ERC-20` (paginated via `next_page_params`) | poisoning detection |
| `/addresses/{a}/transactions` (paginated) | decoded approval history (`decoded_input`) |

It also handles 429 retry with backoff, 404 means "never used on this chain", and it reads `x-credits-remaining` to show credit usage.

## Run
```
# Web: serve docs/ (GitHub Pages does this), open, paste a PRO key + address. "Sample" shows a recorded report without a key.
python3 -m http.server -d docs 8080
# CLI
BLOCKSCOUT_API_KEY=proapi_xxx node cli/health.mjs 0xYourAddress           # all chains
BLOCKSCOUT_API_KEY=proapi_xxx node cli/health.mjs 0xYourAddress 8453,10 --json
# Tests (offline, mocked API)
node test/run.mjs
```
Requires Node 18+ for the CLI. There are no dependencies.

## Roadmap (Sprint 2)
Watch mode (alert when a new poisoning transfer or approval appears), an x402 pay-per-scan endpoint for AI agents, approval value-at-risk (allowance × balance), and a shareable PNG card.

MIT License · Built by Astra Trading Co.
