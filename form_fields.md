# Craftora submission form fields

**Name:** Wallet Health Card

**Tagline:** One-click multichain wallet security check: risky approvals, address poisoning and spam tokens, powered by the Blockscout PRO API.

**Tech stack:** Blockscout PRO API (REST v2, multichain via chain_id), JavaScript ES modules (zero dependencies), static web app on GitHub Pages, Node.js 18+ CLI, Cloudflare Worker (CORS pass-through proxy), Node assert tests with a mocked API, Playwright and ffmpeg (demo recording).

**Description (≤1000 chars):**
Wallets get drained by two quiet problems: forgotten unlimited token approvals and address poisoning (look-alike addresses that send zero-value transfers so you copy the wrong address). Wallet Health Card turns Blockscout PRO API data into a graded A–F report for any address across Ethereum, Optimism, Arbitrum, Gnosis and Scroll, plus Base, Polygon and ZKsync on paid keys. It decodes approve calls from transaction history, enriches spenders with Blockscout name, verification and scam data, matches inbound transfers against real counterparties to catch poisoning, and flags airdrop-bait tokens. Every finding links to its evidence in Blockscout Explorer, with revoke links. It's read-only: no wallet connect, no signatures, and the key stays in the browser. It handles pagination, rate limits, timeouts and paid-only chains gracefully. Web app and CLI share one open-source core.

**Links**
- Live demo: https://astratc.github.io/wallet-health-card/
- Repo: https://github.com/astratc/wallet-health-card
- Demo video (3:26): https://astratc.github.io/wallet-health-card/demo.mp4
- Logo: logo.png (512x512) · Screenshots: screenshots/1–4 · X visual: x_visual.png
- X post URL: https://x.com/AstraTradingCo/status/2112877027284164862
