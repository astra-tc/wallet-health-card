// CORS proxy for the Blockscout PRO API (api.blockscout.com sends no Access-Control-Allow-Origin).
// Forwards only GET /{chain_id}/api/v2/... with the caller's own key. Stores and logs nothing.
const ALLOWED = ["https://astratc.github.io", "https://astra-tc.github.io", "http://localhost:8080", "http://127.0.0.1:8080"];
export default {
  async fetch(req) {
    const origin = req.headers.get("Origin") || "";
    const cors = { "Access-Control-Allow-Origin": ALLOWED.includes(origin) ? origin : ALLOWED[0], "Access-Control-Allow-Headers": "Authorization,Accept",
      "Access-Control-Allow-Methods": "GET,OPTIONS", "Access-Control-Expose-Headers": "x-credits-remaining,x-ratelimit-reset,x-ratelimit-remaining", "Vary": "Origin" };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const u = new URL(req.url);
    if (req.method !== "GET" || !/^\/\d+\/api\/v2\/[\w\/\-\.]+$/.test(u.pathname)) return new Response("Not found", { status: 404, headers: cors });
    const auth = req.headers.get("Authorization");
    if (!auth) return new Response(JSON.stringify({ error: "Bring your own Blockscout PRO API key" }), { status: 401, headers: cors });
    const r = await fetch("https://api.blockscout.com" + u.pathname + u.search, { headers: { Authorization: auth, Accept: "application/json" } });
    const h = new Headers(cors); h.set("Content-Type", r.headers.get("Content-Type") || "application/json");
    for (const k of ["x-credits-remaining", "x-ratelimit-reset", "x-ratelimit-remaining"]) if (r.headers.get(k)) h.set(k, r.headers.get(k));
    return new Response(r.body, { status: r.status, headers: h });
  },
};
