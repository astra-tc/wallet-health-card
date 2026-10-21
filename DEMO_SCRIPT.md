# 2-minute demo script

**0:00–0:15 Hook.** "Address poisoning and forgotten unlimited approvals drain wallets every day. Wallet Health Card finds both across six chains in one click, using the Blockscout PRO API."

**0:15–0:35 Setup.** Open astratc.github.io/wallet-health-card. Paste a PRO key ("free from dev.blockscout.com, it stays in your browser") and paste an address that has some history.

**0:35–1:05 Scan.** Click Scan. Point at the grade and score, the active chains, the number of Blockscout API calls and the credits left. "One key; we only change the chain_id in the URL."

**1:05–1:35 Findings.** Walk through one unlimited approval to an unverified contract and one poisoning attempt (a look-alike sending a zero-value transfer). Click "view tx" so Blockscout Explorer opens on the actual transaction (Blockscout showcase). Click the spender address in Explorer and show it's unverified.

**1:35–1:50 Under the hood.** Show the README endpoint table: the address, counters, token-balances, token-transfers and transactions endpoints, plus decoded_input for approvals. Run `node cli/health.mjs` in a terminal for the same report.

**1:50–2:00 Close.** "Read-only and open source. Next: watch mode alerts and a pay-per-scan API for AI agents."

Tip: if a live scan is slow, use the Sample button. It's an offline recorded report.
