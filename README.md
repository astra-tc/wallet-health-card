# Wallet Health Card

**Paste any address → get a multichain security report card in seconds, powered by the Blockscout PRO API.**

Live: https://astratc.github.io/wallet-health-card/ · Demo video: https://astratc.github.io/wallet-health-card/demo.mp4 · CLI: `node cli/health.mjs` · Source: https://github.com/astra-tc/wallet-health-card

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

## "Powered by Blockscout" evidence panel
Every report ends with a panel showing exactly how the Blockscout PRO API produced it (web app card, CLI footer, and `evidence` in `--json`):
- **Endpoints called**, grouped by template (`GET /api/v2/addresses/{address}/transactions`, `/tokens/{token}`, …), with the call count per endpoint, the chains it was called on, and errors (402 paid-chain skips, timeouts).
- **Total API calls** and **credits**, read from the `x-credits-remaining` response header: the first value seen → the last value seen = credits used. If the API doesn't send the header for a key, the panel says "not reported" rather than guessing.
- **Latency per chain**: calls, average and max request time, and the chain's total scan time.

Every finding carries **two Blockscout Explorer links**: the transaction (`/tx/{hash}`) and the spender's contract page (`/address/{spender}?tab=contract`). For poisoning findings the second link opens the look-alike address. The CLI prints both under each finding (`--brief` hides them along with the panel).

## Revoke helper (read-only)
For each open approval, the card shows the exact call that removes it, on the token contract:
- ERC-20: `approve(spender, 0)`
- NFT collection-wide: `setApprovalForAll(operator, false)`
- Single NFT: `approve(0x0000…0000, tokenId)`

It also links to revoke.cash for that wallet and chain (`https://revoke.cash/address/{wallet}?chainId={id}`). Wallet Health Card only describes the fix. It never builds, requests or signs a transaction and never connects a wallet, so you send the revoke from your own wallet or through revoke.cash.

## Shareable PNG card
"Download PNG card" draws a 1200×675 image in your browser with a canvas: the grade, the score, the shortened address, active chains, USD at risk, the top 3 findings (worst first) and the API call count. Nothing is uploaded. Addresses keep 8 leading hex characters, so a look-alike and the contact it mimics stay visibly different.

## Approval value-at-risk
For every open ERC-20 approval: **at risk = min(approved amount, current balance) × `exchange_rate`**, with balances and prices from `/addresses/{a}/token-balances`. The card shows total USD at risk overall and per chain, and findings are ordered worst first, then by USD at risk. An **unlimited approval to an unverified spender while you still hold a priced balance of that token is critical** (−30), and the same approval with $0 exposed stays high (−15). The approved amount comes from the latest approve call, so it's an upper bound: allowance already spent via `transferFrom` isn't subtracted. Prices on thin tokens (<500 holders, or value above market cap) aren't trusted, so those show the token amount at risk with no USD figure. NFT approvals are listed but not valued.

## What it does
With one PRO API key and one `chain_id` switch, it scans Ethereum, Optimism, Arbitrum One, Gnosis and Scroll (the free-tier chains). With a paid key, `--all` or the checkbox adds Base, Polygon and ZKsync; on a free key they're skipped with a note, since Base, Polygon and ZKsync have required a paid plan since 1 Oct 2026. It produces:
- **Open approvals**: decoded `approve` / `increaseAllowance` / `setApprovalForAll` calls (latest per token+spender, revocations removed), with the spender's name, verification status and scam tags from Blockscout. Every spender is looked up. NFT approvals are read as NFT approvals: `setApprovalForAll` is a collection-wide approval, and ERC-721 `approve(to, tokenId)` covers one token. It flags unlimited (or collection-wide) approvals to unverified contracts.
- **Address-poisoning detection**: builds the set of addresses you really paid, then flags inbound transfers from look-alikes (same first 4 and last 4 hex). It's a critical finding if you ever sent funds to one.
- **Spam / bait tokens**: Blockscout token reputation plus bait-name heuristics.
- **Approval value-at-risk**: USD each open approval could drain today, totalled per chain and overall (see above).
- **Score and grade (A–F)**, a findings list where every item links to its transaction and its spender contract in **Blockscout Explorer**, with the exact revoke call and a revoke.cash link.
- **Evidence panel**: endpoints called, call counts, credits used (`x-credits-remaining`) and per-chain latency.
- **Shareable PNG card**, rendered client-side.
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

It also limits itself to 3 requests at a time, retries 429s using `x-ratelimit-reset`, times out slow endpoints after 20s and reports partial data instead of failing, turns 402 (paid-only chain) into a skip note, uses `/tokens/{address}` for approval token symbols, 404 means "never used on this chain", and it reads `x-credits-remaining` to show credit usage. Every request is logged (endpoint template, chain, status, ms) for the evidence panel.

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
BLOCKSCOUT_API_KEY=proapi_xxx node cli/health.mjs 0xYourAddress --brief       # findings only: no Explorer/revoke lines, no evidence panel
# Tests (offline, mocked API; includes CLI runs via test/cli-mock.mjs)
node test/run.mjs
```
Requires Node 18+ for the CLI. There are no dependencies.

## Roadmap (Sprint 2)
Done: approval value-at-risk, the deep-scan tier, the "Powered by Blockscout" evidence panel with two Explorer links per finding, revoke helper text, and the shareable PNG card. Next: watch mode (alert when a new poisoning transfer or approval appears), then possibly an x402 pay-per-scan endpoint for AI agents.

MIT License · Built by Astra Trading Co.
