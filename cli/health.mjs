#!/usr/bin/env node
// Usage: BLOCKSCOUT_API_KEY=proapi_... node cli/health.mjs 0xADDRESS [chainIds,comma] [--json]
import { healthCard, CHAINS } from "../docs/core.js";
const [addr, chains] = process.argv.slice(2).filter(a => !a.startsWith("--"));
const key = process.env.BLOCKSCOUT_API_KEY;
if (!key || !addr) { console.error("Set BLOCKSCOUT_API_KEY and pass an address"); process.exit(1); }
const r = await healthCard(key, addr, chains ? chains.split(",").map(Number) : undefined);
if (process.argv.includes("--json")) { console.log(JSON.stringify(r, null, 2)); process.exit(0); }
console.log(`Wallet Health: ${r.grade} (${r.score}/100) for ${addr}`);
for (const c of r.chains.filter(c => c.active)) console.log(`  ${CHAINS[c.chainId].name}: ${c.txCount} txs, ${c.approvals.length} approvals, ${c.poisoning.length} poisoning hits, ${c.spamTokens.length} spam tokens`);
for (const f of r.findings) console.log(`  [${f.sev}] ${f.chain}: ${f.text}`);
console.log(`  (${r.apiCalls} Blockscout PRO API calls)`);
