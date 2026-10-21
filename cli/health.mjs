#!/usr/bin/env node
// Usage: BLOCKSCOUT_API_KEY=proapi_... node cli/health.mjs 0xADDRESS [chainIds,comma] [--all] [--json] [--out file]
// Default = free-tier chains. --all adds Base/Polygon/ZKsync (needs a paid plan; skipped with a note otherwise).
import { healthCard, CHAINS, FREE_CHAINS, ALL_CHAINS } from "../docs/core.js";
const args = process.argv.slice(2); const oi0 = args.indexOf("--out");
const pos = args.filter((a, i) => !a.startsWith("--") && !(oi0 >= 0 && i === oi0 + 1));
const [addr, chains] = pos;
const key = process.env.BLOCKSCOUT_API_KEY;
if (!key || !addr) { console.error("Set BLOCKSCOUT_API_KEY and pass an address"); process.exit(1); }
const r = await healthCard(key, addr, chains ? chains.split(",").map(Number) : (process.argv.includes("--all") ? ALL_CHAINS : FREE_CHAINS));
const oi = process.argv.indexOf("--out"); if (oi > 0) { (await import("fs")).writeFileSync(process.argv[oi + 1], JSON.stringify(r, null, 2)); }
if (process.argv.includes("--json")) { console.log(JSON.stringify(r, null, 2)); process.exit(0); }
console.log(`Wallet Health: ${r.grade} (${r.score}/100) for ${addr}`);
for (const c of r.chains.filter(c => c.active)) console.log(`  ${CHAINS[c.chainId].name}${c.ens ? ` (${c.ens})` : ""}: ${c.txCount} txs, ${c.approvals.length} approvals, ${c.poisoning.length} poisoning hits, ${c.spamTokens.length} spam tokens`);
for (const f of r.findings) console.log(`  [${f.sev}] ${f.chain}: ${f.text}`);
console.log(`  (${r.apiCalls} Blockscout PRO API calls)`);
