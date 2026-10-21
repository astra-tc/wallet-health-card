// Wallet Health Card core: works in browser and Node 18+ (global fetch).
// All data comes from the Blockscout PRO API: https://api.blockscout.com/{chain_id}/api/v2
export const CHAINS = {
  1: { name: "Ethereum", explorer: "https://eth.blockscout.com" },
  10: { name: "Optimism", explorer: "https://optimism.blockscout.com" },
  42161: { name: "Arbitrum One", explorer: "https://arbitrum.blockscout.com" },
  100: { name: "Gnosis", explorer: "https://gnosis.blockscout.com" },
  534352: { name: "Scroll", explorer: "https://scroll.blockscout.com" },
  // Paid-plan only (Builder/Business/Pro) since Oct 1, 2026: opt in with includePaid.
  8453: { name: "Base", explorer: "https://base.blockscout.com", paid: true },
  137: { name: "Polygon", explorer: "https://polygon.blockscout.com", paid: true },
  324: { name: "ZKsync Era", explorer: "https://zksync.blockscout.com", paid: true },
};
export const FREE_CHAINS = Object.keys(CHAINS).filter(k => !CHAINS[k].paid).map(Number);
export const ALL_CHAINS = Object.keys(CHAINS).map(Number);
const MAX_UINT_HEX_LEN = 60; // approvals >= ~2^240 count as "unlimited"

export class Blockscout {
  constructor({ apiKey, fetchImpl = (...a) => globalThis.fetch(...a), base = "https://api.blockscout.com", timeoutMs = 20000, maxConcurrent = 3 }) {
    this.maxConcurrent = maxConcurrent; this.active = 0; this.queue = [];
    this.apiKey = apiKey; this.fetch = fetchImpl; this.base = base; this.calls = 0; this.credits = null; this.timeoutMs = timeoutMs;
  }
  async slot() { if (this.active < this.maxConcurrent) { this.active++; return; } await new Promise(r => this.queue.push(r)); this.active++; }
  release() { this.active--; const n = this.queue.shift(); if (n) n(); }
  async get(chainId, path, params = {}) { await this.slot(); try { return await this._get(chainId, path, params); } finally { this.release(); } }
  async _get(chainId, path, params = {}) {
    const u = new URL(`${this.base}/${chainId}/api/v2${path}`);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) u.searchParams.set(k, v);
    let last;
    for (let attempt = 0; attempt < 5; attempt++) {
      this.calls++;
      let r;
      try {
        const sig = typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(this.timeoutMs) : undefined;
        r = await this.fetch(u.toString(), { headers: { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json" }, signal: sig });
      } catch (e) { const to = e?.name === "TimeoutError" || e?.name === "AbortError"; last = new Error(to ? `Blockscout timeout on ${path}` : `Network error on ${path}: ${e?.message || e}`); last.status = to ? "timeout" : "network"; break; }
      const c = r.headers?.get?.("x-credits-remaining"); if (c) this.credits = Number(c);
      if (r.status === 429) { const reset = Number(r.headers?.get?.("x-ratelimit-reset")); await new Promise(s => setTimeout(s, Math.min(5000, reset > 0 ? reset + 100 : 1000 * (attempt + 1)))); last = null; continue; }
      if (r.status === 404) return null;
      if (r.status === 402) { const e = new Error("This chain needs a paid Blockscout plan (Builder/Business/Pro)"); e.status = 402; throw e; }
      if (r.status === 401 || r.status === 403) { const e = new Error("Blockscout API key rejected"); e.status = r.status; throw e; }
      if (!r.ok) { last = new Error(`Blockscout ${r.status} on ${path}`); last.status = r.status; break; }
      return r.json();
    }
    throw last || new Error(`Blockscout rate-limited on ${path}`);
  }
  async pages(chainId, path, params = {}, maxPages = 2) {
    const out = []; let next = {};
    for (let i = 0; i < maxPages && next; i++) {
      const j = await this.get(chainId, path, { ...params, ...next });
      if (!j) break; out.push(...(j.items || [])); next = j.next_page_params || null;
    }
    return out;
  }
}

const lc = s => (s || "").toLowerCase();
const short = a => a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
export const lookalike = (a, b) => lc(a) !== lc(b) && lc(a).slice(2, 6) === lc(b).slice(2, 6) && lc(a).slice(-4) === lc(b).slice(-4);

export function detectPoisoning(addr, transfers, txs) {
  const me = lc(addr);
  // Real counterparties = addresses this wallet sent value/tokens to.
  const real = new Set();
  for (const t of transfers) if (lc(t.from?.hash) === me && lc(t.to?.hash) !== me) real.add(lc(t.to.hash));
  for (const t of txs) if (lc(t.from?.hash) === me && t.to?.hash && Number(t.value) > 0) real.add(lc(t.to.hash));
  const hits = [];
  for (const t of transfers) {
    const other = lc(t.from?.hash) === me ? lc(t.to?.hash) : lc(t.from?.hash);
    if (!other || real.has(other) && lc(t.from?.hash) === me) continue;
    for (const r of real) if (lookalike(other, r)) {
      const zero = t.total?.value === "0";
      hits.push({ fake: other, mimics: r, tx: t.transaction_hash, token: t.token?.symbol || "?", zeroValue: zero,
        sentToFake: lc(t.from?.hash) === me, ts: t.timestamp });
    }
  }
  return hits;
}

export function extractApprovals(addr, txs) {
  const me = lc(addr); const map = new Map();
  for (const t of [...txs].reverse()) { // oldest first, latest wins
    if (lc(t.from?.hash) !== me || t.status !== "ok") continue;
    const m = t.method || t.decoded_input?.method_call || "";
    if (!/^(approve|setApprovalForAll|increaseAllowance)/.test(m)) continue;
    const p = t.decoded_input?.parameters || [];
    const spender = lc((p.find(x => /spender|operator/i.test(x.name)) || p[0] || {}).value);
    const raw = String((p.find(x => /amount|value|approved|addedValue/i.test(x.name)) || p[1] || {}).value ?? "");
    const unlimited = raw === "true" || BigInt(/^\d+$/.test(raw) ? raw : "0").toString(16).length >= MAX_UINT_HEX_LEN;
    const revoked = raw === "0" || raw === "false";
    const key = `${lc(t.to?.hash)}|${spender}`;
    map.set(key, { token: t.to?.hash, tokenName: t.to?.name || short(t.to?.hash), spender, method: m.split("(")[0],
      unlimited, revoked, tx: t.hash, ts: t.timestamp });
  }
  return [...map.values()].filter(a => !a.revoked);
}

export async function enrichSpenders(bs, chainId, approvals) {
  const uniq = [...new Set(approvals.map(a => a.spender).filter(Boolean))].slice(0, 15);
  const toks = [...new Set(approvals.map(a => lc(a.token)).filter(Boolean))].slice(0, 15);
  const info = {}, tinfo = {};
  await Promise.all([
    ...uniq.map(async s => { info[s] = await bs.get(chainId, `/addresses/${s}`).catch(() => null); }),
    ...toks.map(async t => { tinfo[t] = await bs.get(chainId, `/tokens/${t}`).catch(() => null); }),
  ]);
  for (const a of approvals) {
    const i = info[a.spender]; const ti = tinfo[lc(a.token)];
    if (ti?.symbol) a.tokenName = ti.symbol; a.tokenType = ti?.type || null;
    a.spenderName = i?.name || i?.metadata?.tags?.[0]?.name || null;
    a.spenderVerified = !!i?.is_verified; a.spenderIsContract = !!i?.is_contract;
    a.spenderScam = !!i?.is_scam || (i?.metadata?.tags || []).some(t => /scam|phish|exploit/i.test(t.name || t.slug || ""));
  }
  return approvals;
}

export async function scanChain(bs, chainId, addr) {
  const info = await bs.get(chainId, `/addresses/${addr}`);
  if (!info) return { chainId, active: false };
  const warnings = [];
  const soft = (label, dflt) => e => { warnings.push(`${label}: ${e.message}`); return dflt; };
  const [balances, transfers, txs, counters] = await Promise.all([
    bs.get(chainId, `/addresses/${addr}/token-balances`).catch(soft("token balances", [])),
    bs.pages(chainId, `/addresses/${addr}/token-transfers`, { type: "ERC-20" }, 2).catch(soft("token transfers", [])),
    bs.pages(chainId, `/addresses/${addr}/transactions`, {}, 2).catch(soft("transactions", [])),
    bs.get(chainId, `/addresses/${addr}/counters`).catch(soft("counters", null)),
  ]);
  const active = (counters && Number(counters.transactions_count) > 0) || txs.length > 0 || transfers.length > 0 || Number(info.coin_balance) > 0;
  if (!active) return { chainId, active: false };
  const approvals = await enrichSpenders(bs, chainId, extractApprovals(addr, txs));
  const poisoning = detectPoisoning(addr, transfers, txs);
  const tokens = (Array.isArray(balances) ? balances : balances?.items || []).filter(b => b.token?.type === "ERC-20" || !b.token?.type).map(b => ({ symbol: b.token?.symbol, name: b.token?.name, address: b.token?.address_hash || b.token?.address,
    value: Number(b.value) / 10 ** Number(b.token?.decimals || 18), usd: b.token?.exchange_rate ? Number(b.value) / 10 ** Number(b.token.decimals || 18) * Number(b.token.exchange_rate) : null,
    reputation: b.token?.reputation || null, holders: Number(b.token?.holders_count || 0),
    mcap: Number(b.token?.circulating_market_cap || 0) }));
  // Price sanity: ignore USD for thin/unpriced tokens (fake exchange rates inflate totals).
  for (const t of tokens) if (t.usd != null && (t.holders < 500 || (t.mcap > 0 && t.usd > t.mcap))) { t.usdIgnored = t.usd; t.usd = null; }
  const spamTokens = tokens.filter(t => t.reputation === "scam" || (t.usd === null && /claim|visit|\.com|\.xyz|reward|airdrop/i.test(`${t.name} ${t.symbol}`)));
  return { chainId, active: true, warnings, ens: info.ens_domain_name || null, delegatedTo: info.implementations?.[0]?.name || null, isContract: info.is_contract, nativeBalance: Number(info.coin_balance || 0) / 1e18,
    nativeUsd: info.exchange_rate ? Number(info.coin_balance || 0) / 1e18 * Number(info.exchange_rate) : null,
    tokenTransferCount: Number(counters?.token_transfers_count || 0), txCount: Number(counters?.transactions_count || txs.length), tokens, spamTokens, approvals, poisoning,
    lastActive: txs[0]?.timestamp || null };
}

export function score(chains) {
  let s = 100; const findings = [];
  for (const c of chains.filter(c => c.active)) {
    const n = CHAINS[c.chainId]?.name || c.chainId;
    for (const a of c.approvals) {
      if (a.spenderScam) { s -= 30; findings.push({ sev: "high", chain: n, text: `Approval to flagged address ${a.spender} on ${a.tokenName}`, tx: a.tx }); }
      else if (a.unlimited && !a.spenderVerified) { s -= 15; findings.push({ sev: "high", chain: n, text: `Unlimited approval on ${a.tokenName} to unverified ${a.spender}`, tx: a.tx }); }
      else if (a.unlimited) { s -= 4; findings.push({ sev: "medium", chain: n, text: `Unlimited approval on ${a.tokenName} to ${a.spenderName || a.spender}`, tx: a.tx }); }
    }
    for (const p of c.poisoning) {
      if (p.sentToFake) { s -= 30; findings.push({ sev: "high", chain: n, text: `Funds sent to look-alike ${p.fake} (mimics ${p.mimics})`, tx: p.tx }); }
      else { s -= 5; findings.push({ sev: "medium", chain: n, text: `Address-poisoning attempt: ${p.fake} mimics your contact ${p.mimics}${p.zeroValue ? " (zero-value transfer)" : ""}`, tx: p.tx }); }
    }
    if (c.spamTokens.length) { s -= Math.min(10, c.spamTokens.length * 2); findings.push({ sev: "low", chain: n, text: `${c.spamTokens.length} spam/airdrop-bait token(s) held: never interact with their sites` }); }
  }
  for (const c of chains.filter(c => c.needsPaidPlan)) findings.push({ sev: "info", chain: CHAINS[c.chainId]?.name || c.chainId, text: "Skipped: this chain needs a paid Blockscout PRO plan" });
  for (const c of chains.filter(c => c.active && c.warnings?.length)) findings.push({ sev: "info", chain: CHAINS[c.chainId]?.name || c.chainId, text: `Partial data (${c.warnings.join("; ")})` });
  s = Math.max(0, Math.min(100, s));
  return { score: s, grade: s >= 85 ? "A" : s >= 70 ? "B" : s >= 50 ? "C" : s >= 30 ? "D" : "F", findings };
}

export async function healthCard(apiKey, addr, chainIds = FREE_CHAINS, opts = {}) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) throw new Error("Enter a valid 0x address");
  const bs = new Blockscout({ apiKey, ...opts });
  const chains = await Promise.all(chainIds.map(id => scanChain(bs, id, addr).catch(e => ({ chainId: id, active: false, error: e.message, needsPaidPlan: e.status === 402 }))));
  if (chains.length && chains.every(c => c.error && /key rejected/.test(c.error))) throw new Error("Blockscout API key rejected");
  if (chains.length && chains.every(c => c.error)) throw new Error(`Could not reach Blockscout on any chain: ${chains[0].error}`);
  return { address: addr, generatedAt: new Date().toISOString(), chains, ...score(chains), apiCalls: bs.calls, creditsRemaining: bs.credits };
}
