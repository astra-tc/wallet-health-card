// Preloaded by test/run.mjs (node --import) so the CLI runs offline against a mocked Blockscout PRO API.
const ME = "0x1111aaaa00000000000000000000000000001234", USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", DRAINER = "0x9999000000000000000000000000000000000bad";
const MAX = (2n ** 256n - 1n).toString();
const db = {
  [`/addresses/${ME}`]: { hash: ME, coin_balance: "1" }, [`/addresses/${ME}/counters`]: { transactions_count: "1" },
  [`/addresses/${ME}/token-balances`]: [{ value: "5000000", token: { symbol: "USDC", decimals: "6", exchange_rate: "1", holders_count: "5000000", address_hash: USDC, type: "ERC-20" } }],
  [`/addresses/${ME}/token-transfers`]: { items: [], next_page_params: null },
  [`/addresses/${ME}/transactions`]: { items: [{ hash: "0xappr", from: { hash: ME }, to: { hash: USDC }, status: "ok", method: "approve", value: "0", timestamp: "2026-10-01T00:00:00Z",
    decoded_input: { parameters: [{ name: "spender", value: DRAINER }, { name: "amount", value: MAX }] } }], next_page_params: null },
  [`/tokens/${USDC}`]: { symbol: "USDC", type: "ERC-20" }, [`/addresses/${DRAINER}`]: { hash: DRAINER, is_contract: true, is_verified: false },
};
let credits = 5000;
globalThis.fetch = async url => { const path = new URL(url).pathname.replace(/^\/\d+\/api\/v2/, ""); const body = db[path];
  return { ok: !!body, status: body ? 200 : 404, headers: new Map([["x-credits-remaining", String(--credits)]]), json: async () => body }; };
