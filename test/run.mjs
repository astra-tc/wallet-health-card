// Offline test with a mocked Blockscout PRO API. Also writes docs/sample.json for the UI "Sample" button.
import { healthCard } from "../docs/core.js";
import { writeFileSync } from "fs"; import assert from "assert";
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
  [`/addresses/${ROUTER}`]: { hash: ROUTER, is_contract: true, is_verified: true, name: "SwapRouter02" },
  [`/addresses/${DRAINER}`]: { hash: DRAINER, is_contract: true, is_verified: false, name: null },
};
const mock = async url => { const u = new URL(url); const m = u.pathname.match(/^\/(\d+)\/api\/v2(.*)$/);
  const body = m[1] === "8453" ? db[m[2]] : (m[2] === `/addresses/${ME}` ? { coin_balance: "0" } : m[2].endsWith("counters") ? { transactions_count: "0" } : { items: [] });
  return { ok: !!body, status: body ? 200 : 404, headers: new Map([["x-credits-remaining", "99000"]]), json: async () => body }; };
const r = await healthCard("proapi_test", ME, undefined, { fetchImpl: mock });
const base = r.chains.find(c => c.chainId === 8453);
assert.equal(r.chains.filter(c => c.active).length, 1);
assert.equal(base.poisoning.length, 1); assert.equal(base.poisoning[0].fake, FAKE);
assert.equal(base.approvals.length, 2); assert.ok(base.approvals.every(a => a.unlimited));
assert.equal(base.spamTokens.length, 1);
assert.ok(r.findings.some(f => f.sev === "high" && f.text.includes(DRAINER)));
assert.equal(r.grade, "B"); // 100-15-4-5-2 = 74
writeFileSync(new URL("../docs/sample.json", import.meta.url), JSON.stringify({ ...r, address: ME, sample: true }, null, 2));
console.log("all tests passed:", r.grade, r.score, r.findings.length, "findings,", r.apiCalls, "mock API calls");
