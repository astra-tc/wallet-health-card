import { healthCard, CHAINS, FREE_CHAINS, ALL_CHAINS } from "./core.js";
const $ = id => document.getElementById(id);
$("key").value = localStorage.getItem("bs_key") || "";
const q = new URLSearchParams(location.search); if (q.get("address")) $("addr").value = q.get("address");
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ex = (cid, kind, h) => `${CHAINS[Object.keys(CHAINS).find(k => CHAINS[k].name === cid) || cid]?.explorer || "https://eth.blockscout.com"}/${kind}/${h}`;
function render(r) {
  const active = r.chains.filter(c => c.active);
  const findingsReal = r.findings.filter(f => f.sev !== "info");
  const usd = active.reduce((s, c) => s + (c.nativeUsd || 0) + c.tokens.reduce((t, x) => t + (x.usd || 0), 0), 0);
  let h = `<div class="card"><span class="grade ${r.grade}">${r.grade}</span> <b>${r.score}/100</b>
  <div class="muted">${r.sample ? "Recorded real scan from " + esc(r.generatedAt) + " · " : ""}${esc(r.address)} · active on ${active.length} chain(s) · ~$${usd.toFixed(2)} visible value · ${r.apiCalls} Blockscout API calls${r.creditsRemaining != null ? ` · ${r.creditsRemaining} credits left` : ""}</div></div>`;
  h += `<div class="card"><h3>Findings (${findingsReal.length})</h3>${r.findings.length ? "<table>" + r.findings.map(f => `<tr><td class="${f.sev}">${f.sev.toUpperCase()}</td><td>${esc(f.chain)}</td><td>${esc(f.text)}</td><td>${f.tx ? `<a target="_blank" href="${ex(f.chain, "tx", f.tx)}">view tx</a>` : ""}</td></tr>`).join("") + "</table>" : "No issues found 🎉"}</div>`;
  for (const c of active) {
    const ch = CHAINS[c.chainId];
    h += `<div class="card"><h3>${ch.name} <small><a target="_blank" href="${ch.explorer}/address/${esc(r.address)}">open in Blockscout Explorer</a></small></h3>
    <div class="muted">${c.ens ? esc(c.ens) + " · " : ""}${c.delegatedTo ? "EIP-7702 → " + esc(c.delegatedTo) + " · " : ""}${c.txCount} txs · native ${c.nativeBalance.toFixed(5)} · last active ${esc(c.lastActive || "n/a")}</div>
    <h4>Open approvals (${c.approvals.length})</h4><table>${c.approvals.map(a => `<tr><td>${esc(a.tokenName)}</td><td><a target="_blank" href="${ch.explorer}/address/${a.spender}">${esc(a.spenderName || a.spender)}</a> ${a.spenderVerified ? "✅ verified" : a.spenderVerified === null ? "❔ not checked" : "⚠️ unverified"}</td><td>${a.scope === "all" ? "ALL NFTs" : a.scope === "single" ? `1 NFT (#${esc(a.tokenId)})` : a.unlimited ? "UNLIMITED" : "limited"}</td><td><a target="_blank" href="https://revoke.cash/address/${esc(r.address)}?chainId=${c.chainId}">revoke</a></td></tr>`).join("")}</table>
    <h4>Tokens (${c.tokens.length})</h4><table>${c.tokens.slice(0, 15).map(t => `<tr><td>${esc(t.symbol)}</td><td>${t.value.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td><td>${t.usd != null ? "$" + t.usd.toFixed(2) : "—"}</td><td>${c.spamTokens.includes(t) ? "🚫 spam" : ""}</td></tr>`).join("")}</table></div>`;
  }
  $("out").innerHTML = h;
}
$("go").onclick = async () => {
  const key = $("key").value.trim(); localStorage.setItem("bs_key", key);
  if (!key) { $("out").innerHTML = `<div class="card">Add a Blockscout PRO API key first (free at dev.blockscout.com), or press Sample.</div>`; return; }
  $("out").innerHTML = `<div class="card">Scanning chains via Blockscout PRO API…</div>`;
  history.replaceState(null, "", `?address=${$("addr").value.trim()}`);
  try { render(await healthCard(key, $("addr").value.trim(), $("paid").checked ? ALL_CHAINS : FREE_CHAINS, { base: "https://wallet-health-proxy.astratc.workers.dev" })); } catch (e) { $("out").innerHTML = `<div class="card high">${esc(e.message)}</div>`; }
};
$("demo").onclick = async () => render(await (await fetch("sample.json")).json());
