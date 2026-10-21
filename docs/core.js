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
  const me = lc(addr); const when = x => { const t = Date.parse(x || ""); return Number.isNaN(t) ? Infinity : t; };
  // Every address this wallet sent value/tokens to, with the time it was first paid.
  const firstPaid = new Map();
  const paid = (to, ts) => { to = lc(to); if (to && to !== me) firstPaid.set(to, Math.min(firstPaid.get(to) ?? Infinity, when(ts))); };
  for (const t of transfers) if (lc(t.from?.hash) === me) paid(t.to?.hash, t.timestamp);
  for (const t of txs) if (lc(t.from?.hash) === me && t.to?.hash && Number(t.value) > 0) paid(t.to.hash, t.timestamp);
  // Genuine contacts: paid addresses with no look-alike paid earlier. A look-alike paid later is the
  // poisoner's address (it only exists to mimic a contact you already had), so paying it must still be flagged.
  const genuine = [...firstPaid].filter(([a, ts]) => ![...firstPaid].some(([b, tb]) => lookalike(a, b) && (tb < ts || (tb === ts && b < a)))).map(([a]) => a);
  const isGenuine = new Set(genuine);
  const hits = [];
  for (const t of transfers) {
    const sent = lc(t.from?.hash) === me; const other = sent ? lc(t.to?.hash) : lc(t.from?.hash);
    if (!other || other === me || isGenuine.has(other)) continue;
    const r = genuine.find(g => lookalike(other, g)); if (!r) continue;
    hits.push({ fake: other, mimics: r, tx: t.transaction_hash, token: t.token?.symbol || "?", zeroValue: t.total?.value === "0",
      sentToFake: sent, ts: t.timestamp });
  }
  for (const t of txs) { // native-coin payments to a look-alike
    const to = lc(t.to?.hash); if (lc(t.from?.hash) !== me || !(Number(t.value) > 0) || !to || isGenuine.has(to)) continue;
    const r = genuine.find(g => lookalike(to, g));
    if (r) hits.push({ fake: to, mimics: r, tx: t.hash, token: "native", zeroValue: false, sentToFake: true, ts: t.timestamp });
  }
  return hits;
}

const APPROVAL_METHODS = new Set(["approve", "setApprovalForAll", "increaseAllowance"]);
const NFT_TYPES = new Set(["ERC-721", "ERC-1155"]);
const ZERO = "0x0000000000000000000000000000000000000000";
// Exact method name: "approve(address,uint256)" -> "approve"; "approveAndCall" never matches.
const methodName = t => String(t.method || t.decoded_input?.method_call || "").split("(")[0].trim();
const isApprovalTx = (me, t) => lc(t.from?.hash) === me && t.status === "ok" && APPROVAL_METHODS.has(methodName(t));

// Token contracts this wallet sent approval calls to (looked up before parsing to learn ERC-20 vs NFT).
export function approvalTokens(addr, txs) {
  const me = lc(addr); return [...new Set(txs.filter(t => isApprovalTx(me, t)).map(t => lc(t.to?.hash)).filter(Boolean))];
}

// tokenTypes: { [lowercased token address]: "ERC-20" | "ERC-721" | "ERC-1155" | ... } from /tokens/{address}.
export function extractApprovals(addr, txs, tokenTypes = {}) {
  const me = lc(addr); const map = new Map();
  for (const t of [...txs].reverse()) { // oldest first, latest wins
    if (!isApprovalTx(me, t)) continue;
    const m = methodName(t); const token = lc(t.to?.hash);
    const p = t.decoded_input?.parameters || [];
    const arg = (re, i) => (p.find(x => re.test(x.name || "")) || p[i] || {}).value;
    const tokenType = tokenTypes[token] || null;
    const base = { token: t.to?.hash, tokenName: t.to?.name || short(t.to?.hash), tokenType, method: m, tx: t.hash, ts: t.timestamp };
    if (m === "setApprovalForAll") { // ERC-721/1155 operator approval: covers every NFT in the collection
      const spender = lc(arg(/operator/i, 0)); const on = String(arg(/approved/i, 1)) === "true";
      map.set(`${token}|all|${spender}`, { ...base, nft: true, scope: "all", spender, unlimited: on, revoked: !on });
    } else if (m === "approve" && (NFT_TYPES.has(tokenType) || p.some(x => /tokenid/i.test(x.name || "")))) {
      // ERC-721 approve(to, tokenId): one approved address per token id; approve(0x0, id) clears it.
      const spender = lc(arg(/^(to|approved|spender|operator)$/i, 0)); const tokenId = String(arg(/tokenid/i, 1) ?? "");
      map.set(`${token}|id|${tokenId}`, { ...base, nft: true, scope: "single", tokenId, spender, unlimited: false, revoked: !spender || spender === ZERO });
    } else { // ERC-20 allowance
      const spender = lc(arg(/spender/i, 0));
      const raw = String(arg(/amount|value|addedValue/i, 1) ?? "");
      const unlimited = /^\d+$/.test(raw) && BigInt(raw).toString(16).length >= MAX_UINT_HEX_LEN;
      map.set(`${token}|${spender}`, { ...base, nft: false, scope: "amount", spender, unlimited, revoked: raw === "0" });
    }
  }
  return [...map.values()].filter(a => !a.revoked);
}

// Fetch token metadata (symbol/type) once per token contract.
export async function fetchTokens(bs, chainId, tokens) {
  const out = {};
  await Promise.all([...new Set(tokens.map(lc).filter(Boolean))].map(async t => { out[t] = await bs.get(chainId, `/tokens/${t}`).catch(() => null); }));
  return out;
}

// Looks up EVERY spender (the request limiter keeps this polite). A spender whose lookup errored is
// "unknown" (spenderVerified === null), never silently "unverified".
export async function enrichSpenders(bs, chainId, approvals, tokenInfo = null) {
  const uniq = [...new Set(approvals.map(a => a.spender).filter(Boolean))];
  const tinfo = tokenInfo || await fetchTokens(bs, chainId, approvals.map(a => a.token));
  const info = {}, failed = new Set();
  await Promise.all(uniq.map(async s => { info[s] = await bs.get(chainId, `/addresses/${s}`).catch(() => { failed.add(s); return null; }); }));
  for (const a of approvals) {
    const i = info[a.spender]; const ti = tinfo[lc(a.token)];
    if (ti?.symbol) a.tokenName = ti.symbol; a.tokenType = ti?.type || a.tokenType || null;
    a.spenderName = i?.name || i?.metadata?.tags?.[0]?.name || null;
    a.spenderVerified = failed.has(a.spender) ? null : !!i?.is_verified; a.spenderIsContract = !!i?.is_contract;
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
  const tokenInfo = await fetchTokens(bs, chainId, approvalTokens(addr, txs));
  const tokenTypes = Object.fromEntries(Object.entries(tokenInfo).map(([k, v]) => [k, v?.type || null]));
  const approvals = await enrichSpenders(bs, chainId, extractApprovals(addr, txs, tokenTypes), tokenInfo);
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
      const what = a.scope === "all" ? `Approval for ALL ${a.tokenName} NFTs` : a.scope === "single" ? `Approval of ${a.tokenName} NFT #${a.tokenId}` : `Unlimited approval on ${a.tokenName}`;
      if (a.spenderScam) { s -= 30; findings.push({ sev: "high", chain: n, text: `Approval to flagged address ${a.spender} on ${a.tokenName}`, tx: a.tx }); }
      else if (!a.unlimited) continue; // limited ERC-20 allowances and single-NFT approvals are not scored
      else if (a.spenderVerified === false) { s -= 15; findings.push({ sev: "high", chain: n, text: `${what} to unverified ${a.spender}`, tx: a.tx }); }
      else if (a.spenderVerified == null) { s -= 4; findings.push({ sev: "medium", chain: n, text: `${what} to ${a.spenderName || a.spender} (spender could not be checked)`, tx: a.tx }); }
      else { s -= 4; findings.push({ sev: "medium", chain: n, text: `${what} to ${a.spenderName || a.spender}`, tx: a.tx }); }
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
