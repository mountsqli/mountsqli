// MountSQLI — Studio dashboard SPA (self-contained HTML/CSS/JS, no build step).
// Talks only to the studio JSON API (/api/*).

export function getDashboardHTML(ctx?: unknown): string {
  void ctx;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MountSQLI Studio</title>
<style>${CSS}</style>
</head>
<body>
<header id="topbar">
  <div class="brand"><span class="logo">◆</span> MountSQLI <span class="badge">Studio</span></div>
  <input id="search" placeholder="Search tables… (press /)" autocomplete="off">
  <div id="conn" class="pill"><span class="dot"></span><span id="conn-label">…</span></div>
</header>
<div id="layout">
  <nav id="sidebar">
    <div class="nav-group">Explorer</div>
    <a class="nav-link active" data-page="tables">▤ Tables</a>
    <a class="nav-link" data-page="query">⌨ SQL</a>
    <a class="nav-link" data-page="erd">◈ ERD</a>
    <a class="nav-link" data-page="migrations">⇡ Migrations</a>
    <a class="nav-link" data-page="cache">⚡ Cache</a>
    <div class="nav-group">Tables</div>
    <div id="table-list"></div>
  </nav>
  <main id="content"></main>
</div>
<div id="toast" class="toast"></div>
<script>${JS}</script>
</body>
</html>`;
}

const CSS = `
* { margin:0; padding:0; box-sizing:border-box; }
:root {
  --bg:#0a0b10; --bg1:#111219; --bg2:#181924; --bg3:#1f2133; --bg4:#272a3f;
  --border:rgba(255,255,255,.07); --text:#e8eaed; --muted:#9ba1b0; --dim:#5f6577;
  --accent:#6c8cff; --accent2:#a06cff; --ok:#3ddc97; --warn:#ffb454; --err:#ff6b6b; --pk:#ffd166;
}
html,body { height:100%; }
body { background:var(--bg); color:var(--text); font:14px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,Inter,sans-serif; }

#topbar { height:52px; display:flex; align-items:center; gap:16px; padding:0 18px; border-bottom:1px solid var(--border); background:var(--bg1); position:sticky; top:0; z-index:10; }
.brand { font-weight:600; letter-spacing:.2px; display:flex; align-items:center; gap:8px; }
.logo { color:var(--accent2); font-size:18px; }
.badge { font-size:10px; background:var(--bg3); color:var(--muted); padding:2px 7px; border-radius:20px; letter-spacing:.5px; }
#search { flex:1; max-width:420px; margin:0 auto; background:var(--bg2); border:1px solid var(--border); color:var(--text); padding:8px 12px; border-radius:8px; outline:none; }
#search:focus { border-color:var(--accent); }
.pill { display:flex; align-items:center; gap:7px; font-size:12px; color:var(--muted); background:var(--bg2); padding:5px 10px; border-radius:20px; }
.pill .dot { width:8px; height:8px; border-radius:50%; background:var(--ok); box-shadow:0 0 8px var(--ok); }

#layout { display:flex; height:calc(100% - 52px); }
#sidebar { width:230px; border-right:1px solid var(--border); background:var(--bg1); padding:14px 10px; overflow:auto; }
.nav-group { font-size:10px; text-transform:uppercase; letter-spacing:.8px; color:var(--dim); margin:14px 8px 6px; }
.nav-link { display:block; padding:7px 10px; border-radius:7px; color:var(--muted); cursor:pointer; text-decoration:none; }
.nav-link:hover { background:var(--bg2); color:var(--text); }
.nav-link.active { background:var(--bg3); color:var(--text); }
#table-list a { display:block; padding:5px 10px 5px 26px; color:var(--muted); cursor:pointer; border-radius:6px; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#table-list a:hover { background:var(--bg2); color:var(--text); }

#content { flex:1; overflow:auto; padding:20px 24px; }

.view { display:none; }
.view.active { display:block; }

/* tables grid */
.grid-wrap { border:1px solid var(--border); border-radius:10px; overflow:hidden; }
table.grid { width:100%; border-collapse:collapse; font-size:13px; }
table.grid th { background:var(--bg2); text-align:left; padding:9px 12px; position:sticky; top:0; border-bottom:1px solid var(--border); cursor:pointer; user-select:none; white-space:nowrap; }
table.grid th .pk { color:var(--pk); margin-left:5px; font-size:10px; }
table.grid td { padding:8px 12px; border-bottom:1px solid var(--border); border-right:1px solid var(--border); max-width:340px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
table.grid tr:hover td { background:var(--bg1); }
table.grid td.editable { cursor:text; }
.cell-input { width:100%; background:var(--bg3); border:1px solid var(--accent); color:var(--text); padding:6px 8px; border-radius:5px; font:inherit; outline:none; }
.empty { color:var(--dim); padding:30px; text-align:center; }

.toolbar { display:flex; gap:10px; align-items:center; margin-bottom:14px; flex-wrap:wrap; }
.btn { background:var(--bg3); color:var(--text); border:1px solid var(--border); padding:7px 13px; border-radius:7px; cursor:pointer; font:inherit; }
.btn:hover { background:var(--bg4); }
.btn.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
.btn.danger { background:transparent; border-color:var(--err); color:var(--err); }
.btn.sm { padding:4px 9px; font-size:12px; }
.pager { margin-top:12px; display:flex; gap:10px; align-items:center; color:var(--muted); }
.meta { color:var(--dim); font-size:12px; }

/* sql */
.sql-editor { width:100%; min-height:140px; background:var(--bg1); border:1px solid var(--border); border-radius:9px; color:var(--text); padding:12px; font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; outline:none; resize:vertical; }
.result { margin-top:14px; border:1px solid var(--border); border-radius:9px; overflow:auto; max-height:50vh; }

/* erd */
.erd-canvas { display:flex; flex-wrap:wrap; gap:20px; align-content:flex-start; }
.erd-table { background:var(--bg1); border:1px solid var(--border); border-radius:9px; min-width:200px; }
.erd-table h4 { padding:10px 12px; border-bottom:1px solid var(--border); font-size:13px; }
.erd-table .col { padding:5px 12px; font-size:12px; color:var(--muted); border-bottom:1px solid var(--border); display:flex; justify-content:space-between; }
.erd-table .col:last-child { border-bottom:none; }
.erd-table .col .t { color:var(--dim); font-size:11px; }
.erd-table .col.pk { color:var(--pk); }

/* migrations */
.mig-row { display:flex; align-items:center; gap:10px; padding:9px 12px; border:1px solid var(--border); border-radius:8px; margin-bottom:8px; background:var(--bg1); }
.tag { font-size:11px; padding:2px 8px; border-radius:20px; }
.tag.applied { background:rgba(61,220,151,.15); color:var(--ok); }
.tag.pending { background:rgba(255,180,84,.15); color:var(--warn); }

.toast { position:fixed; bottom:20px; right:20px; background:var(--bg3); border:1px solid var(--border); padding:11px 16px; border-radius:9px; transform:translateY(80px); opacity:0; transition:.25s; max-width:340px; }
.toast.show { transform:translateY(0); opacity:1; }
.toast.err { border-color:var(--err); color:#ffd4d4; }
h2.v-title { font-size:18px; margin-bottom:4px; }
h3 { margin:18px 0 8px; font-weight:600; }
.cache-box { background:var(--bg1); border:1px solid var(--border); border-radius:9px; padding:14px 18px; min-width:220px; flex:1; }
.cache-box td { padding:4px 12px 4px 0; font-size:13px; }
.cache-box .cl { color:var(--muted); }
`;

const JS = `
const state = { page:'tables', table:null, data:null, order:null, dir:'asc', search:'', offset:0, limit:100 };
const api = async (path, opts) => {
  // The dashboard always talks to the merged server, where studio JSON lives
  // under /api/studio/*. Rewrite /api/... -> /api/studio/...; the standalone
  // server also accepts the /api/studio/ form, so this works in both modes.
  const url = path.replace(/^\/api\//, "/api/studio/");
  const r = await fetch(url, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
  return j;
};
const toast = (msg, err) => {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
  setTimeout(() => t.className = 'toast', 2600);
};

async function loadHealth() {
  try { const h = await api('/api/health'); document.getElementById('conn-label').textContent = h.dialect + ' · ' + h.tables + ' tables'; }
  catch(e){ document.getElementById('conn-label').textContent = 'offline'; }
}
async function loadTableList() {
  const { tables } = await api('/api/tables');
  const el = document.getElementById('table-list');
  el.innerHTML = '';
  for (const t of tables) {
    const a = document.createElement('a');
    a.textContent = t.name;
    a.onclick = () => openTable(t.name);
    el.appendChild(a);
  }
}

function nav(page) {
  state.page = page;
  document.querySelectorAll('.nav-link').forEach(l => l.classList.toggle('active', l.dataset.page === page));
  render();
}
document.querySelectorAll('.nav-link').forEach(l => l.onclick = () => nav(l.dataset.page));

async function openTable(name) {
  state.table = name; state.offset = 0; state.order = null; state.search = '';
  document.getElementById('search').value = '';
  nav('tables');
}

async function loadData() {
  const q = new URLSearchParams();
  if (state.order) { q.set('order', state.order); q.set('dir', state.dir); }
  if (state.search) q.set('search', state.search);
  q.set('offset', state.offset); q.set('limit', state.limit);
  const d = await api('/api/tables/' + encodeURIComponent(state.table) + '?' + q.toString());
  state.data = d;
  renderGrid(d);
}

function renderGrid(d) {
  const c = document.getElementById('content');
  const pk = d.primaryKey;
  let html = '<div class="view active" id="v-tables"><h2 class="v-title">' + escapeHtml(state.table) + '</h2>';
  html += '<div class="toolbar"><span class="meta">' + d.count + ' rows</span>';
  html += '<input id="tbl-search" class="btn" style="flex:1;max-width:280px;background:var(--bg2)" placeholder="Filter this table…" value="' + escapeHtml(state.search) + '">';
  html += '<button class="btn primary sm" id="add-row">+ Add row</button>';
  html += '<button class="btn sm" id="refresh">Refresh</button></div>';
  html += '<div class="grid-wrap"><table class="grid"><thead><tr>';
  for (const col of d.columns) html += '<th data-col="' + escapeHtml(col) + '">' + escapeHtml(col) + (col === pk ? '<span class="pk">PK</span>' : '') + '</th>';
  html += '<th></th></tr></thead><tbody>';
  if (d.rows.length === 0) {
    html += '<tr><td class="empty" colspan="' + (d.columns.length + 1) + '">No rows.</td></tr>';
  }
  for (const row of d.rows) {
    html += '<tr data-pk="' + escapeHtml(String(row[pk])) + '">';
    for (const col of d.columns) html += '<td data-col="' + escapeHtml(col) + '" class="' + (col === pk ? '' : 'editable') + '">' + escapeHtml(fmt(row[col])) + '</td>';
    html += '<td><button class="btn sm danger del" data-pk="' + escapeHtml(String(row[pk])) + '">✕</button></td></tr>';
  }
  html += '</tbody></table></div>';
  const pages = Math.max(0, Math.ceil(d.count / state.limit) - 1);
  html += '<div class="pager"><button class="btn sm" id="prev"' + (state.offset <= 0 ? ' disabled' : '') + '>← Prev</button>';
  html += '<span class="meta">page ' + (Math.floor(state.offset / state.limit) + 1) + ' / ' + (pages + 1) + '</span>';
  html += '<button class="btn sm" id="next"' + (state.offset + state.limit >= d.count ? ' disabled' : '') + '>Next →</button></div>';
  html += '</div>';
  c.innerHTML = html;

  c.querySelector('#refresh').onclick = () => loadData();
  c.querySelector('#tbl-search').oninput = (e) => { state.search = e.target.value; state.offset = 0; debounce(loadData, 250)(); };
  c.querySelector('#prev').onclick = () => { state.offset -= state.limit; loadData(); };
  c.querySelector('#next').onclick = () => { state.offset += state.limit; loadData(); };
  c.querySelector('#add-row').onclick = () => showAddRow(d);
  c.querySelectorAll('th[data-col]').forEach(th => th.onclick = () => {
    const col = th.dataset.col;
    if (state.order === col) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
    else { state.order = col; state.dir = 'asc'; }
    loadData();
  });
  c.querySelectorAll('td.editable').forEach(td => td.ondblclick = () => editCell(td, d));
  c.querySelectorAll('button.del').forEach(b => b.onclick = async () => {
    if (!confirm('Delete row ' + b.dataset.pk + '?')) return;
    try { await api('/api/tables/' + encodeURIComponent(state.table), { method:'DELETE', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id: b.dataset.pk }) }); toast('Deleted'); loadData(); }
    catch(e){ toast(e.message, true); }
  });
}

function editCell(td, d) {
  const col = td.dataset.col;
  const tr = td.closest('tr');
  const pkVal = tr.dataset.pk;
  const cur = td.textContent === '∅' ? '' : td.textContent;
  const inp = document.createElement('input');
  inp.className = 'cell-input'; inp.value = cur;
  td.innerHTML = ''; td.appendChild(inp); inp.focus();
  const commit = async () => {
    const val = inp.value === '' ? null : coerce(inp.value);
    try {
      await api('/api/tables/' + encodeURIComponent(state.table), { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id: pkVal, [col]: val }) });
      toast('Saved'); loadData();
    } catch(e){ toast(e.message, true); loadData(); }
  };
  inp.onblur = commit;
  inp.onkeydown = (e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') loadData(); };
}

function showAddRow(d) {
  const obj = {};
  for (const col of d.columns) if (col !== d.primaryKey) obj[col] = prompt('Value for ' + col + ' (' + colType(d, col) + '):', '');
  if (obj[d.columns.find(c => c !== d.primaryKey)] === null) return;
  for (const k in obj) obj[k] = obj[k] === '' || obj[k] === null ? null : coerce(obj[k]);
  api('/api/tables/' + encodeURIComponent(state.table), { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(obj) })
    .then(() => { toast('Inserted'); loadData(); }).catch(e => toast(e.message, true));
}
function colType(d, col) { const c = d.columns.indexOf(col); return c; }

function renderSQL() {
  const c = document.getElementById('content');
  c.innerHTML = '<div class="view active" id="v-query"><h2 class="v-title">SQL Console</h2><p class="meta">Runs through the engine driver — parameterized, dialect-aware.</p>';
  c.innerHTML += '<textarea class="sql-editor" id="sql" placeholder="SELECT * FROM ' + (state.table || 'users') + ' LIMIT 50"></textarea>';
  c.innerHTML += '<div class="toolbar"><button class="btn primary" id="run">Run ▸</button><span class="meta" id="sql-info"></span></div>';
  c.innerHTML += '<div id="sql-result"></div></div>';
  c.querySelector('#run').onclick = runSql;
}
async function runSql() {
  const sql = document.getElementById('sql').value;
  if (!sql.trim()) return;
  try {
    const r = await api('/api/query', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ sql }) });
    const res = document.getElementById('sql-result');
    document.getElementById('sql-info').textContent = r.changes ? (r.changes + ' row(s) affected') : (r.rows.length + ' rows');
    if (r.columns && r.rows.length) {
      let h = '<div class="result"><table class="grid"><thead><tr>';
      for (const col of r.columns) h += '<th>' + escapeHtml(col) + '</th>';
      h += '</tr></thead><tbody>';
      for (const row of r.rows) { h += '<tr>'; for (const col of r.columns) h += '<td>' + escapeHtml(fmt(row[col])) + '</td>'; h += '</tr>'; }
      h += '</tbody></table></div>';
      res.innerHTML = h;
    } else res.innerHTML = '<div class="result empty">' + (r.changes ? 'OK' : 'No rows') + '</div>';
  } catch(e){ toast(e.message, true); document.getElementById('sql-info').textContent = 'error'; }
}

async function renderERD() {
  const c = document.getElementById('content');
  c.innerHTML = '<div class="view active" id="v-erd"><h2 class="v-title">Entity Relationship</h2><p class="meta">From the live schema (primary keys highlighted).</p><div class="erd-canvas" id="erd"></div></div>';
  const { tables } = await api('/api/erd');
  const wrap = c.querySelector('#erd');
  for (const t of tables) {
    let h = '<div class="erd-table"><h4>' + escapeHtml(t.name) + '</h4>';
    for (const col of t.columns) h += '<div class="col' + (col.primaryKey ? ' pk' : '') + '"><span>' + escapeHtml(col.name) + (col.nullable ? '' : ' *') + '</span><span class="t">' + col.type + '</span></div>';
    h += '</div>';
    wrap.innerHTML += h;
  }
}

async function renderMigrations() {
  const c = document.getElementById('content');
  c.innerHTML = '<div class="view active" id="v-mig"><h2 class="v-title">Migrations</h2><div id="mig-list"></div></div>';
  const { applied, pending } = await api('/api/migrations');
  const wrap = c.querySelector('#mig-list');
  if (!applied.length && !pending.length) wrap.innerHTML = '<div class="empty">No migration history yet.</div>';
  for (const n of applied) wrap.innerHTML += '<div class="mig-row"><span class="tag applied">applied</span> ' + escapeHtml(n) + '</div>';
  for (const n of pending) wrap.innerHTML += '<div class="mig-row"><span class="tag pending">pending</span> ' + escapeHtml(n) + '</div>';
}

async function renderCache() {
  const c = document.getElementById('content');
  c.innerHTML = '<div class="view active" id="v-cache"><h2 class="v-title">⚡ Cache</h2><p class="meta">Multi-level cache live metrics.</p><div id="cache-wrap"></div></div>';
  const wrap = c.querySelector('#cache-wrap');
  try {
    const { stats, enabled } = await api('/api/cache/stats');
    if (!enabled) { wrap.innerHTML = '<div class="empty">Cache not available.</div>'; return; }
    let h = '<div style="display:flex;gap:20px;flex-wrap:wrap">';
    if (stats.l1) {
      h += '<div class="cache-box"><h3>L1 Memory</h3><table>';
      h += '<tr><td>Entries</td><td>'+stats.l1.entries+'</td></tr>';
      h += '<tr><td>Hit rate</td><td><b>'+(stats.l1.hitRate*100).toFixed(1)+'%</b></td></tr>';
      h += '<tr><td>Hits</td><td>'+stats.l1.hits+'</td></tr>';
      h += '<tr><td>Misses</td><td>'+stats.l1.misses+'</td></tr>';
      h += '<tr><td>Evictions</td><td>'+stats.l1.evictions+'</td></tr>';
      if (stats.l1.memoryBytes) h += '<tr><td>Memory</td><td>'+fmtBytes(stats.l1.memoryBytes)+'</td></tr>';
      h += '</table></div>';
    }
    if (stats.l2) {
      h += '<div class="cache-box"><h3>L2 Distributed</h3><table>';
      h += '<tr><td>Entries</td><td>'+stats.l2.entries+'</td></tr>';
      h += '<tr><td>Hit rate</td><td><b>'+(stats.l2.hitRate*100).toFixed(1)+'%</b></td></tr>';
      h += '<tr><td>Hits</td><td>'+stats.l2.hits+'</td></tr>';
      h += '<tr><td>Misses</td><td>'+stats.l2.misses+'</td></tr>';
      h += '</table></div>';
    }
    h += '<div class="cache-box"><h3>Summary</h3><table>';
    h += '<tr><td>Total hits</td><td>'+(stats.totalHits||0)+'</td></tr>';
    h += '<tr><td>Total misses</td><td>'+(stats.totalMisses||0)+'</td></tr>';
    h += '<tr><td>Hit rate</td><td><b>'+(stats.hitRate*100).toFixed(1)+'%</b></td></tr>';
    h += '<tr><td>Memory</td><td>'+fmtBytes(stats.memoryBytes||0)+'</td></tr>';
    h += '</table></div></div>';
    if (stats.topKeys && stats.topKeys.length) {
      h += '<div style="margin-top:16px"><h3>Top Keys</h3><table class="grid"><thead><tr><th>Key</th><th>Hits</th><th>TTL</th></tr></thead><tbody>';
      for (const k of stats.topKeys.slice(0,10)) {
        h += '<tr><td>'+escapeHtml(k.key)+'</td><td>'+k.hits+'</td><td>'+fmtDuration(k.ttl)+'</td></tr>';
      }
      h += '</tbody></table></div>';
    }
    h += '<div class="toolbar" style="margin-top:16px"><button class="btn sm danger" id="cclear">🗑 Clear cache</button></div>';
    wrap.innerHTML = h;
    const btn = wrap.querySelector('#cclear');
    if (btn) btn.onclick = async () => { if (!confirm('Clear all cache?')) return; await api('/api/cache/clear',{method:'POST'}); toast('Cleared'); renderCache(); };
  } catch(e) { wrap.innerHTML = '<div class="empty">'+escapeHtml(e.message)+'</div>'; }
}
function fmtBytes(b) { if(b<1024) return b+'B'; if(b<1048576) return (b/1024).toFixed(1)+'KB'; return (b/1048576).toFixed(1)+'MB'; }
function fmtDuration(s) { if(s<60) return s+'s'; if(s<3600) return Math.floor(s/60)+'m'; return Math.floor(s/3600)+'h'; }

function render() {
  const c = document.getElementById('content');
  c.innerHTML = '';
  if (state.page === 'tables') {
    if (!state.table) { c.innerHTML = '<div class="empty">Select a table from the sidebar.</div>'; }
    else loadData().catch(e => toast(e.message, true));
  } else if (state.page === 'query') renderSQL();
  else if (state.page === 'erd') renderERD().catch(e => toast(e.message, true));
  else if (state.page === 'migrations') renderMigrations().catch(e => toast(e.message, true));
  else if (state.page === 'cache') renderCache().catch(e => toast(e.message, true));
}

function fmt(v) {
  if (v === null || v === undefined) return '∅';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function coerce(v) { if (v === 'true') return true; if (v === 'false') return false; if (v !== '' && !isNaN(Number(v))) return Number(v); return v; }
let _t; function debounce(fn, ms){ return (...a) => { clearTimeout(_t); _t = setTimeout(() => fn(...a), ms); }; }

document.getElementById('search').oninput = (e) => {
  const q = e.target.value.toLowerCase();
  document.querySelectorAll('#table-list a').forEach(a => a.style.display = a.textContent.toLowerCase().includes(q) ? '' : 'none');
};
document.addEventListener('keydown', (e) => { if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') { e.preventDefault(); document.getElementById('search').focus(); } });

(async () => { await loadHealth(); await loadTableList(); render(); })();
`;
