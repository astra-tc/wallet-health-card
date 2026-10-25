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
export const DEFAULT_PAGES = 2, MAX_PAGES = 25; // pages of 50 per list (transactions, token transfers) per chain
export const clampPages = p => { const n = Math.floor(Number(p ?? DEFAULT_PAGES)); return Number.isFinite(n) ? Math.min(MAX_PAGES, Math.max(1, n)) : DEFAULT_PAGES; };
// Up-front estimate per chain: /addresses, /counters, /token-balances + 2 paginated lists. Spender and token
// lookups come on top (~1 per approval), so show this as "~N calls + ~1 per approval".
export const estimateCalls = (chains, pages = DEFAULT_PAGES) => chains * (3 + 2 * pages);

const now = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now());
// "/addresses/0xAbc…/token-balances" -> "/addresses/{address}/token-balances" (and /tokens/{token}), so the
// evidence panel groups calls by endpoint without listing every spender address.
export const endpointTemplate = path => String(path).replace(/^\/tokens\/0x[0-9a-fA-F]{40}/, "/tokens/{token}").replace(/0x[0-9a-fA-F]{40}/g, "{address}");

export class Blockscout {
  constructor({ apiKey, fetchImpl = (...a) => globalThis.fetch(...a), base = "https://api.blockscout.com", timeoutMs = 20000, maxConcurrent = 3 }) {
    this.maxConcurrent = maxConcurrent; this.active = 0; this.queue = [];
    this.apiKey = apiKey; this.fetch = fetchImpl; this.base = base; this.calls = 0; this.credits = null; this.creditsStart = null; this.creditsFirst = null; this.timeoutMs = timeoutMs;
    this.log = []; // one entry per HTTP request: { chainId, endpoint (address-templated), status, ms } for the evidence panel
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
      let r; const t0 = now(); const entry = { chainId: Number(chainId), endpoint: endpointTemplate(path), status: null, ms: 0 }; this.log.push(entry);
      try {
        const sig = typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(this.timeoutMs) : undefined;
        r = await this.fetch(u.toString(), { headers: { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json" }, signal: sig });
      } catch (e) { const to = e?.name === "TimeoutError" || e?.name === "AbortError"; last = new Error(to ? `Blockscout timeout on ${path}` : `Network error on ${path}: ${e?.message || e}`); last.status = to ? "timeout" : "network"; entry.status = last.status; entry.ms = Math.round(now() - t0); break; }
      entry.status = r.status; entry.ms = Math.round(now() - t0);
      const c = r.headers?.get?.("x-credits-remaining"); if (c) { this.credits = Number(c); if (this.creditsFirst == null) this.creditsFirst = this.credits; this.creditsStart = Math.max(this.creditsStart ?? -Infinity, this.credits); }
      if (r.status === 429) { const reset = Number(r.headers?.get?.("x-ratelimit-reset")); await new Promise(s => setTimeout(s, Math.min(5000, reset > 0 ? reset + 100 : 1000 * (attempt + 1)))); last = null; continue; }
      if (r.status === 404) return null;
      if (r.status === 402) { const e = new Error("This chain needs a paid Blockscout plan (Builder/Business/Pro)"); e.status = 402; throw e; }
      if (r.status === 401 || r.status === 403) { const e = new Error("Blockscout API key rejected"); e.status = r.status; throw e; }
      if (!r.ok) { last = new Error(`Blockscout ${r.status} on ${path}`); last.status = r.status; break; }
      return r.json();
    }
    throw last || new Error(`Blockscout rate-limited on ${path}`);
  }
  // Follows next_page_params for up to maxPages pages. truncated = the API still had a next page when we stopped.
  async pages(chainId, path, params = {}, maxPages = DEFAULT_PAGES) {
    const items = []; let next = {}, pagesFetched = 0;
    for (let i = 0; i < maxPages && next; i++) {
      const j = await this.get(chainId, path, { ...params, ...next });
      if (!j) { next = null; break; }
      pagesFetched++; items.push(...(j.items || [])); next = j.next_page_params || null;
    }
    return { items, truncated: next != null, pagesFetched };
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
      map.set(`${token}|${spender}`, { ...base, nft: false, scope: "amount", spender, unlimited, allowanceRaw: /^\d+$/.test(raw) ? raw : null, revoked: raw === "0" });
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

// Approval value-at-risk: what a spender could pull from this wallet right now, per ERC-20 approval:
// min(approved amount, current balance) x exchange_rate (from /addresses/{a}/token-balances).
// The approved amount is the one set by the latest approve call (an upper bound: allowance already spent via
// transferFrom is not subtracted). Thin/suspicious prices are not trusted (usdAtRisk null, units still shown).
export function approvalValueAtRisk(approvals, balances) {
  const bal = new Map();
  for (const b of balances) { const a = lc(b.token?.address_hash || b.token?.address); if (a) bal.set(a, b); }
  let usd = 0, priced = 0, unpriced = 0;
  for (const a of approvals) {
    a.usdAtRisk = null; a.amountAtRisk = null;
    if (a.nft) continue; // NFT approvals have no fungible balance/price to value
    const b = bal.get(lc(a.token)); const held = /^\d+$/.test(String(b?.value ?? "")) ? BigInt(b.value) : 0n;
    const allowed = a.unlimited ? held : (a.allowanceRaw != null ? BigInt(a.allowanceRaw) : held);
    const raw = allowed < held ? allowed : held; const dec = Number(b?.token?.decimals || 18);
    a.amountAtRisk = Number(raw) / 10 ** dec;
    if (raw === 0n) { a.usdAtRisk = 0; priced++; continue; }
    const t = b?.token || {}; const rate = Number(t.exchange_rate); const holders = Number(t.holders_count || t.holders || 0); const mcap = Number(t.circulating_market_cap || 0);
    const v = a.amountAtRisk * rate;
    if (!(rate > 0) || holders < 500 || (mcap > 0 && v > mcap)) { unpriced++; continue; } // same price sanity as token totals
    a.usdAtRisk = v; usd += v; priced++;
  }
  return { usd, pricedApprovals: priced, unpricedApprovals: unpriced };
}

export async function scanChain(bs, chainId, addr, { pages = DEFAULT_PAGES } = {}) {
  const info = await bs.get(chainId, `/addresses/${addr}`);
  if (!info) return { chainId, active: false };
  const warnings = [];
  const soft = (label, dflt) => e => { warnings.push(`${label}: ${e.message}`); return dflt; };
  const empty = { items: [], truncated: false, pagesFetched: 0 };
  const [balances, trPage, txPage, counters] = await Promise.all([
    bs.get(chainId, `/addresses/${addr}/token-balances`).catch(soft("token balances", [])),
    bs.pages(chainId, `/addresses/${addr}/token-transfers`, { type: "ERC-20" }, pages).catch(soft("token transfers", empty)),
    bs.pages(chainId, `/addresses/${addr}/transactions`, {}, pages).catch(soft("transactions", empty)),
    bs.get(chainId, `/addresses/${addr}/counters`).catch(soft("counters", null)),
  ]);
  const transfers = trPage.items, txs = txPage.items;
  const scan = { pages, txsScanned: txs.length, transfersScanned: transfers.length, txTruncated: txPage.truncated, transferTruncated: trPage.truncated,
    oldestTxAt: txs.length ? txs[txs.length - 1].timestamp || null : null };
  const active = (counters && Number(counters.transactions_count) > 0) || txs.length > 0 || transfers.length > 0 || Number(info.coin_balance) > 0;
  if (!active) return { chainId, active: false };
  const tokenInfo = await fetchTokens(bs, chainId, approvalTokens(addr, txs));
  const tokenTypes = Object.fromEntries(Object.entries(tokenInfo).map(([k, v]) => [k, v?.type || null]));
  const approvals = await enrichSpenders(bs, chainId, extractApprovals(addr, txs, tokenTypes), tokenInfo);
  const poisoning = detectPoisoning(addr, transfers, txs);
  const balanceList = Array.isArray(balances) ? balances : balances?.items || [];
  const valueAtRisk = approvalValueAtRisk(approvals, balanceList);
  for (const a of approvals) a.revoke = revokeHelp(addr, chainId, a);
  const tokens = balanceList.filter(b => b.token?.type === "ERC-20" || !b.token?.type).map(b => ({ symbol: b.token?.symbol, name: b.token?.name, address: b.token?.address_hash || b.token?.address,
    value: Number(b.value) / 10 ** Number(b.token?.decimals || 18), usd: b.token?.exchange_rate ? Number(b.value) / 10 ** Number(b.token.decimals || 18) * Number(b.token.exchange_rate) : null,
    reputation: b.token?.reputation || null, holders: Number(b.token?.holders_count || 0),
    mcap: Number(b.token?.circulating_market_cap || 0) }));
  // Price sanity: ignore USD for thin/unpriced tokens (fake exchange rates inflate totals).
  for (const t of tokens) if (t.usd != null && (t.holders < 500 || (t.mcap > 0 && t.usd > t.mcap))) { t.usdIgnored = t.usd; t.usd = null; }
  const spamTokens = tokens.filter(t => t.reputation === "scam" || (t.usd === null && /claim|visit|\.com|\.xyz|reward|airdrop/i.test(`${t.name} ${t.symbol}`)));
  return { chainId, active: true, warnings, ens: info.ens_domain_name || null, delegatedTo: info.implementations?.[0]?.name || null, isContract: info.is_contract, nativeBalance: Number(info.coin_balance || 0) / 1e18,
    nativeUsd: info.exchange_rate ? Number(info.coin_balance || 0) / 1e18 * Number(info.exchange_rate) : null,
    tokenTransferCount: Number(counters?.token_transfers_count || 0), txCount: Number(counters?.transactions_count || txs.length), tokens, spamTokens, approvals, poisoning,
    valueAtRisk, scan, lastActive: txs[0]?.timestamp || null };
}

// Blockscout Explorer deep links (each finding gets the tx and the spender / contract page).
export const explorerBase = chainId => CHAINS[chainId]?.explorer || "https://eth.blockscout.com";
export const explorerTx = (chainId, h) => h ? `${explorerBase(chainId)}/tx/${h}` : null;
export const explorerAddress = (chainId, a, contract = false) => a ? `${explorerBase(chainId)}/address/${a}${contract ? "?tab=contract" : ""}` : null;
export const revokeCashUrl = (addr, chainId) => `https://revoke.cash/address/${addr}?chainId=${chainId}`;

// Revoke helper: the exact call that removes an approval, for the wallet owner to send from their own wallet
// (or via revoke.cash). We only describe it; this app never builds, asks for or signs a transaction.
export function revokeHelp(addr, chainId, a) {
  const tok = `${a.tokenName || short(a.token)} (${a.token})`;
  const call = a.scope === "all" ? `setApprovalForAll(${a.spender}, false)` : a.scope === "single" ? `approve(${ZERO}, ${a.tokenId})` : `approve(${a.spender}, 0)`;
  return { call, contract: a.token, text: `Call ${call} on ${tok}`, url: revokeCashUrl(addr, chainId), tokenUrl: explorerAddress(chainId, a.token, true) };
}

// "Powered by Blockscout" evidence: which PRO API endpoints were called, how often, credits before/after
// (x-credits-remaining, when the API sends it) and latency per chain.
export function evidence(bs, chainIds, wallMs = {}) {
  const byEp = new Map();
  for (const e of bs.log) { const k = e.endpoint; const x = byEp.get(k) || { endpoint: `GET /api/v2${k}`, calls: 0, chains: new Set(), errors: 0 };
    x.calls++; x.chains.add(e.chainId); if (!(e.status >= 200 && e.status < 300) && e.status !== 404) x.errors++; byEp.set(k, x); }
  const endpoints = [...byEp.values()].map(x => ({ ...x, chains: [...x.chains].sort((a, b) => a - b) })).sort((a, b) => b.calls - a.calls || a.endpoint.localeCompare(b.endpoint));
  const perChain = chainIds.map(id => { const l = bs.log.filter(e => e.chainId === Number(id)); const ms = l.map(e => e.ms);
    return { chainId: Number(id), chain: CHAINS[id]?.name || String(id), calls: l.length, avgMs: ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : null,
      maxMs: ms.length ? Math.max(...ms) : null, wallMs: wallMs[id] ?? null }; });
  const before = bs.creditsStart != null ? bs.creditsStart : null, after = bs.credits;
  return { api: `${bs.base}/{chain_id}/api/v2`, totalCalls: bs.calls, endpoints, perChain,
    credits: { before, after, used: before != null && after != null ? before - after : null, header: "x-credits-remaining", reported: before != null } };
}

// Plain-text evidence panel (CLI and tests).
export function formatEvidence(ev) {
  if (!ev) return [];
  const c = ev.credits, out = ["", `Powered by Blockscout PRO API (${ev.api})`, `  ${ev.totalCalls} API calls · credits (${c.header}): ` +
    (c.reported ? `${c.before} before → ${c.after} after = ${c.used} used` : "not reported by the API for this key")];
  out.push("  Endpoints called:");
  for (const e of ev.endpoints) out.push(`    ${String(e.calls).padStart(4)} × ${e.endpoint}${e.errors ? ` (${e.errors} errors)` : ""}`);
  out.push("  Per-chain latency:");
  for (const p of ev.perChain) out.push(`    ${p.chain.padEnd(13)} ${String(p.calls).padStart(4)} calls · avg ${p.avgMs ?? "-"} ms · max ${p.maxMs ?? "-"} ms · scan ${p.wallMs ?? "-"} ms`);
  return out;
}

export const SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const fmtUsd = v => "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const riskText = a => a.nft || a.amountAtRisk == null ? "" : a.usdAtRisk != null ? ` (${fmtUsd(a.usdAtRisk)} at risk)` :
  ` (${+a.amountAtRisk.toPrecision(6)} ${a.tokenName} at risk, no reliable USD price)`;

export function score(chains) {
  let s = 100; const findings = [];
  for (const c of chains.filter(c => c.active)) {
    const n = CHAINS[c.chainId]?.name || c.chainId;
    for (const a of c.approvals) {
      const what = a.scope === "all" ? `Approval for ALL ${a.tokenName} NFTs` : a.scope === "single" ? `Approval of ${a.tokenName} NFT #${a.tokenId}` : `Unlimited approval on ${a.tokenName}`;
      const atRisk = a.usdAtRisk > 0, risk = riskText(a);
      const f = (sev, text) => findings.push({ sev, chain: n, chainId: c.chainId, text: text + risk, tx: a.tx, spender: a.spender, usdAtRisk: a.usdAtRisk ?? null,
        links: { tx: explorerTx(c.chainId, a.tx), contract: explorerAddress(c.chainId, a.spender, a.spenderIsContract !== false) }, revoke: a.revoke || null });
      if (a.spenderScam) { s -= 30; f(atRisk ? "critical" : "high", `Approval to flagged address ${a.spender} on ${a.tokenName}`); }
      else if (!a.unlimited) continue; // limited ERC-20 allowances and single-NFT approvals are not scored
      // Unlimited approval to an unverified spender while the wallet still holds a priced balance of that token = critical.
      else if (a.spenderVerified === false) { s -= atRisk ? 30 : 15; f(atRisk ? "critical" : "high", `${what} to unverified ${a.spender}`); }
      else if (a.spenderVerified == null) { s -= 4; f("medium", `${what} to ${a.spenderName || a.spender} (spender could not be checked)`); }
      else { s -= 4; f("medium", `${what} to ${a.spenderName || a.spender}`); }
    }
    for (const p of c.poisoning) {
      const links = { tx: explorerTx(c.chainId, p.tx), contract: explorerAddress(c.chainId, p.fake) }; // look-alikes are usually EOAs: plain address page
      if (p.sentToFake) { s -= 30; findings.push({ sev: "high", chain: n, chainId: c.chainId, text: `Funds sent to look-alike ${p.fake} (mimics ${p.mimics})`, tx: p.tx, address: p.fake, links }); }
      else { s -= 5; findings.push({ sev: "medium", chain: n, chainId: c.chainId, text: `Address-poisoning attempt: ${p.fake} mimics your contact ${p.mimics}${p.zeroValue ? " (zero-value transfer)" : ""}`, tx: p.tx, address: p.fake, links }); }
    }
    if (c.spamTokens.length) { s -= Math.min(10, c.spamTokens.length * 2); findings.push({ sev: "low", chain: n, chainId: c.chainId, text: `${c.spamTokens.length} spam/airdrop-bait token(s) held: never interact with their sites`,
      links: { tx: null, contract: c.spamTokens[0]?.address ? explorerAddress(c.chainId, c.spamTokens[0].address, true) : null } }); }
  }
  for (const c of chains.filter(c => c.needsPaidPlan)) findings.push({ sev: "info", chain: CHAINS[c.chainId]?.name || c.chainId, text: "Skipped: this chain needs a paid Blockscout PRO plan" });
  for (const c of chains.filter(c => c.active && c.scan)) {
    const sc = c.scan, n = CHAINS[c.chainId]?.name || c.chainId;
    if (sc.txTruncated || sc.transferTruncated) findings.push({ sev: "info", chain: n, truncated: true,
      text: `Scanned the ${sc.txsScanned} most recent txs and ${sc.transfersScanned} token transfers; older approvals and transfers not checked. ` +
        (sc.pages >= MAX_PAGES ? `This is the ${MAX_PAGES}-page ceiling` : `Run deep scan (--pages ${sc.pages < 10 ? 10 : MAX_PAGES})`) });
    else if (sc.pages > DEFAULT_PAGES) findings.push({ sev: "info", chain: n, text: `Full history scanned (${sc.txsScanned} txs, ${sc.transfersScanned} token transfers)` });
  }
  for (const c of chains.filter(c => c.active && c.warnings?.length)) findings.push({ sev: "info", chain: CHAINS[c.chainId]?.name || c.chainId, text: `Partial data (${c.warnings.join("; ")})` });
  s = Math.max(0, Math.min(100, s));
  // Worst first; within a severity, the most USD at risk first (stable, so equal items keep scan order).
  findings.sort((a, b) => SEV_RANK[a.sev] - SEV_RANK[b.sev] || (b.usdAtRisk || 0) - (a.usdAtRisk || 0));
  return { score: s, grade: s >= 85 ? "A" : s >= 70 ? "B" : s >= 50 ? "C" : s >= 30 ? "D" : "F", findings };
}

export async function healthCard(apiKey, addr, chainIds = FREE_CHAINS, opts = {}) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) throw new Error("Enter a valid 0x address");
  const { pages: rawPages, ...bsOpts } = opts; const pages = clampPages(rawPages);
  const bs = new Blockscout({ apiKey, ...bsOpts });
  const wallMs = {};
  const chains = await Promise.all(chainIds.map(async id => { const t0 = now();
    try { return await scanChain(bs, id, addr, { pages }); } catch (e) { return { chainId: id, active: false, error: e.message, needsPaidPlan: e.status === 402 }; }
    finally { wallMs[id] = Math.round(now() - t0); } }));
  if (chains.length && chains.every(c => c.error && /key rejected/.test(c.error))) throw new Error("Blockscout API key rejected");
  if (chains.length && chains.every(c => c.error)) throw new Error(`Could not reach Blockscout on any chain: ${chains[0].error}`);
  const act = chains.filter(c => c.active);
  const valueAtRisk = { usd: act.reduce((t, c) => t + (c.valueAtRisk?.usd || 0), 0),
    byChain: Object.fromEntries(act.map(c => [CHAINS[c.chainId]?.name || c.chainId, c.valueAtRisk?.usd || 0])) };
  const scanDepth = { pages, tier: pages > DEFAULT_PAGES ? "deep" : "standard", estimatedCalls: estimateCalls(chainIds.length, pages),
    truncatedChains: act.filter(c => c.scan?.txTruncated || c.scan?.transferTruncated).map(c => CHAINS[c.chainId]?.name || c.chainId) };
  return { address: addr, generatedAt: new Date().toISOString(), chains, ...score(chains), valueAtRisk, scanDepth, apiCalls: bs.calls,
    creditsRemaining: bs.credits, creditsUsed: bs.creditsStart != null && bs.credits != null ? bs.creditsStart - bs.credits : null, evidence: evidence(bs, chainIds, wallMs) };
}

// Content for the shareable PNG card (drawn client-side on a canvas; nothing is uploaded).
export function cardSummary(r) {
  // Worst first (older recorded scans were not sorted). Addresses keep 8 leading hex chars so a look-alike and
  // the contact it mimics (same first 4 + last 4) stay visibly different on the card.
  const top = (r.findings || []).filter(f => f.sev !== "info").map((f, i) => [f, i])
    .sort(([a, i], [b, j]) => (SEV_RANK[a.sev] ?? 9) - (SEV_RANK[b.sev] ?? 9) || (b.usdAtRisk || 0) - (a.usdAtRisk || 0) || i - j).slice(0, 3)
    .map(([f]) => ({ sev: f.sev, chain: f.chain, text: f.text.replace(/0x[0-9a-fA-F]{40}/g, a => `${a.slice(0, 10)}…${a.slice(-4)}`) }));
  const active = (r.chains || []).filter(c => c.active).map(c => CHAINS[c.chainId]?.name || c.chainId);
  return { grade: r.grade, score: r.score, address: short(r.address), chains: active, valueAtRiskUsd: r.valueAtRisk?.usd ?? null, top,
    more: Math.max(0, (r.findings || []).filter(f => f.sev !== "info").length - top.length), apiCalls: r.apiCalls, date: String(r.generatedAt || "").slice(0, 10) };
}
