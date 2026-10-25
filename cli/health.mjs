#!/usr/bin/env node
// Usage: BLOCKSCOUT_API_KEY=proapi_... node cli/health.mjs 0xADDRESS [chainIds,comma] [--all] [--json] [--out file] [--pages N | --deep]
// Default = free-tier chains, 2 pages (~100 txs + ~100 token transfers) per chain. --deep = --pages 10; max 25.
// --all adds Base/Polygon/ZKsync (needs a paid plan; skipped with a note otherwise).
// --brief hides the per-finding Explorer/revoke lines and the "Powered by Blockscout" evidence panel.
import { healthCard, CHAINS, FREE_CHAINS, ALL_CHAINS, clampPages, estimateCalls, formatEvidence } from "../docs/core.js";
const args = process.argv.slice(2);
const valueOf = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const valueIdx = new Set(["--out", "--pages"].map(f => args.indexOf(f)).filter(i => i >= 0).map(i => i + 1));
const pos = args.filter((a, i) => !a.startsWith("--") && !valueIdx.has(i));
const [addr, chains] = pos;
const key = process.env.BLOCKSCOUT_API_KEY;
if (!key || !addr) { console.error("Set BLOCKSCOUT_API_KEY and pass an address"); process.exit(1); }
const chainIds = chains ? chains.split(",").map(Number) : (args.includes("--all") ? ALL_CHAINS : FREE_CHAINS);
const pages = clampPages(valueOf("--pages") ?? (args.includes("--deep") ? 10 : undefined));
// stderr, so --json output stays valid JSON on stdout
console.error(`Scan depth: ${pages} pages/chain (~${estimateCalls(chainIds.length, pages)} API calls est. + ~1 per approval)`);
const r = await healthCard(key, addr, chainIds, { pages });
const out = valueOf("--out"); if (out) (await import("fs")).writeFileSync(out, JSON.stringify(r, null, 2));
if (args.includes("--json")) { console.log(JSON.stringify(r, null, 2)); process.exit(0); }
const usd = v => "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
console.log(`Wallet Health: ${r.grade} (${r.score}/100) for ${addr}`);
console.log(`  Value at risk in open approvals: ${usd(r.valueAtRisk.usd)}`);
for (const c of r.chains.filter(c => c.active)) console.log(`  ${CHAINS[c.chainId].name}${c.ens ? ` (${c.ens})` : ""}: ${c.txCount} txs (${c.scan.txsScanned} scanned${c.scan.txTruncated || c.scan.transferTruncated ? ", truncated" : ""}), ${c.approvals.length} approvals (${usd(c.valueAtRisk.usd)} at risk), ${c.poisoning.length} poisoning hits, ${c.spamTokens.length} spam tokens`);
const brief = args.includes("--brief");
for (const f of r.findings) {
  console.log(`  [${f.sev}] ${f.chain}: ${f.text}`);
  if (brief) continue;
  if (f.links?.tx) console.log(`      tx:       ${f.links.tx}`);
  if (f.links?.contract) console.log(`      ${f.spender ? "spender" : f.address ? "address" : "contract"}:  ${f.links.contract}`);
  if (f.revoke) console.log(`      revoke:   ${f.revoke.text}\n                (send it from your own wallet, or use ${f.revoke.url}; this tool never builds or signs transactions)`);
}
if (brief) console.log(`  (${r.apiCalls} Blockscout PRO API calls, ${r.scanDepth.tier} scan${r.creditsUsed != null ? `, ${r.creditsUsed} credits used` : ""})`);
else console.log(formatEvidence(r.evidence).join("\n"));
