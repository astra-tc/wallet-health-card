import { healthCard, CHAINS, FREE_CHAINS, ALL_CHAINS, estimateCalls, cardSummary, explorerAddress, revokeHelp, SEV_RANK } from "./core.js";
const $ = id => document.getElementById(id);
$("key").value = localStorage.getItem("bs_key") || "";
const q = new URLSearchParams(location.search); if (q.get("address")) $("addr").value = q.get("address");
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const chainIdOf = name => Number(Object.keys(CHAINS).find(k => CHAINS[k].name === name || k === String(name)) || 1);
const ex = (cid, kind, h) => `${CHAINS[chainIdOf(cid)]?.explorer || "https://eth.blockscout.com"}/${kind}/${h}`;
const money = v => "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const showEstimate = () => { const n = ($("paid").checked ? ALL_CHAINS : FREE_CHAINS).length, p = Number($("pages").value);
  $("est").textContent = `~${estimateCalls(n, p)} API calls + ~1 per approval · ${p * 50} txs/chain`; };
$("pages").onchange = $("paid").onchange = showEstimate; showEstimate();
let last = null;
// Two Explorer links per finding: the transaction, and the spender / contract (or look-alike address) page.
function findingLinks(f) {
  const tx = f.links?.tx || (f.tx ? ex(f.chain, "tx", f.tx) : null);
  const addrFromText = (f.text.match(/0x[0-9a-fA-F]{40}/) || [])[0];
  const contract = f.links?.contract || (f.spender || addrFromText ? explorerAddress(chainIdOf(f.chain), f.spender || addrFromText, !!f.spender || /approval/i.test(f.text)) : null);
  return [tx && `<a target="_blank" href="${esc(tx)}">tx ↗</a>`, contract && `<a target="_blank" href="${esc(contract)}">${/look-alike|poisoning/i.test(f.text) ? "address" : "contract"} ↗</a>`].filter(Boolean).join(" · ");
}
const revokeCell = (r, c, a) => { const h = a.revoke || revokeHelp(r.address, c.chainId, a);
  return `<code title="Exact call to remove this approval. Send it from your own wallet; this app never builds or signs transactions.">${esc(h.call)}</code> on <a target="_blank" href="${esc(h.tokenUrl)}">${esc(a.tokenName)}</a> · <a target="_blank" href="${esc(h.url)}">revoke.cash ↗</a>`; };
function evidenceCard(r) {
  const ev = r.evidence;
  if (!ev) return `<div class="card evidence"><h3>Powered by Blockscout PRO API</h3><div class="muted">${r.apiCalls} API calls. This recorded scan predates the per-endpoint log; run a live scan to see endpoints, credits and latency.</div></div>`;
  const c = ev.credits;
  return `<div class="card evidence"><h3>Powered by Blockscout PRO API <small><code>${esc(ev.api)}</code></small></h3>
  <div class="muted"><b>${ev.totalCalls}</b> API calls · credits (<code>${esc(c.header)}</code>): ${c.reported ? `<b>${c.before}</b> before → <b>${c.after}</b> after = <b>${c.used}</b> used` : "not reported for this key"}</div>
  <h4>Endpoints called</h4><table>${ev.endpoints.map(e => `<tr><td><code>${esc(e.endpoint)}</code></td><td>${e.calls}×</td><td class="muted">${e.chains.map(id => esc(CHAINS[id]?.name || id)).join(", ")}${e.errors ? ` · ${e.errors} errors` : ""}</td></tr>`).join("")}</table>
  <h4>Latency per chain</h4><table><tr><th>Chain</th><th>Calls</th><th>Avg</th><th>Max</th><th>Scan time</th></tr>${ev.perChain.map(p => `<tr><td>${esc(p.chain)}</td><td>${p.calls}</td><td>${p.avgMs ?? "–"} ms</td><td>${p.maxMs ?? "–"} ms</td><td>${p.wallMs ?? "–"} ms</td></tr>`).join("")}</table></div>`;
}
// Recorded scans made before Sprint 2 lack per-finding links/revoke data: rebuild them from the approvals list.
function upgrade(r) {
  const byTx = new Map(); for (const c of r.chains.filter(c => c.active)) for (const a of c.approvals || []) byTx.set(a.tx, { a, chainId: c.chainId });
  for (const f of r.findings) { const m = byTx.get(f.tx); if (!m || f.links) continue;
    f.spender = f.spender || m.a.spender; f.revoke = f.revoke || revokeHelp(r.address, m.chainId, m.a);
    f.links = { tx: ex(f.chain, "tx", f.tx), contract: explorerAddress(m.chainId, m.a.spender, m.a.spenderIsContract !== false) }; }
  r.findings = r.findings.map((f, i) => [f, i]).sort(([a, i], [b, j]) => (SEV_RANK[a.sev] ?? 9) - (SEV_RANK[b.sev] ?? 9) || (b.usdAtRisk || 0) - (a.usdAtRisk || 0) || i - j).map(([f]) => f);
  return r;
}
function render(r) {
  last = upgrade(r);
  const active = r.chains.filter(c => c.active);
  const findingsReal = r.findings.filter(f => f.sev !== "info");
  const usd = active.reduce((s, c) => s + (c.nativeUsd || 0) + c.tokens.reduce((t, x) => t + (x.usd || 0), 0), 0);
  let h = `<div class="card"><span class="grade ${r.grade}">${r.grade}</span> <b>${r.score}/100</b> <button id="png" title="Render a shareable PNG of this card (made in your browser, nothing is uploaded)">Download PNG card</button>
  <div class="muted">${r.sample ? "Recorded real scan from " + esc(r.generatedAt) + " · " : ""}${esc(r.address)} · active on ${active.length} chain(s) · ~$${usd.toFixed(2)} visible value · ${r.apiCalls} Blockscout API calls${r.creditsRemaining != null ? ` · ${r.creditsRemaining} credits left` : ""}${r.creditsUsed != null ? ` (${r.creditsUsed} used)` : ""}${r.scanDepth ? ` · ${esc(r.scanDepth.tier)} scan, ${r.scanDepth.pages} pages/chain` : ""}</div>
  ${r.valueAtRisk ? `<div class="var"><b class="${r.valueAtRisk.usd > 0 ? "high" : ""}">${money(r.valueAtRisk.usd)}</b> at risk in open approvals <small>(min(allowance, balance) × price${Object.keys(r.valueAtRisk.byChain).length > 1 ? " · " + Object.entries(r.valueAtRisk.byChain).map(([k, v]) => `${esc(k)} ${money(v)}`).join(" · ") : ""})</small></div>` : ""}</div>`;
  h += `<div class="card"><h3>Findings (${findingsReal.length})</h3>${r.findings.length ? "<table>" + r.findings.map(f => `<tr><td class="${f.sev}">${f.sev.toUpperCase()}</td><td>${esc(f.chain)}</td><td>${esc(f.text)}${f.revoke ? `<div class="fix">Fix: <code>${esc(f.revoke.call)}</code> on the token contract, from your own wallet, or <a target="_blank" href="${esc(f.revoke.url)}">revoke.cash ↗</a></div>` : ""}</td><td>${f.usdAtRisk > 0 ? money(f.usdAtRisk) : ""}</td><td class="links">${findingLinks(f)}</td></tr>`).join("") + "</table>" : "No issues found 🎉"}</div>`;
  for (const c of active) {
    const ch = CHAINS[c.chainId];
    h += `<div class="card"><h3>${ch.name} <small><a target="_blank" href="${ch.explorer}/address/${esc(r.address)}">open in Blockscout Explorer</a></small>${c.valueAtRisk ? ` <span class="badge">${money(c.valueAtRisk.usd)} at risk</span>` : ""}${c.scan?.txTruncated || c.scan?.transferTruncated ? ` <span class="badge trunc" title="Older activity was not scanned. Pick Deep or Full scan depth.">truncated: latest ${c.scan.txsScanned} txs</span>` : c.scan && c.scan.pages > 2 ? ` <span class="badge">full history</span>` : ""}</h3>
    <div class="muted">${c.ens ? esc(c.ens) + " · " : ""}${c.delegatedTo ? "EIP-7702 → " + esc(c.delegatedTo) + " · " : ""}${c.txCount} txs · native ${c.nativeBalance.toFixed(5)} · last active ${esc(c.lastActive || "n/a")}</div>
    <h4>Open approvals (${c.approvals.length})</h4><table>${c.approvals.map(a => `<tr><td>${esc(a.tokenName)}</td><td><a target="_blank" href="${ch.explorer}/address/${a.spender}?tab=contract">${esc(a.spenderName || a.spender)}</a> ${a.spenderVerified ? "✅ verified" : a.spenderVerified === null ? "❔ not checked" : "⚠️ unverified"}</td><td>${a.scope === "all" ? "ALL NFTs" : a.scope === "single" ? `1 NFT (#${esc(a.tokenId)})` : a.unlimited ? "UNLIMITED" : "limited"}</td><td>${a.usdAtRisk != null ? money(a.usdAtRisk) + " at risk" : a.amountAtRisk ? `${+a.amountAtRisk.toPrecision(6)} ${esc(a.tokenName)} (unpriced)` : ""}</td><td class="revoke">${revokeCell(r, c, a)}</td></tr>`).join("")}</table>
    ${c.approvals.length ? `<div class="muted small">To revoke, send the call shown from your own wallet (amount 0 / approved false), or use revoke.cash. Wallet Health Card is read-only: it never builds, requests or signs a transaction.</div>` : ""}
    <h4>Tokens (${c.tokens.length})</h4><table>${c.tokens.slice(0, 15).map(t => `<tr><td>${esc(t.symbol)}</td><td>${t.value.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td><td>${t.usd != null ? "$" + t.usd.toFixed(2) : "—"}</td><td>${c.spamTokens.includes(t) ? "🚫 spam" : ""}</td></tr>`).join("")}</table></div>`;
  }
  h += evidenceCard(r);
  $("out").innerHTML = h;
  $("png").onclick = () => downloadCard(r);
}
// Shareable PNG card: drawn on a canvas in the browser and saved locally. No upload, no server.
const SEV_COLOR = { critical: "#ff3b3b", high: "#f85149", medium: "#d29922", low: "#cfc6e8" };
export function drawCard(r, canvas = document.createElement("canvas")) {
  const s = cardSummary(r), W = 1200, H = 675; canvas.width = W; canvas.height = H; const g = canvas.getContext("2d");
  const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, "#1a1240"); bg.addColorStop(1, "#3a0f22"); g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.strokeStyle = "rgba(212,175,106,.6)"; g.lineWidth = 3; g.strokeRect(24, 24, W - 48, H - 48);
  g.fillStyle = "#d4af6a"; g.font = "bold 44px Cinzel, Georgia, serif"; g.fillText("Wallet Health Card", 64, 104);
  g.fillStyle = "#cfc6e8"; g.font = "26px system-ui, sans-serif"; g.fillText(`${s.address} · ${s.chains.join(", ") || "no activity"}`, 64, 148);
  g.fillStyle = { A: "#3fb950", B: "#3fb950", C: "#d29922" }[s.grade] || "#f85149"; g.font = "bold 200px system-ui, sans-serif"; g.fillText(s.grade, 64, 380);
  g.fillStyle = "#fff"; g.font = "bold 48px system-ui, sans-serif"; g.fillText(`${s.score}/100`, 64, 450);
  if (s.valueAtRiskUsd != null) { g.font = "28px system-ui, sans-serif"; g.fillStyle = s.valueAtRiskUsd > 0 ? "#f85149" : "#cfc6e8"; g.fillText(`${money(s.valueAtRiskUsd)} at risk in approvals`, 64, 500); }
  g.font = "bold 30px system-ui, sans-serif"; g.fillStyle = "#d4af6a"; g.fillText(s.top.length ? "Top findings" : "No issues found", 400, 205);
  const wrap = (text, x, y, max, lh, lines = 2) => { const w = text.split(" "); let line = "", n = 0;
    for (const word of w) { const t = line ? line + " " + word : word; if (g.measureText(t).width > max && line) { if (++n === lines) { g.fillText(line + " …", x, y); return y + lh; } g.fillText(line, x, y); y += lh; line = word; } else line = t; }
    g.fillText(line, x, y); return y + lh; };
  let y = 250;
  for (const f of s.top) { g.font = "bold 22px system-ui, sans-serif"; g.fillStyle = SEV_COLOR[f.sev] || "#fff"; g.fillText(`${f.sev.toUpperCase()} · ${f.chain}`, 400, y); y += 32;
    g.font = "24px system-ui, sans-serif"; g.fillStyle = "#fff"; y = wrap(f.text, 400, y, 740, 30) + 8; }
  if (s.more && y < H - 90) { g.font = "22px system-ui, sans-serif"; g.fillStyle = "#cfc6e8"; g.fillText(`+ ${s.more} more finding(s)`, 400, y); }
  g.font = "22px system-ui, sans-serif"; g.fillStyle = "#cfc6e8";
  g.fillText(`Powered by Blockscout PRO API · ${s.apiCalls} API calls · ${s.date} · Read-only, no signing`, 64, H - 64);
  return canvas;
}
function downloadCard(r) {
  drawCard(r).toBlob(b => { const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `wallet-health-${r.address.slice(2, 8)}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }, "image/png");
}
$("go").onclick = async () => {
  const key = $("key").value.trim(); localStorage.setItem("bs_key", key);
  if (!key) { $("out").innerHTML = `<div class="card">Add a Blockscout PRO API key first (free at dev.blockscout.com), or press Sample.</div>`; return; }
  $("out").innerHTML = `<div class="card">Scanning chains via Blockscout PRO API (${esc($("est").textContent)})…</div>`;
  history.replaceState(null, "", `?address=${$("addr").value.trim()}`);
  try { render(await healthCard(key, $("addr").value.trim(), $("paid").checked ? ALL_CHAINS : FREE_CHAINS, { base: "https://wallet-health-proxy.astratc.workers.dev", pages: Number($("pages").value) })); } catch (e) { $("out").innerHTML = `<div class="card high">${esc(e.message)}</div>`; }
};
$("demo").onclick = async () => render(await (await fetch("sample.json")).json());
window.__whc = { render, drawCard, get last() { return last; } };
