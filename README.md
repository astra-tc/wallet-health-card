# Wallet Health Card

**Paste any address → get a multichain security report card in seconds, powered by the Blockscout PRO API.**

Live: https://astratc.github.io/wallet-health-card/ · Demo video: https://astratc.github.io/wallet-health-card/demo.mp4 · CLI: `node cli/health.mjs`

## The problem
Wallets get drained by two quiet things: old **unlimited token approvals** and **address poisoning** (look-alike addresses that send you zero-value transfers so you copy the wrong address from history). Checking for both means visiting several explorers, decoding approve() calls and comparing addresses by eye, on every chain you use.

## Scan limits and deep scan
Each chain scan follows `next_page_params` on `/transactions` and `/token-transfers` (50 items per page) for a set number of pages:

| Depth | Pages/chain | Covers (per chain) | API calls, 5 free chains |
|---|---|---|---|
| Standard (default) | 2 | latest ~100 txs + ~100 ERC-20 transfers | ~35 + ~1 per approval |
| Deep (`--deep`, web "Deep") | 10 | latest ~500 + ~500 | ~115 + ~1 per approval |
| Full (`--pages 25`, web "Full") | 25 (ceiling) | latest ~1,250 + ~1,250 | ~265 + ~1 per approval |

The estimate is `chains × (3 + 2 × pages)` and is shown before the scan. The report then shows the real call count and the measured `x-credits-remaining` change. More pages cost more credits and take longer, because pages of one list are fetched one after another (the cursor comes from the previous page) and requests are capped at 3 at a time. `--pages` is clamped to 1–25.

The report always says how far back it looked. If a chain still had more pages when the scan stopped, that chain gets a **truncated** badge and an info finding ("Scanned the N most recent txs… run deep scan"), so a clean card on a truncated chain means "nothing found in recent activity", not a full-history audit. If a deep scan reaches the end of the history, it says "Full history scanned (N txs)". Wallets with more than ~1,250 txs on a chain can't be fully covered even at the 25-page ceiling.

## Approval value-at-risk
For every open ERC-20 approval: **at risk = min(approved amount, current balance) × `exchange_rate`**, with balances and prices from `/addresses/{a}/token-balances`. The card shows total USD at risk overall and per chain, and findings are ordered worst first, then by USD at risk. An **unlimited approval to an unverified spender while you still hold a priced balance of that token is critical** (−30), and the same approval with $0 exposed stays high (−15). The approved amount comes from the latest approve call, so it's an upper bound: allowance already spent via `transferFrom` isn't subtracted. Prices on thin tokens (<500 holders, or value above market cap) aren't trusted, so those show the token amount at risk with no USD figure. NFT approvals are listed but not valued.

## What it does
With one PRO API key and one `chain_id` switch, it scans Ethereum, Optimism, Arbitrum One, Gnosis and Scroll (the free-tier chains). With a paid key, `--all` or the checkbox adds Base, Polygon and ZKsync; on a free key they're skipped with a note, since Base, Polygon and ZKsync have required a paid plan since 1 Oct 2026. It produces:
- **Open approvals**: decoded `approve` / `increaseAllowance` / `setApprovalForAll` calls (latest per token+spender, revocations removed), with the spender's name, verification status and scam tags from Blockscout. Every spender is looked up. NFT approvals are read as NFT approvals: `setApprovalForAll` is a collection-wide approval, and ERC-721 `approve(to, tokenId)` covers one token. It flags unlimited (or collection-wide) approvals to unverified contracts.
- **Address-poisoning detection**: builds the set of addresses you really paid, then flags inbound transfers from look-alikes (same first 4 and last 4 hex). It's a critical finding if you ever sent funds to one.
- **Spam / bait tokens**: Blockscout token reputation plus bait-name heuristics.
- **Approval value-at-risk**: USD each open approval could drain today, totalled per chain and overall (see above).
- **Score and grade (A–F)**, a findings list where every item links to the transaction in **Blockscout Explorer**, plus revoke links.
- Read-only. No wallet connect, no signatures, and the key stays in your browser.

## Blockscout PRO API usage (core, not decorative)
Base URL `https://api.blockscout.com/{chain_id}/api/v2`, auth via `Authorization: Bearer proapi_…`.

| Endpoint | Used for |
|---|---|
| `/addresses/{a}` | native balance, contract flag; spender name / `is_verified` / scam metadata |
| `/addresses/{a}/counters` | activity detection per chain |
| `/addresses/{a}/token-balances` | holdings, USD value, token reputation, approval value-at-risk (balance × `exchange_rate`) |
| `/addresses/{a}/token-transfers?type=ERC-20` (paginated via `next_page_params`, 1–25 pages) | poisoning detection |
| `/addresses/{a}/transactions` (paginated, 1–25 pages) | decoded approval history (`decoded_input`), scan coverage / truncation |

It also limits itself to 3 requests at a time, retries 429s using `x-ratelimit-reset`, times out slow endpoints after 20s and reports partial data instead of failing, turns 402 (paid-only chain) into a skip note, uses `/tokens/{address}` for approval token symbols, 404 means "never used on this chain", and it reads `x-credits-remaining` to show credit usage.

## Browser access
`api.blockscout.com` sends no CORS `Access-Control-Allow-Origin` header, so the web app goes through `proxy/worker.js`, a tiny Cloudflare Worker at https://wallet-health-proxy.astratc.workers.dev. It only forwards GET `/{chain_id}/api/v2/...` with the user's own key, and stores and logs nothing. The CLI calls Blockscout directly.

## Run
```
# Web: serve docs/ (GitHub Pages does this), open, paste a PRO key + address. "Sample" shows a recorded report without a key.
python3 -m http.server -d docs 8080
# CLI
BLOCKSCOUT_API_KEY=proapi_xxx node cli/health.mjs 0xYourAddress           # free-tier chains (add --all for paid chains, --out r.json to save)
BLOCKSCOUT_API_KEY=proapi_xxx node cli/health.mjs 0xYourAddress 8453,10 --json
BLOCKSCOUT_API_KEY=proapi_xxx node cli/health.mjs 0xYourAddress --deep        # 10 pages/chain; or --pages N (1-25)
# Tests (offline, mocked API)
node test/run.mjs
```
Requires Node 18+ for the CLI. There are no dependencies.

## Roadmap (Sprint 2)
Done: approval value-at-risk and the deep-scan tier. Next: a "Powered by Blockscout" evidence panel (endpoints, credits, latency), watch mode (alert when a new poisoning transfer or approval appears), a shareable PNG card, revoke helper text, and an x402 pay-per-scan endpoint for AI agents.

MIT License · Built by Astra Trading Co.
