/** Tiny HTML view of what the mock Router holds, so a human can eyeball the feed. */
export function renderView(store: Map<string, any>): string {
  const rows = [...store.entries()].map(([k, v]) => {
    const [id, dt] = k.split("#");
    const d = v.data ?? {};
    const cell = dt === "socialSentiment"
      ? `Galaxy <b>${d.galaxyScore ?? "-"}</b> · AltRank ${d.altRank ?? "-"} · Sentiment <b>${d.sentiment}%</b> · ${Number(d.interactions24h).toLocaleString()} engagements · dominance ${d.socialDominance ?? "-"}%`
      : `<code>${escapeHtml(JSON.stringify(d))}</code>`;
    return `<tr><td>${escapeHtml(id)}</td><td>${dt}</td><td>${d.symbol ?? ""}</td><td>${cell}</td><td>${new Date(v.receivedAt).toLocaleTimeString()}</td></tr>`;
  }).join("");
  return `<!doctype html><meta charset="utf-8"><title>Mock Router: asset data</title>
<style>body{font:14px system-ui;margin:24px;background:#0f1412;color:#e6efe9}h1{font-weight:600}table{border-collapse:collapse;width:100%}td,th{padding:8px 10px;border-bottom:1px solid #243}th{text-align:left;color:#9fd}code{font-size:12px;color:#9fd}small{color:#8a9}</style>
<h1>Mock Ownera Router · ingested asset data</h1>
<small>${store.size} items. This is what a consumer Router would expose via GraphQL <code>assetDatas</code>. Refresh after running <code>npm run smoke</code>.</small>
<table><tr><th>Identifier (ISIN / CAIP-19)</th><th>dataType</th><th>Sym</th><th>Payload</th><th>Received</th></tr>${rows || "<tr><td colspan=5>Nothing ingested yet. Run <code>npm run smoke</code>.</td></tr>"}</table>`;
}
function escapeHtml(s: string) { return s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!)); }
