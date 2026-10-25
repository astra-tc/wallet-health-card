// Offline test with a mocked Blockscout PRO API.
import { healthCard, ALL_CHAINS, detectPoisoning, extractApprovals, estimateCalls, approvalValueAtRisk, clampPages, endpointTemplate, formatEvidence, cardSummary, revokeHelp } from "../docs/core.js";
import { spawnSync } from "child_process"; import { readFileSync } from "fs";
import assert from "assert";
const ME = "0x1111aaaa00000000000000000000000000001234", FRIEND = "0xabcd000000000000000000000000000000005678",
  FAKE = "0xabcdffffffffffffffffffffffffffffffff5678", DRAINER = "0x9999000000000000000000000000000000000bad",
  ROUTER = "0x2626664c2603336e57b271c5c0b26f421741e481", USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const MAX = (2n ** 256n - 1n).toString();
const db = {
  [`/addresses/${ME}`]: { hash: ME, coin_balance: "20000000000000000", exchange_rate: "2600", is_contract: false },
  [`/addresses/${ME}/counters`]: { transactions_count: "42" },
  [`/addresses/${ME}/token-balances`]: [
    { value: "150000000", token: { symbol: "USDC", name: "USD Coin", decimals: "6", exchange_rate: "1", address_hash: USDC } },
    { value: "1000000000000000000000", token: { symbol: "CLAIM", name: "Visit claim-rewards.xyz", decimals: "18", exchange_rate: null } }],
  [`/addresses/${ME}/token-transfers`]: { items: [
    { from: { hash: FAKE }, to: { hash: ME }, total: { value: "0" }, token: { symbol: "USDC" }, transaction_hash: "0xpoison1", timestamp: "2026-10-20T10:00:00Z" },
    { from: { hash: ME }, to: { hash: FRIEND }, total: { value: "50000000" }, token: { symbol: "USDC" }, transaction_hash: "0xreal1", timestamp: "2026-10-19T10:00:00Z" }], next_page_params: null },
  [`/addresses/${ME}/transactions`]: { items: [
    { hash: "0xappr2", from: { hash: ME }, to: { hash: USDC, name: "USDC" }, status: "ok", method: "approve", value: "0", timestamp: "2026-10-18T00:00:00Z",
      decoded_input: { parameters: [{ name: "spender", value: DRAINER }, { name: "amount", value: MAX }] } },
    { hash: "0xappr1", from: { hash: ME }, to: { hash: USDC, name: "USDC" }, status: "ok", method: "approve", value: "0", timestamp: "2026-10-01T00:00:00Z",
      decoded_input: { parameters: [{ name: "spender", value: ROUTER }, { name: "amount", value: MAX }] } }], next_page_params: null },
  [`/tokens/${USDC}`]: { symbol: "USDC", type: "ERC-20" },
  [`/addresses/${ROUTER}`]: { hash: ROUTER, is_contract: true, is_verified: true, name: "SwapRouter02" },
  [`/addresses/${DRAINER}`]: { hash: DRAINER, is_contract: true, is_verified: false, name: null },
};
const mock = async url => { const u = new URL(url); const m = u.pathname.match(/^\/(\d+)\/api\/v2(.*)$/);
  if (["8453","137","324"].includes(m[1])) return { ok: false, status: 402, headers: new Map(), json: async () => ({ error: "Featured chain requires plan" }) };
  const body = m[1] === "10" ? db[m[2]] : (m[2] === `/addresses/${ME}` ? { coin_balance: "0" } : m[2].endsWith("counters") ? { transactions_count: "0" } : { items: [] });
  return { ok: !!body, status: body ? 200 : 404, headers: new Map([["x-credits-remaining", "99000"]]), json: async () => body }; };
const r = await healthCard("proapi_test", ME, ALL_CHAINS, { fetchImpl: mock });
const base = r.chains.find(c => c.chainId === 10);
assert.equal(r.chains.filter(c => c.active).length, 1);
assert.equal(base.poisoning.length, 1); assert.equal(base.poisoning[0].fake, FAKE);
assert.equal(base.approvals.length, 2); assert.ok(base.approvals.every(a => a.unlimited));
assert.equal(base.spamTokens.length, 1);
assert.ok(r.findings.some(f => f.sev === "high" && f.text.includes(DRAINER)));
assert.equal(r.chains.filter(c => c.needsPaidPlan).length, 3);
assert.equal(r.findings.filter(f => f.sev === "info").length, 3);
assert.ok(base.approvals.every(a => a.tokenName === "USDC"));
assert.equal(r.grade, "B"); assert.equal(r.score, 74); // 100-15-4-5-2 = 74
assert.equal(r.findings.length, 7); assert.equal(r.scanDepth.pages, 2); assert.equal(r.scanDepth.tier, "standard"); assert.deepEqual(r.scanDepth.truncatedChains, []);
// The mock USDC has no holders_count, so its price is not trusted: units at risk shown, no USD, so DRAINER stays "high" (not critical).
assert.ok(r.findings.some(f => f.sev === "high" && f.text.includes(DRAINER) && /150 USDC at risk, no reliable USD price/.test(f.text))); assert.equal(r.valueAtRisk.usd, 0);
// Regression: paying a look-alike must be a high finding, and the genuine contact must never be labelled the fake.
{ const tr = (from, to, value, tx, ts) => ({ from: { hash: from }, to: { hash: to }, total: { value }, token: { symbol: "USDC" }, transaction_hash: tx, timestamp: ts });
  const hits = detectPoisoning(ME, [
    tr(ME, FAKE, "25000000", "0xoops", "2026-10-21T10:00:00Z"), tr(FAKE, ME, "0", "0xpoison", "2026-10-20T10:00:00Z"),
    tr(FRIEND, ME, "10000000", "0xrefund", "2026-10-19T12:00:00Z"), tr(ME, FRIEND, "50000000", "0xreal1", "2026-10-19T10:00:00Z")],
    [{ hash: "0xnative", from: { hash: ME }, to: { hash: FAKE }, value: "1000000000000000", timestamp: "2026-10-21T11:00:00Z" }]);
  assert.ok(hits.every(h => h.fake === FAKE && h.mimics === FRIEND), "genuine contact must never be reported as the fake");
  assert.deepEqual(hits.filter(h => h.sentToFake).map(h => h.tx).sort(), ["0xnative", "0xoops"]);
  assert.deepEqual(hits.filter(h => !h.sentToFake).map(h => h.tx), ["0xpoison"]); }
// Helper: scan a mocked single-chain (Optimism) wallet. fail = paths whose lookup returns a 500.
const scan = async (dbx, fail = []) => { const r = await healthCard("proapi_test", ME, [10], { fetchImpl: async url => {
  const path = new URL(url).pathname.replace(/^\/10\/api\/v2/, ""); if (fail.includes(path)) return { ok: false, status: 500, headers: new Map(), json: async () => ({}) };
  const body = dbx[path]; return { ok: !!body, status: body ? 200 : 404, headers: new Map(), json: async () => body }; } }); return { r, c: r.chains[0] }; };
const wallet = (txItems, extra = {}) => ({ [`/addresses/${ME}`]: { hash: ME, coin_balance: "1" }, [`/addresses/${ME}/counters`]: { transactions_count: String(txItems.length) },
  [`/addresses/${ME}/token-balances`]: [], [`/addresses/${ME}/token-transfers`]: { items: [], next_page_params: null },
  [`/addresses/${ME}/transactions`]: { items: txItems, next_page_params: null }, ...extra });
const apprTx = (i, token, method, params) => ({ hash: `0xa${i}`, from: { hash: ME }, to: { hash: token }, status: "ok", method, value: "0",
  timestamp: `2026-10-${String(1 + (i % 28)).padStart(2, "0")}T00:00:00Z`, decoded_input: { parameters: params } });
// Regression (finding 2): spenders past the 15th must be looked up too, never defaulted to "unverified".
{ const spenders = Array.from({ length: 20 }, (_, i) => `0x${(i + 1).toString(16).padStart(4, "0")}${"0".repeat(32)}c0de`);
  const extra = { [`/tokens/${USDC}`]: { symbol: "USDC", type: "ERC-20" } };
  for (const s of spenders) extra[`/addresses/${s}`] = { hash: s, is_contract: true, is_verified: true, name: "VerifiedRouter" };
  const { r, c } = await scan(wallet(spenders.map((s, i) => apprTx(i, USDC, "approve", [{ name: "spender", value: s }, { name: "amount", value: MAX }])), extra));
  assert.equal(c.approvals.length, 20); assert.ok(c.approvals.every(a => a.spenderVerified === true), "all 20 spenders looked up and verified");
  assert.equal(r.findings.filter(f => f.sev === "high").length, 0, "no false 'unverified' highs past the 15th spender");
  assert.equal(r.findings.filter(f => f.sev === "medium").length, 20);
  // A spender whose lookup fails is "could not be checked" (medium), not "unverified" (high).
  const { r: r2, c: c2 } = await scan(wallet([apprTx(1, USDC, "approve", [{ name: "spender", value: ROUTER }, { name: "amount", value: MAX }])], extra), [`/addresses/${ROUTER}`]);
  assert.equal(c2.approvals[0].spenderVerified, null); assert.equal(r2.findings.filter(f => f.sev === "high").length, 0);
  assert.ok(r2.findings.some(f => f.sev === "medium" && /could not be checked/.test(f.text))); }
// Regression (finding 3): NFT approvals (ERC-721 approve / setApprovalForAll) are not ERC-20 allowances.
{ const NFT = "0x00000000000000000000000000000000000a721a", MULTI = "0x0000000000000000000000000000000000a11550", ZERO = "0x" + "0".repeat(40);
  const OP = "0x5555000000000000000000000000000000000555";
  const txs = [ // newest first, like Blockscout
    apprTx(9, USDC, "approveAndCall", [{ name: "spender", value: DRAINER }, { name: "amount", value: MAX }]),
    apprTx(8, MULTI, "setApprovalForAll", [{ name: "operator", value: ROUTER }, { name: "approved", value: false }]),
    apprTx(7, MULTI, "setApprovalForAll", [{ name: "operator", value: ROUTER }, { name: "approved", value: true }]),
    apprTx(6, NFT, "setApprovalForAll(address,bool)", [{ name: "operator", value: OP }, { name: "approved", value: true }]),
    apprTx(5, NFT, "approve", [{ name: "to", value: ZERO }, { name: "tokenId", value: "7" }]),
    apprTx(4, NFT, "approve", [{ name: "to", value: DRAINER }, { name: "tokenId", value: "7" }]),
    apprTx(3, NFT, "approve(address,uint256)", [{ name: "to", value: ROUTER }, { name: "tokenId", value: MAX }]),
    apprTx(2, NFT, "approve", [{ name: "to", value: ROUTER }, { name: "tokenId", value: "0" }])];
  const extra = { [`/tokens/${NFT}`]: { symbol: "PUNK", type: "ERC-721" }, [`/tokens/${MULTI}`]: { symbol: "ITEMS", type: "ERC-1155" },
    [`/addresses/${ROUTER}`]: { hash: ROUTER, is_contract: true, is_verified: true, name: "SwapRouter02" },
    [`/addresses/${OP}`]: { hash: OP, is_contract: false, is_verified: false }, [`/addresses/${DRAINER}`]: { hash: DRAINER, is_verified: false } };
  const { r, c } = await scan(wallet(txs, extra));
  const single = c.approvals.filter(a => a.scope === "single"), all = c.approvals.filter(a => a.scope === "all");
  assert.ok(!c.approvals.some(a => a.method === "approveAndCall"), "approveAndCall is not an approval");
  assert.ok(!c.approvals.some(a => a.tokenName === "ITEMS"), "setApprovalForAll(false) revokes");
  assert.deepEqual(single.map(a => a.tokenId).sort(), [MAX, "0"].sort(), "tokenId 0 kept; tokenId 7 cleared by approve(0x0, 7)");
  assert.ok(single.every(a => a.unlimited === false && a.nft && a.spender === ROUTER), "a big tokenId is not UNLIMITED");
  assert.equal(all.length, 1); assert.equal(all[0].spender, OP); assert.ok(all[0].unlimited);
  assert.deepEqual(r.findings.map(f => f.sev), ["high"]); assert.ok(/ALL PUNK NFTs to unverified/.test(r.findings[0].text));
  assert.equal(r.score, 85);
  // Without token metadata, an ERC-721 approve is still recognised from its tokenId parameter name.
  const off = extractApprovals(ME, [apprTx(1, NFT, "approve", [{ name: "to", value: ROUTER }, { name: "tokenId", value: "0" }])]);
  assert.equal(off.length, 1); assert.equal(off[0].scope, "single"); assert.equal(off[0].unlimited, false);
  // ERC-20 behaviour unchanged: approve(spender, 0) still revokes.
  assert.equal(extractApprovals(ME, [apprTx(1, USDC, "approve", [{ name: "spender", value: ROUTER }, { name: "amount", value: "0" }]),
    apprTx(0, USDC, "approve", [{ name: "spender", value: ROUTER }, { name: "amount", value: MAX }])], { [USDC]: "ERC-20" }).length, 0); }
// Sprint 2 (a): deep scan. /transactions has 3 pages; an old unlimited approval to an unverified spender sits on page 3.
{ const pageTx = n => Array.from({ length: 50 }, (_, i) => ({ hash: `0xp${n}_${i}`, from: { hash: ME }, to: { hash: FRIEND }, status: "ok", method: "transfer", value: "0",
    timestamp: `2026-0${10 - n}-01T00:00:00Z` }));
  const p3 = pageTx(3); p3.push({ hash: "0xoldappr", from: { hash: ME }, to: { hash: USDC, name: "USDC" }, status: "ok", method: "approve", value: "0",
    timestamp: "2026-06-01T00:00:00Z", decoded_input: { parameters: [{ name: "spender", value: DRAINER }, { name: "amount", value: MAX }] } });
  const txPages = { 1: { items: pageTx(1), next_page_params: { page: "2" } }, 2: { items: pageTx(2), next_page_params: { page: "3" } }, 3: { items: p3, next_page_params: null } };
  const dbp = { [`/addresses/${ME}`]: { hash: ME, coin_balance: "1" }, [`/addresses/${ME}/counters`]: { transactions_count: "151" },
    [`/addresses/${ME}/token-balances`]: [{ value: "250000000", token: { symbol: "USDC", decimals: "6", exchange_rate: "1", holders_count: "5000000", address_hash: USDC, type: "ERC-20" } }],
    [`/addresses/${ME}/token-transfers`]: { items: [], next_page_params: null }, [`/tokens/${USDC}`]: { symbol: "USDC", type: "ERC-20" },
    [`/addresses/${DRAINER}`]: { hash: DRAINER, is_contract: true, is_verified: false } };
  const run = pages => healthCard("proapi_test", ME, [10], { pages, fetchImpl: async url => { const u = new URL(url); const path = u.pathname.replace(/^\/10\/api\/v2/, "");
    const body = path === `/addresses/${ME}/transactions` ? txPages[u.searchParams.get("page") || "1"] : dbp[path];
    return { ok: !!body, status: body ? 200 : 404, headers: new Map(), json: async () => body }; } });
  const std = await run(undefined), c1 = std.chains[0];
  assert.equal(c1.scan.pages, 2); assert.equal(c1.scan.txsScanned, 100); assert.equal(c1.scan.txTruncated, true); assert.equal(c1.scan.transferTruncated, false);
  assert.equal(c1.approvals.length, 0, "standard depth misses the page-3 approval");
  assert.deepEqual(std.scanDepth.truncatedChains, ["Optimism"]);
  assert.ok(std.findings.some(f => f.sev === "info" && f.truncated && /Scanned the 100 most recent txs.*--pages 10/.test(f.text)));
  const deep = await run(10), c2 = deep.chains[0];
  assert.equal(deep.scanDepth.tier, "deep"); assert.equal(c2.scan.pages, 10); assert.equal(c2.scan.txsScanned, 151); assert.equal(c2.scan.txTruncated, false);
  assert.equal(c2.scan.oldestTxAt, "2026-06-01T00:00:00Z"); assert.deepEqual(deep.scanDepth.truncatedChains, []);
  assert.equal(c2.approvals.length, 1, "deep scan finds the old approval"); assert.equal(c2.approvals[0].usdAtRisk, 250);
  assert.equal(deep.findings[0].sev, "critical", "unlimited + unverified + $250 balance = critical"); assert.ok(deep.findings[0].text.includes("$250.00 at risk"));
  assert.ok(deep.findings.some(f => f.sev === "info" && /Full history scanned \(151 txs/.test(f.text)));
  assert.ok(!deep.findings.some(f => f.truncated)); assert.equal(deep.findings.length, std.findings.length + 1, "deep adds the approval finding");
  assert.equal(deep.score, 70); assert.equal(deep.valueAtRisk.usd, 250); assert.equal(deep.valueAtRisk.byChain.Optimism, 250); }
// Sprint 2 (b): pages clamp 1-25. (c): call estimate.
assert.equal(clampPages(99), 25); assert.equal(clampPages(0), 1); assert.equal(clampPages(undefined), 2); assert.equal(clampPages("abc"), 2);
{ const calls = []; const r99 = await healthCard("proapi_test", ME, [10], { pages: 99, fetchImpl: async url => { calls.push(url); return { ok: false, status: 404, headers: new Map(), json: async () => null }; } });
  assert.equal(r99.scanDepth.pages, 25); assert.ok(!calls.some(u => /pages=/.test(u)), "pages is not forwarded to the API or Blockscout ctor");
  const r0 = await healthCard("proapi_test", ME, [10], { pages: 0, fetchImpl: async () => ({ ok: false, status: 404, headers: new Map(), json: async () => null }) });
  assert.equal(r0.scanDepth.pages, 1); assert.equal(r0.scanDepth.tier, "standard"); }
assert.equal(estimateCalls(5, 2), 35); assert.equal(estimateCalls(5, 25), 265); assert.equal(estimateCalls(1, 1), 5);
// Sprint 2: approval value-at-risk = min(allowance, balance) x exchange_rate, totals per chain and overall, findings sorted by USD at risk.
{ const WETH = "0x4200000000000000000000000000000000000006", THIN = "0x7777000000000000000000000000000000007777", R2 = "0x3333000000000000000000000000000000003333";
  const bals = [{ value: "150000000", token: { symbol: "USDC", decimals: "6", exchange_rate: "1", holders_count: "9000000", address_hash: USDC } },
    { value: "2000000000000000000", token: { symbol: "WETH", decimals: "18", exchange_rate: "2600", holders_count: "900000", address_hash: WETH } },
    { value: "1000000000000000000000", token: { symbol: "THIN", decimals: "18", exchange_rate: "5", holders_count: "12", address_hash: THIN } }];
  const appr = [ // limited 40 USDC < 150 balance; unlimited WETH (2 x 2600); unlimited thin token (price not trusted); approval on a token not held
    { token: USDC, spender: ROUTER, nft: false, unlimited: false, allowanceRaw: "40000000" }, { token: WETH, spender: R2, nft: false, unlimited: true, allowanceRaw: MAX },
    { token: THIN, spender: R2, nft: false, unlimited: true, allowanceRaw: MAX }, { token: FRIEND, spender: R2, nft: false, unlimited: true, allowanceRaw: MAX },
    { token: USDC, spender: R2, nft: true, scope: "all", unlimited: true }];
  const v = approvalValueAtRisk(appr, bals);
  assert.equal(appr[0].usdAtRisk, 40); assert.equal(appr[1].usdAtRisk, 5200); assert.equal(appr[2].usdAtRisk, null); assert.equal(appr[2].amountAtRisk, 1000);
  assert.equal(appr[3].usdAtRisk, 0); assert.equal(appr[4].usdAtRisk, null); assert.equal(v.usd, 5240); assert.equal(v.unpricedApprovals, 1);
  // End to end on two chains: total per chain and overall, and medium findings ordered by USD at risk (not scan order).
  const VER = "0x4444000000000000000000000000000000004444";
  const chainDb = (tokenBal, approveTxs) => ({ [`/addresses/${ME}`]: { hash: ME, coin_balance: "1" }, [`/addresses/${ME}/counters`]: { transactions_count: "2" },
    [`/addresses/${ME}/token-balances`]: tokenBal, [`/addresses/${ME}/token-transfers`]: { items: [], next_page_params: null },
    [`/addresses/${ME}/transactions`]: { items: approveTxs, next_page_params: null }, [`/tokens/${USDC}`]: { symbol: "USDC", type: "ERC-20" }, [`/tokens/${WETH}`]: { symbol: "WETH", type: "ERC-20" },
    [`/addresses/${VER}`]: { hash: VER, is_contract: true, is_verified: true, name: "Router" }, [`/addresses/${DRAINER}`]: { hash: DRAINER, is_verified: false } });
  const ap = (i, tok, sp, amt) => apprTx(i, tok, "approve", [{ name: "spender", value: sp }, { name: "amount", value: amt }]);
  const dbs = { 10: chainDb([bals[0], bals[1]], [ap(1, USDC, VER, MAX), ap(2, WETH, VER, MAX)]), // scan order: USDC ($150) then WETH ($5200)
    42161: chainDb([bals[0]], [ap(3, USDC, DRAINER, "100000000")]) }; // limited to unverified: not scored, but valued ($100)
  const rv = await healthCard("proapi_test", ME, [10, 42161], { fetchImpl: async url => { const m = new URL(url).pathname.match(/^\/(\d+)\/api\/v2(.*)$/);
    const body = dbs[m[1]][m[2]]; return { ok: !!body, status: body ? 200 : 404, headers: new Map(), json: async () => body }; } });
  assert.equal(rv.valueAtRisk.byChain.Optimism, 5350); assert.equal(rv.valueAtRisk.byChain["Arbitrum One"], 100); assert.equal(rv.valueAtRisk.usd, 5450);
  const meds = rv.findings.filter(f => f.sev === "medium"); assert.deepEqual(meds.map(f => f.usdAtRisk), [5200, 150], "sorted by USD at risk");
  assert.ok(!rv.findings.some(f => f.sev === "critical" || f.sev === "high")); }
// Sprint 2 (#2): "Powered by Blockscout" evidence panel: endpoints, call counts, credits before/after, per-chain latency.
{ const ev = r.evidence; assert.ok(ev, "evidence attached to every report");
  assert.equal(ev.totalCalls, r.apiCalls); assert.equal(ev.endpoints.reduce((t, e) => t + e.calls, 0), r.apiCalls, "every call is attributed to an endpoint");
  assert.equal(ev.api, "https://api.blockscout.com/{chain_id}/api/v2");
  const eps = Object.fromEntries(ev.endpoints.map(e => [e.endpoint, e]));
  for (const k of ["/addresses/{address}", "/addresses/{address}/counters", "/addresses/{address}/token-balances", "/addresses/{address}/token-transfers", "/addresses/{address}/transactions", "/tokens/{token}"])
    assert.ok(eps[`GET /api/v2${k}`], `endpoint listed: ${k}`);
  assert.equal(eps["GET /api/v2/addresses/{address}"].errors, 3, "the three 402 paid-chain calls are counted as errors");
  assert.deepEqual(eps["GET /api/v2/tokens/{token}"].chains, [10]);
  assert.ok(!/0x[0-9a-fA-F]{40}/.test(JSON.stringify(ev)), "evidence groups by endpoint template, no raw addresses");
  assert.equal(ev.perChain.length, ALL_CHAINS.length); const op = ev.perChain.find(p => p.chainId === 10);
  assert.ok(op.calls > 5 && Number.isFinite(op.avgMs) && Number.isFinite(op.maxMs) && Number.isFinite(op.wallMs));
  assert.equal(ev.perChain.reduce((t, p) => t + p.calls, 0), r.apiCalls);
  assert.deepEqual(ev.credits, { before: 99000, after: 99000, used: 0, header: "x-credits-remaining", reported: true });
  assert.equal(endpointTemplate(`/tokens/${USDC}`), "/tokens/{token}"); assert.equal(endpointTemplate(`/addresses/${ME}/token-transfers`), "/addresses/{address}/token-transfers");
  // Credits measured from x-credits-remaining: decreasing header -> before/after/used.
  let n = 1000; const rc = await healthCard("proapi_test", ME, [10], { fetchImpl: async url => { const path = new URL(url).pathname.replace(/^\/10\/api\/v2/, ""); const body = db[path];
    return { ok: !!body, status: body ? 200 : 404, headers: new Map([["x-credits-remaining", String(--n)]]), json: async () => body }; } });
  assert.equal(rc.evidence.credits.before, 999); assert.equal(rc.evidence.credits.after, 1000 - rc.apiCalls); assert.equal(rc.evidence.credits.used, rc.apiCalls - 1); assert.equal(rc.creditsUsed, rc.apiCalls - 1);
  const txt = formatEvidence(rc.evidence).join("\n");
  assert.ok(/Powered by Blockscout PRO API/.test(txt) && /999 before → \d+ after = \d+ used/.test(txt) && /Per-chain latency/.test(txt) && /Optimism .* calls · avg \d+ ms · max \d+ ms · scan \d+ ms/.test(txt));
  // No header -> "not reported", never a made-up number.
  const { r: rn } = await scan(wallet([]));
  assert.equal(rn.evidence.credits.reported, false); assert.equal(rn.evidence.credits.used, null); assert.ok(/not reported/.test(formatEvidence(rn.evidence).join("\n"))); }
// Sprint 2 (#2): two Blockscout Explorer links per finding (tx + spender contract page / look-alike address page).
{ const d = r.findings.find(f => f.text.includes(DRAINER));
  assert.equal(d.links.tx, "https://optimism.blockscout.com/tx/0xappr2"); assert.equal(d.links.contract, `https://optimism.blockscout.com/address/${DRAINER}?tab=contract`); assert.equal(d.chainId, 10);
  const p = r.findings.find(f => /poisoning/.test(f.text));
  assert.equal(p.links.tx, "https://optimism.blockscout.com/tx/0xpoison1"); assert.equal(p.links.contract, `https://optimism.blockscout.com/address/${FAKE}`, "look-alike EOA: plain address page");
  assert.ok(r.findings.filter(f => f.sev !== "info" && f.tx).every(f => f.links.tx && f.links.contract), "every tx-backed finding has both links"); }
// Sprint 2 (#6): revoke helper text: exact call + revoke.cash link per chain; never a built or signed transaction.
{ const d = r.findings.find(f => f.text.includes(DRAINER));
  assert.equal(d.revoke.call, `approve(${DRAINER}, 0)`); assert.equal(d.revoke.contract, USDC); assert.equal(d.revoke.url, `https://revoke.cash/address/${ME}?chainId=10`);
  assert.equal(d.revoke.text, `Call approve(${DRAINER}, 0) on USDC (${USDC})`); assert.equal(d.revoke.tokenUrl, `https://optimism.blockscout.com/address/${USDC}?tab=contract`);
  assert.ok(base.approvals.every(a => a.revoke && a.revoke.url.endsWith("chainId=10")));
  assert.ok(!r.findings.some(f => /poisoning|look-alike/.test(f.text) && f.revoke), "no revoke text on non-approval findings");
  const OP = "0x5555000000000000000000000000000000000555", NFT = "0x00000000000000000000000000000000000a721a";
  assert.equal(revokeHelp(ME, 42161, { token: NFT, tokenName: "PUNK", scope: "all", spender: OP }).call, `setApprovalForAll(${OP}, false)`);
  assert.equal(revokeHelp(ME, 42161, { token: NFT, tokenName: "PUNK", scope: "single", spender: OP, tokenId: "7" }).call, `approve(0x${"0".repeat(40)}, 7)`);
  assert.equal(revokeHelp(ME, 534352, { token: USDC, scope: "amount", spender: OP }).url, `https://revoke.cash/address/${ME}?chainId=534352`);
  const src = ["docs/core.js", "docs/app.js", "cli/health.mjs"].map(f => readFileSync(new URL(`../${f}`, import.meta.url), "utf8")).join("\n");
  assert.ok(!/eth_sendTransaction|eth_sign|personal_sign|signTypedData|signTransaction|sendTransaction|window\.ethereum/.test(src), "read-only: no signing or wallet calls anywhere"); }
// Sprint 2 (#5): shareable PNG card content (canvas drawing itself lives in docs/app.js).
{ const s = cardSummary(r);
  assert.equal(s.grade, "B"); assert.equal(s.score, 74); assert.equal(s.address, "0x1111…1234"); assert.deepEqual(s.chains, ["Optimism"]);
  assert.equal(s.top.length, 3); assert.equal(s.more, 1); assert.equal(s.top[0].sev, "high"); assert.ok(s.top.every(f => f.sev !== "info"));
  assert.ok(!/0x[0-9a-fA-F]{40}/.test(JSON.stringify(s)), "card shortens every address"); assert.equal(s.valueAtRiskUsd, 0); assert.equal(s.apiCalls, r.apiCalls);
  const sample = JSON.parse(readFileSync(new URL("../docs/sample.json", import.meta.url), "utf8")); const ss = cardSummary(sample);
  assert.equal(ss.grade, sample.grade); assert.equal(ss.top.length, 3); assert.ok(ss.top.every(f => f.sev === "high"), "card shows worst findings first even for an unsorted recorded scan");
  assert.ok(/look-alike 0x[0-9a-f]{8}…[0-9a-f]{4} \(mimics 0x[0-9a-f]{8}…/.test(ss.top[0].text)); const [fa, mi] = ss.top[0].text.match(/0x[0-9a-f]{8}…[0-9a-f]{4}/g); assert.notEqual(fa, mi, "look-alike and real contact stay distinguishable"); }
// CLI prints the evidence panel, both Explorer links and the revoke line (offline: fetch mocked via --import).
{ const run = extra => spawnSync(process.execPath, ["--import", new URL("./cli-mock.mjs", import.meta.url).href, new URL("../cli/health.mjs", import.meta.url).pathname, ME, "10", ...extra],
    { env: { ...process.env, BLOCKSCOUT_API_KEY: "proapi_test" }, encoding: "utf8" });
  const o = run([]); assert.equal(o.status, 0, o.stderr); const out = o.stdout;
  assert.ok(out.includes("tx:       https://optimism.blockscout.com/tx/0xappr")); assert.ok(out.includes(`spender:  https://optimism.blockscout.com/address/0x9999000000000000000000000000000000000bad?tab=contract`));
  assert.ok(out.includes("revoke:   Call approve(0x9999000000000000000000000000000000000bad, 0) on USDC")); assert.ok(out.includes("https://revoke.cash/address/" + ME + "?chainId=10"));
  assert.ok(/Powered by Blockscout PRO API/.test(out) && /4999 before → \d+ after = \d+ used/.test(out) && /GET \/api\/v2\/addresses\/\{address\}\/transactions/.test(out) && /Optimism\s+\d+ calls · avg/.test(out));
  assert.ok(/\[critical\] Optimism: Unlimited approval on USDC to unverified/.test(out), "$5 balance + unverified spender = critical");
  const b = run(["--brief"]); assert.equal(b.status, 0); assert.ok(!b.stdout.includes("revoke:") && !b.stdout.includes("Endpoints called") && /Blockscout PRO API calls/.test(b.stdout));
  const j = run(["--json"]); assert.equal(j.status, 0); const jr = JSON.parse(j.stdout); assert.ok(jr.evidence.endpoints.length >= 5 && jr.findings[0].links.contract && jr.findings[0].revoke.call); }
console.log("all tests passed:", r.grade, r.score, r.findings.length, "findings,", r.apiCalls, "mock API calls; deep-scan (a-c) + value-at-risk + evidence panel + explorer links + revoke helper + PNG card + CLI tests ok");
