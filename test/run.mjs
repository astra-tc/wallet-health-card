// Offline test with a mocked Blockscout PRO API.
import { healthCard, ALL_CHAINS, detectPoisoning } from "../docs/core.js";
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
assert.equal(r.grade, "B"); // 100-15-4-5-2 = 74
// Regression: paying a look-alike must be a high finding, and the genuine contact must never be labelled the fake.
{ const tr = (from, to, value, tx, ts) => ({ from: { hash: from }, to: { hash: to }, total: { value }, token: { symbol: "USDC" }, transaction_hash: tx, timestamp: ts });
  const hits = detectPoisoning(ME, [
    tr(ME, FAKE, "25000000", "0xoops", "2026-10-21T10:00:00Z"), tr(FAKE, ME, "0", "0xpoison", "2026-10-20T10:00:00Z"),
    tr(FRIEND, ME, "10000000", "0xrefund", "2026-10-19T12:00:00Z"), tr(ME, FRIEND, "50000000", "0xreal1", "2026-10-19T10:00:00Z")],
    [{ hash: "0xnative", from: { hash: ME }, to: { hash: FAKE }, value: "1000000000000000", timestamp: "2026-10-21T11:00:00Z" }]);
  assert.ok(hits.every(h => h.fake === FAKE && h.mimics === FRIEND), "genuine contact must never be reported as the fake");
  assert.deepEqual(hits.filter(h => h.sentToFake).map(h => h.tx).sort(), ["0xnative", "0xoops"]);
  assert.deepEqual(hits.filter(h => !h.sentToFake).map(h => h.tx), ["0xpoison"]); }
console.log("all tests passed:", r.grade, r.score, r.findings.length, "findings,", r.apiCalls, "mock API calls");
