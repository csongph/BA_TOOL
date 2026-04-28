// ─────────────────────────────────────────────────────────────
//  SQL File Converter — script.js
//  Flow:
//    SQL  → upload → POST /convert (auto) → backend mapping → render
//    CSV/Excel → parse local → render (ไม่ผ่าน backend)
//    Override → POST /override/:id → sync ทันที
// ─────────────────────────────────────────────────────────────

const API_BASE = window.API_BASE || '';

// ── State ──────────────────────────────────────────────────
let currentData   = {};  // { [tableName]: { headers, rows, fileName, fileType, backendCols? } }
let uploadedFiles = [];  // { name, type, fileObj }
let sessionId     = null;
let converted     = false;

// ─── File Input / Drag & Drop ──────────────────────────────
document.getElementById('fileInput').addEventListener('change', e => handleFiles(e.target.files));

function onDragOver(e)  { e.preventDefault(); document.getElementById('dropzone').classList.add('drag-over'); }
function onDragLeave()  { document.getElementById('dropzone').classList.remove('drag-over'); }
function onDrop(e) {
  e.preventDefault();
  document.getElementById('dropzone').classList.remove('drag-over');
  handleFiles(e.dataTransfer.files);
}

// ═══════════════════════════════════════════════════════════
//  HANDLE FILES — entry point
// ═══════════════════════════════════════════════════════════
async function handleFiles(files) {
  if (!files || files.length === 0) return;

  const supported = Array.from(files).filter(f => /\.(csv|xlsx|sql)$/i.test(f.name));
  if (!supported.length) {
    showStatus('uploadStatus', 'error', 'ไม่รองรับไฟล์ประเภทนี้ (CSV, Excel, SQL เท่านั้น)');
    return;
  }

  // Reset ก่อนเสมอ ไม่ว่า modal จะตัดสินใจอย่างไร
  currentData   = {};
  uploadedFiles = [];
  sessionId     = null;
  converted     = false;
  document.getElementById('fileList').innerHTML = '';
  document.getElementById('convertBtn').disabled = true;
  clearUI();

  // ── ตรวจ duplicate ก่อนทำอะไรทั้งนั้น ─────────────────
  const dupIssues = await detectDuplicates(supported);
  if (dupIssues.length > 0) {
    const decision = await showDuplicateModal(dupIssues, supported);
    if (decision === 'cancel') {
      showStatus('uploadStatus', 'error', '⚠️ ยกเลิกการอัปโหลด — กรุณาเลือกไฟล์ใหม่');
      return;
    }
    // proceed → ดำเนินการต่อแม้จะมี duplicate
  }

  setLoading(true);

  const sqlFiles   = supported.filter(f => /\.sql$/i.test(f.name));
  const localFiles = supported.filter(f => /\.(csv|xlsx)$/i.test(f.name));

  // Register all files
  supported.forEach(f => {
    const ext  = f.name.split('.').pop().toLowerCase();
    const type = ext === 'sql' ? 'sql' : ext === 'csv' ? 'csv' : 'excel';
    uploadedFiles.push({ name: f.name, type, fileObj: f });
    renderFileChip(f.name, type);
  });

  // 1. Parse CSV / Excel locally
  await Promise.all(localFiles.map(f => parseLocalFile(f)));

  // 2. SQL → ส่ง backend ทันที (auto mapping)
  if (sqlFiles.length > 0) {
    showStatus('uploadStatus', 'info', `⏳ กำลัง mapping ${sqlFiles.length} SQL file กับ backend...`);
    await sendSQLToBackend(sqlFiles);
  } else {
    setLoading(false);
    onAllDone();
  }
}

// ─── Parse CSV / Excel locally ─────────────────────────────
function parseLocalFile(file) {
  return new Promise(resolve => {
    const ext    = file.name.split('.').pop().toLowerCase();
    const reader = new FileReader();

    if (ext === 'csv') {
      reader.onload = e => {
        try { parseCSV(file.name, e.target.result); } catch {}
        resolve();
      };
      reader.readAsText(file, 'utf-8');
    } else {
      reader.onload = e => {
        try {
          const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
          wb.SheetNames.forEach(sheet => {
            const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet]);
            if (rows.length > 0) {
              const key = file.name.replace(/\.[^/.]+$/, '') +
                          (wb.SheetNames.length > 1 ? '_' + sheet : '');
              currentData[key] = { headers: Object.keys(rows[0]), rows, fileName: file.name, fileType: 'excel' };
            }
          });
        } catch {}
        resolve();
      };
      reader.readAsArrayBuffer(file);
    }
  });
}

// ─── CSV parser ─────────────────────────────────────────────
function parseCSV(fileName, text) {
  const lines    = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const nonEmpty = lines.filter(l => l.trim());
  if (nonEmpty.length < 2) return;
  const headers = parseCSVLine(nonEmpty[0]);
  const rows    = nonEmpty.slice(1).map(line => {
    const vals = parseCSVLine(line);
    return headers.reduce((obj, h, i) => { obj[h] = vals[i] ?? ''; return obj; }, {});
  });
  currentData[fileName.replace(/\.[^/.]+$/, '')] = { headers, rows, fileName, fileType: 'csv' };
}

function parseCSVLine(line) {
  const result = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i+1] === '"') { cur += '"'; i++; } else inQ = !inQ;
    } else if (ch === ',' && !inQ) { result.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  result.push(cur.trim());
  return result;
}

// ═══════════════════════════════════════════════════════════
//  BACKEND — POST /convert  (auto-trigger เมื่อ upload SQL)
// ═══════════════════════════════════════════════════════════
async function sendSQLToBackend(sqlFiles) {
  const form = new FormData();
  sqlFiles.forEach(f => form.append('files', f, f.name));

  try {
    const res = await fetch(`${API_BASE}/convert`, { method: 'POST', body: form });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }

    const data = await res.json();
    sessionId = data.session_id;

    // ใส่ backend mapping result เข้า currentData
    applyBackendTables(data.tables, data.unknown || {}, data.byte_anomalies || {});

    const unknownCount = Object.values(data.unknown || {}).flat().length;
    const anomalyCount = Object.values(data.byte_anomalies || {}).flat().length;
    const contentDups  = data.content_dup_warnings || [];

    if (unknownCount > 0) renderUnknownWarnings(data.unknown);
    if (anomalyCount > 0) renderByteAnomalyWarnings(data.byte_anomalies);
    if (contentDups.length > 0) renderContentDupWarnings(contentDups);

    showStatus('uploadStatus', 'success',
      `✓ Backend mapping สำเร็จ — ${Object.keys(data.tables).length} table` +
      (unknownCount ? ` (⚠️ ${unknownCount} unknown type)` : '') +
      (anomalyCount ? ` (🔴 ${anomalyCount} byte anomaly)` : '') +
      (contentDups.length ? ` (🔁 ${contentDups.length} content ซ้ำ)` : '')
    );

  } catch (err) {
    showStatus('uploadStatus', 'error', '❌ Backend: ' + err.message);
  } finally {
    setLoading(false);
    onAllDone();
  }
}

// ── นำ backend result มาใส่ currentData ──────────────────
function applyBackendTables(tables, unknown, byteAnomalies = {}) {
  Object.entries(tables).forEach(([tableName, cols]) => {
    const fileName    = cols[0]?.file || 'unknown.sql';
    const unknownCols = (unknown[tableName] || []).map(u => u.column_name);
    const anomalyCols = (byteAnomalies[tableName] || []).map(a => a.column_name);

    currentData[tableName] = {
      headers    : cols.map(c => c.column_name),
      rows       : [],          // SQL = schema only ไม่มี data rows
      fileName,
      fileType   : 'sql',
      backendCols: cols.map(c => ({
        ...c,
        isUnknown    : unknownCols.includes(c.column_name),
        isByteAnomaly: anomalyCols.includes(c.column_name),
      }))
    };
  });
}

// ── หลังทุก file พร้อม ─────────────────────────────────────
function onAllDone() {
  converted = true;
  const tableCount = Object.keys(currentData).length;
  const rowCount   = Object.values(currentData).reduce((s, t) => s + t.rows.length, 0);

  updateStats(uploadedFiles.length, tableCount, rowCount);
  updateBadges(tableCount, rowCount, sessionId ? 'mapped' : 'loaded');
  renderTypePanel();
  renderTables();
  document.getElementById('convertBtn').disabled = false;

  // แสดง session card
  if (sessionId) {
    const card = document.getElementById('sessionCard');
    const disp = document.getElementById('sessionIdDisplay');
    if (card) card.style.display = 'block';
    if (disp) disp.textContent   = sessionId;
  }
}

// ═══════════════════════════════════════════════════════════
//  CONVERT BUTTON — re-send SQL ไป backend (refresh mapping)
// ═══════════════════════════════════════════════════════════
async function convertData() {
  const sqlFiles = uploadedFiles.filter(f => f.type === 'sql').map(f => f.fileObj);

  if (!sqlFiles.length) {
    showStatus('convertStatus', 'success', '✓ ไม่มีไฟล์ SQL — ข้อมูล local พร้อมแล้ว');
    return;
  }

  if (sessionId) await deleteSession(true);

  setLoading(true);
  showStatus('convertStatus', 'info', '⏳ Re-mapping กับ backend...');
  await sendSQLToBackend(sqlFiles);
  setLoading(false);

  // อัปเดต session card
  const card = document.getElementById('sessionCard');
  const disp = document.getElementById('sessionIdDisplay');
  if (sessionId) {
    if (card) card.style.display = 'block';
    if (disp) disp.textContent = sessionId;
  }
}

// ═══════════════════════════════════════════════════════════
//  OVERRIDE — POST /override/:id
// ═══════════════════════════════════════════════════════════
async function applyOverride(tableName, columnName, newType, selectEl) {
  // อัปเดต local ก่อน
  const t = currentData[tableName];
  if (t?.backendCols) {
    const col = t.backendCols.find(c => c.column_name === columnName);
    if (col) col.final_type = newType;
  }

  if (!sessionId) {
    flashSelect(selectEl, 'local');
    reRenderCardPills(tableName);
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/override/${sessionId}`, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ table: tableName, column: columnName, new_type: newType })
    });

    if (!res.ok) throw new Error((await res.json().catch(()=>({}))).detail || res.statusText);

    const updated = await res.json();
    if (t?.backendCols && updated.updated_column) {
      const col = t.backendCols.find(c => c.column_name === columnName);
      if (col) Object.assign(col, updated.updated_column);
    }
    flashSelect(selectEl, 'ok');
    reRenderCardPills(tableName);

  } catch (err) {
    flashSelect(selectEl, 'err');
    showStatus('convertStatus', 'error', '❌ Override: ' + err.message);
  }
}

function flashSelect(el, state) {
  if (!el) return;
  el.classList.remove('saved', 'err-flash');
  void el.offsetWidth;
  if (state === 'ok' || state === 'local') {
    el.classList.add('saved');
    setTimeout(() => el.classList.remove('saved'), 1200);
  } else {
    el.classList.add('err-flash');
    setTimeout(() => el.classList.remove('err-flash'), 1200);
  }
}

function reRenderCardPills(tableName) {
  const el = document.getElementById('pills-' + tableName);
  if (!el) return;
  const t = currentData[tableName];
  if (t?.backendCols) el.innerHTML = buildPillsHTML(t.backendCols);
}

// ═══════════════════════════════════════════════════════════
//  RESULT / DELETE SESSION
// ═══════════════════════════════════════════════════════════
async function fetchResult() {
  if (!sessionId) { showStatus('convertStatus', 'error', 'ยังไม่มี session'); return; }
  setLoading(true);
  try {
    const res = await fetch(`${API_BASE}/result/${sessionId}`);
    if (!res.ok) throw new Error((await res.json().catch(()=>({}))).detail || res.statusText);
    const data = await res.json();
    applyBackendTables(data.tables, data.unknown || {}, data.byte_anomalies || {});
    if (Object.values(data.byte_anomalies || {}).flat().length > 0)
      renderByteAnomalyWarnings(data.byte_anomalies);
    renderTypePanel();
    renderTables();
    showStatus('convertStatus', 'success', '✓ Refresh result สำเร็จ');
  } catch (err) {
    showStatus('convertStatus', 'error', '❌ ' + err.message);
  } finally { setLoading(false); }
}

async function deleteSession(silent = false) {
  if (!sessionId) return;
  try {
    await fetch(`${API_BASE}/session/${sessionId}`, { method: 'DELETE' });
    if (!silent) showStatus('convertStatus', 'success', '✓ ลบ session แล้ว');
  } catch {}
  sessionId = null;
}

async function handleDeleteSession() {
  await deleteSession();
  const card = document.getElementById('sessionCard');
  const disp = document.getElementById('sessionIdDisplay');
  if (card) card.style.display = 'none';
  if (disp) disp.textContent   = '—';
}

// ═══════════════════════════════════════════════════════════
//  TYPE PANEL (sidebar) — แสดง mapping จาก backend
// ═══════════════════════════════════════════════════════════
function renderTypePanel() {
  const body = document.getElementById('typeTableBody');
  const keys  = Object.keys(currentData);

  if (!keys.length) {
    body.innerHTML = '<tr><td colspan="3"><div class="empty-hint">No file loaded</div></td></tr>';
    return;
  }

  // หา SQL table แรก
  const sqlKey = keys.find(k => currentData[k].backendCols);

  if (sqlKey) {
    const cols = currentData[sqlKey].backendCols;
    body.innerHTML = cols.map(col => `
      <tr class="${col.isUnknown ? 'row-unknown' : ''}">
        <td>
          <span class="col-name">${col.column_name}</span>
          ${col.isUnknown ? '<span class="unk-badge">?</span>' : ''}
        </td>
        <td>
          <span class="inferred-badge">${col.logical_type || col.raw_type || '—'}</span>
          <div class="src-type">${col.source_sql_type || ''}</div>
        </td>
        <td>
          <select class="type-select"
            onchange="applyOverride('${sqlKey}','${col.column_name}',this.value,this)">
            ${buildTypeOptions(col.final_type || col.source_sql_type || '')}
          </select>
        </td>
      </tr>`).join('');
  } else {
    // CSV/Excel — infer local
    const firstKey = keys[0];
    const first = currentData[firstKey];
    body.innerHTML = first.headers.map(h => {
      const inf = inferLocalType(first.rows.map(r => r[h]));
      return `<tr>
        <td><span class="col-name">${h}</span></td>
        <td><span class="inferred-badge">${inf}</span></td>
        <td>
          <select class="type-select"
            onchange="applyOverride('${firstKey}','${h}',this.value,this)">
            ${buildTypeOptions(inf)}
          </select>
        </td>
      </tr>`;
    }).join('');
  }
}

function inferLocalType(values) {
  const s = values.filter(v => v !== '' && v != null).slice(0, 50);
  if (!s.length)                                    return 'VARCHAR';
  if (s.every(v => /^-?\d+$/.test(v)))             return 'INT';
  if (s.every(v => /^-?\d+(\.\d+)?$/.test(v)))     return 'DECIMAL';
  if (s.every(v => /^\d{4}-\d{2}-\d{2}/.test(v))) return 'DATE';
  if (s.every(v => /^(true|false|0|1)$/i.test(v))) return 'BOOLEAN';
  return 'VARCHAR';
}

function buildTypeOptions(selected = '') {
  const types = ['VARCHAR','NVARCHAR','NVARCHAR(MAX)','CHAR',
                 'INT','BIGINT','SMALLINT','TINYINT',
                 'DECIMAL','FLOAT','DOUBLE','NUMBER',
                 'DATE','DATETIME','TIMESTAMP',
                 'BOOLEAN','BIT','TEXT','NTEXT'];
  const list = types.includes(selected) ? types : (selected ? [selected, ...types] : types);
  return list.map(t => `<option${t === selected ? ' selected' : ''}>${t}</option>`).join('');
}

// ═══════════════════════════════════════════════════════════
//  RENDER TABLES
// ═══════════════════════════════════════════════════════════
const FILE_TYPE_META = {
  csv  : { label:'CSV',   icon:'📄', color:'var(--accent)',  dim:'rgba(0,214,143,0.12)' },
  excel: { label:'Excel', icon:'📊', color:'var(--accent2)', dim:'rgba(0,148,255,0.12)' },
  sql  : { label:'SQL',   icon:'🗃️',  color:'var(--warn)',    dim:'rgba(245,166,35,0.12)' },
};

function renderTables() {
  const grid = document.getElementById('tablesGrid');
  const bulk = document.getElementById('bulkSection');
  const keys  = Object.keys(currentData);

  if (!keys.length) {
    grid.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">📭</div>
      <div class="empty-state-text">ไม่พบตารางในไฟล์นี้</div>
    </div>`;
    bulk.classList.remove('visible');
    return;
  }

  const groups = {};
  keys.forEach(k => {
    const ft = currentData[k].fileType || 'csv';
    if (!groups[ft]) groups[ft] = [];
    groups[ft].push(k);
  });

  bulk.classList.add('visible');

  grid.innerHTML = ['csv','excel','sql'].filter(ft => groups[ft]).map(ft => {
    const meta      = FILE_TYPE_META[ft];
    const tkeys     = groups[ft];
    const totalRows = tkeys.reduce((s, k) => s + currentData[k].rows.length, 0);
    return `
      <div class="type-group">
        <div class="type-group-header" style="--g-color:${meta.color};--g-dim:${meta.dim}">
          <span class="type-group-icon">${meta.icon}</span>
          <span class="type-group-label">${meta.label}</span>
          <span class="type-group-count">${tkeys.length} table${tkeys.length>1?'s':''} · ${totalRows.toLocaleString()} rows</span>
          <div class="type-group-line"></div>
        </div>
        <div class="tables-subgrid">
          ${tkeys.map(k => buildTableCard(k)).join('')}
        </div>
      </div>`;
  }).join('');
}

function buildTableCard(k) {
  const t     = currentData[k];
  const isSql = !!t.backendCols;

  // Backend column pills (SQL only)
  const pillsBlock = isSql
    ? `<div class="backend-cols" id="pills-${k}">${buildPillsHTML(t.backendCols)}</div>`
    : '';

  // Data preview — ตรงกับข้อมูลที่ export จริง
  const previewCols = isSql ? MAP_HEADERS : t.headers;
  const previewSrc  = isSql ? toMappingRows(t.backendCols) : t.rows;
  const previewRows = previewSrc.slice(0, 15);
  const moreRows    = previewSrc.length - 15;

  const theadHtml = previewCols.map((h, idx) =>
    `<th class="${idx === 0 && isSql ? 'preview-th-num' : ''}" title="${h}">${h}</th>`).join('');
  const tbodyHtml = previewRows.map((r, i) =>
    `<tr class="${i % 2 === 1 ? 'preview-row-alt' : ''}">
      ${previewCols.map((h, idx) =>
        `<td class="${idx === 0 && isSql ? 'preview-td-num' : ''}">${String(r[h] ?? '')}</td>`
      ).join('')}
    </tr>`
  ).join('');
  const noDataHtml = `<tr><td colspan="${previewCols.length || 1}" class="no-data-cell">No data</td></tr>`;

  const sessionTag = sessionId
    ? `<span class="session-tag" title="session: ${sessionId}">🔗 mapped</span>` : '';

  return `
  <div class="table-card">
    <div class="table-card-header" onclick="openTableModal('${k}')" title="คลิกเพื่อดูตารางแบบเต็ม">
      <div class="table-card-icon">${isSql ? '🗃️' : '📊'}</div>
      <div style="min-width:0;flex:1">
        <div class="table-card-name" title="${k}">${k} ${sessionTag}</div>
        <div class="table-card-meta">
          <span>${t.headers.length}</span> cols ·
          ${isSql
            ? `<span class="mapped-label">backend mapped</span> · ${t.fileName}`
            : `<span>${t.rows.length.toLocaleString()}</span> rows · ${t.fileName}`}
        </div>
      </div>
      <div class="expand-hint">
        <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
          <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
          <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
        </svg>
        expand
      </div>
    </div>
    ${pillsBlock}
    <div class="preview-wrap">
      <table class="preview-table">
        <thead><tr>${theadHtml || '<th>—</th>'}</tr></thead>
        <tbody>${tbodyHtml || noDataHtml}</tbody>
      </table>
    </div>
    ${moreRows > 0 ? `<div class="preview-more">+${moreRows.toLocaleString()} more rows</div>` : ''}
    <div class="table-card-actions">
      ${isSql ? `
      <button class="btn-card-dl xlsx" onclick="downloadTableXLSX('${k}')">⬇ Mapping XLSX</button>
      ` : `
      <button class="btn-card-dl csv"  onclick="downloadTable('${k}','csv')">⬇ CSV</button>
      <button class="btn-card-dl xlsx" onclick="downloadTable('${k}','xlsx')">⬇ XLSX</button>
      `}
    </div>
  </div>`;
}

function buildPillsHTML(backendCols) {
  const show = backendCols.slice(0, 6);
  const more = backendCols.length - 6;
  return show.map(c => {
    const cls = c.isByteAnomaly ? ' byte-anomaly'
              : c.isUnknown     ? ' unknown'
              : '';
    const tooltip = c.isByteAnomaly
      ? `⚠️ byte anomaly: source=${c.source_sql_type}`
      : `source: ${c.source_sql_type||''}`;
    const badge = c.isByteAnomaly ? '<span class="anomaly-pill-badge">⚠️byte</span>' : '';
    return `
    <span class="bcol-pill${cls}" title="${tooltip}">
      ${c.column_name}<em>${c.final_type || c.logical_type || '?'}</em>
      ${badge}
      <span class="nullable-badge ${c.nullable === 'NOT NULL' ? 'not-null' : 'null'}">${c.nullable || 'NULL'}</span>
    </span>`;
  }).join('') +
    (more > 0 ? `<span class="bcol-more">+${more} more</span>` : '');
}

// ── Unknown type warnings ─────────────────────────────────
function renderUnknownWarnings(unknown) {
  document.getElementById('unknownWarnings')?.remove();
  const items = Object.entries(unknown).flatMap(([tbl, cols]) =>
    cols.map(c => `<li><b>${tbl}</b>.<span>${c.column_name}</span> — ${c.reason||'ไม่รู้จัก type'}</li>`)
  );
  if (!items.length) return;
  const div = document.createElement('div');
  div.id        = 'unknownWarnings';
  div.className = 'warn-panel';
  div.innerHTML = `
    <div class="warn-panel-header">
      ⚠️ Unknown Types (${items.length})
      <button onclick="this.parentElement.parentElement.remove()">✕</button>
    </div>
    <ul>${items.join('')}</ul>`;
  document.getElementById('tablesGrid').insertAdjacentElement('beforebegin', div);
}

// ── Byte anomaly warnings ─────────────────────────────────
function renderByteAnomalyWarnings(byteAnomalies) {
  document.getElementById('byteAnomalyWarnings')?.remove();
  const items = Object.entries(byteAnomalies).flatMap(([tbl, cols]) =>
    cols.map(c => `
      <li>
        <div class="anomaly-row">
          <span class="anomaly-loc"><b>${tbl}</b>.<code>${c.column_name}</code></span>
          <span class="anomaly-tag">source: <em>${c.source_type}</em> → raw: <em>${c.raw_type}</em></span>
        </div>
        <div class="anomaly-detail">${c.detail}</div>
        <div class="anomaly-file">📄 ${c.file}</div>
      </li>`)
  );
  if (!items.length) return;

  const div = document.createElement('div');
  div.id        = 'byteAnomalyWarnings';
  div.className = 'warn-panel byte-anomaly-panel';
  div.innerHTML = `
    <div class="warn-panel-header byte-anomaly-header">
      <span>🔴 ตรวจพบข้อมูลไม่ปกติ — Byte Conversion Anomaly (${items.length} คอลัมน์)</span>
      <div class="anomaly-actions">
        <span class="anomaly-hint">คอลัมน์เหล่านี้ถูกแปลงเป็น byte แต่ type ต้นทางไม่ใช่ decimal — กรุณาตรวจสอบ mapping</span>
        <button onclick="this.closest('#byteAnomalyWarnings').remove()">✕</button>
      </div>
    </div>
    <ul>${items.join('')}</ul>`;
  document.getElementById('tablesGrid').insertAdjacentElement('beforebegin', div);
}

// ── Content duplicate warnings ───────────────────────────
function renderContentDupWarnings(warnings) {
  document.getElementById('contentDupWarnings')?.remove();
  const items = warnings.map(w => `
    <li>
      <div class="anomaly-row">
        <span class="anomaly-loc"><b>${w.file}</b></span>
        <span class="anomaly-tag">🔁 เหมือนกับ <em>${w.duplicate_of}</em></span>
      </div>
      <div class="anomaly-detail">${w.msg}</div>
    </li>`);
  const div = document.createElement('div');
  div.id        = 'contentDupWarnings';
  div.className = 'warn-panel';
  div.innerHTML = `
    <div class="warn-panel-header">
      🔁 พบไฟล์ที่มีเนื้อหาซ้ำกัน (${warnings.length} ไฟล์) — แยก table ให้อัตโนมัติแล้ว
      <button onclick="this.parentElement.parentElement.remove()">✕</button>
    </div>
    <ul>${items.join('')}</ul>`;
  document.getElementById('tablesGrid').insertAdjacentElement('beforebegin', div);
}

// ═══════════════════════════════════════════════════════════
//  DOWNLOAD
// ═══════════════════════════════════════════════════════════
const MAP_HEADERS = ['file','ลำดับ','column_name','source_sql_type','raw_type','logical_type','final_type','nullable','is_pk','fk_ref'];

function toMappingRows(backendCols) {
  return backendCols.map((c, i) => ({
    'ลำดับ'          : i + 1,
    column_name     : c.column_name,
    file            : c.file            || '',
    raw_type        : c.raw_type        || '',
    logical_type    : c.logical_type    || '',
    final_type      : c.final_type      || '',
    source_sql_type : c.source_sql_type || '',
    nullable        : c.nullable        || 'NULL',
    is_pk           : c.is_pk ? 'PK' : 'no',
    fk_ref          : c.fk ? `${c.fk.ref_table}.${c.fk.ref_column || '?'}` : 'no',
  }));
}

async function downloadTable(key, fmt) {
  const t = currentData[key];
  if (!t) return;

  if (t.backendCols && sessionId && fmt === 'csv') {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/export/${sessionId}/csv/${key}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || res.statusText);
      triggerDownload(await res.blob(), `${key}.csv`);
    } catch (err) {
      showStatus('convertStatus', 'error', '❌ ' + err.message);
    } finally { setLoading(false); }
    return;
  }

  const headers = t.backendCols ? MAP_HEADERS : t.headers;
  const rows    = t.backendCols ? toMappingRows(t.backendCols) : t.rows;
  const name    = t.backendCols ? key + '_mapping' : key;

  if (fmt === 'csv') {
    const body = [headers.map(escCSV).join(','),
      ...rows.map(r => headers.map(h => escCSV(r[h] ?? '')).join(','))
    ].join('\n');
    triggerDownload(new Blob(['\uFEFF' + body], { type: 'text/csv;charset=utf-8;' }), name + '.csv');
  } else {
    const wb = XLSX.utils.book_new();
    const ws = makeSheet(rows, headers);
    if (t.backendCols) ws['!cols'] = [{wch:8},{wch:24},{wch:16},{wch:14},{wch:14},{wch:20},{wch:32},{wch:12}];
    XLSX.utils.book_append_sheet(wb, ws, 'data');
    XLSX.writeFile(wb, name + '.xlsx');
  }
}

async function downloadAllCSV() {
  const keys = Object.keys(currentData);
  if (!keys.length) return;

  const hasSql = keys.some(k => currentData[k].backendCols);
  if (hasSql && sessionId) {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/export/${sessionId}/csv`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || res.statusText);
      triggerDownload(await res.blob(), 'confluent_mapping.csv');
      showStatus('convertStatus', 'success', '✓ ดาวน์โหลด CSV สำเร็จ');
    } catch (err) {
      showStatus('convertStatus', 'error', '❌ ' + err.message);
    } finally { setLoading(false); }
    return;
  }
  const sections = keys.map(k => {
    const t       = currentData[k];
    const headers = t.backendCols ? MAP_HEADERS : t.headers;
    const rows    = t.backendCols ? toMappingRows(t.backendCols) : t.rows;
    const head    = headers.map(escCSV).join(',');
    const body    = rows.map(r => headers.map(h => escCSV(r[h] ?? '')).join(',')).join('\n');
    return `### ${k}\n${head}\n${body}`;
  });

  triggerDownload(
    new Blob(['\uFEFF' + sections.join('\n\n')], { type: 'text/csv;charset=utf-8;' }),
    'all_tables_' + Date.now() + '.csv'
  );
  showStatus('convertStatus', 'success', '✓ ดาวน์โหลด CSV สำเร็จ');
}

function downloadAllExcel() {
  const keys = Object.keys(currentData);
  if (!keys.length) return;
  const wb = XLSX.utils.book_new();

  keys.forEach(k => {
    const t       = currentData[k];
    const headers = t.backendCols ? MAP_HEADERS : t.headers;
    const rows    = t.backendCols ? toMappingRows(t.backendCols) : t.rows;
    const ws      = makeSheet(rows, headers);
    if (t.backendCols) ws['!cols'] = [{wch:8},{wch:24},{wch:16},{wch:14},{wch:14},{wch:20},{wch:32},{wch:12}];
    XLSX.utils.book_append_sheet(wb, ws, k.substring(0, 31));
  });

  XLSX.writeFile(wb, 'all_tables_' + Date.now() + '.xlsx');
  showStatus('convertStatus', 'success', '✓ ดาวน์โหลด Excel สำเร็จ');
}

// สร้าง worksheet รองรับทั้ง rows มีข้อมูลและ rows ว่าง
function makeSheet(rows, headers) {
  if (rows.length) return XLSX.utils.json_to_sheet(rows, { header: headers });
  return XLSX.utils.aoa_to_sheet([headers]);  // headers-only เมื่อไม่มีข้อมูล
}

function dlCSV(name, table) {
  const body = [table.headers.map(escCSV).join(','),
    ...table.rows.map(r => table.headers.map(h => escCSV(r[h] ?? '')).join(','))
  ].join('\n');
  triggerDownload(new Blob(['\uFEFF' + body], { type: 'text/csv;charset=utf-8;' }), name + '.csv');
}

function dlExcel(name, table) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, makeSheet(table.rows, table.headers), name.substring(0, 31));
  XLSX.writeFile(wb, name + '.xlsx');
}

function escCSV(v) {
  const s = String(v);
  return (s.includes(',')||s.includes('"')||s.includes('\n')) ? '"'+s.replace(/"/g,'""')+'"' : s;
}

function triggerDownload(blob, filename) {
  const a = Object.assign(document.createElement('a'),
    { href: URL.createObjectURL(blob), download: filename, style: 'display:none' });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

// ═══════════════════════════════════════════════════════════
//  FULLSCREEN TABLE MODAL
// ═══════════════════════════════════════════════════════════
let _modalKey      = null;
let _modalSort     = { col: null, dir: 'asc' };
let _modalFilter   = '';

function openTableModal(key) {
  _modalKey    = key;
  _modalSort   = { col: null, dir: 'asc' };
  _modalFilter = '';

  const t     = currentData[key];
  const isSql = !!t.backendCols;
  const cols  = isSql ? MAP_HEADERS : t.headers;
  const src   = isSql ? toMappingRows(t.backendCols) : t.rows;

  // Build overlay
  const overlay = document.createElement('div');
  overlay.className = 'table-modal-overlay';
  overlay.id        = 'tableModalOverlay';
  overlay.addEventListener('click', e => { if (e.target === overlay) closeTableModal(); });

  overlay.innerHTML = `
    <div class="table-modal" id="tableModal">
      <div class="table-modal-header">
        <div class="table-modal-icon">${isSql ? '🗃️' : '📊'}</div>
        <div style="min-width:0;flex:1">
          <div class="table-modal-title">${key}</div>
          <div class="table-modal-meta">${cols.length} cols · ${src.length.toLocaleString()} rows · ${t.fileName}</div>
        </div>
        <div class="table-modal-search">
          <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input type="text" id="modalSearchInput" placeholder="ค้นหา..." oninput="onModalSearch(this.value)" autocomplete="off">
        </div>
        <button class="table-modal-close" onclick="closeTableModal()" title="ปิด (Esc)">✕</button>
      </div>
      <div class="table-modal-toolbar">
        ${isSql ? `
        <button class="btn-card-dl xlsx" style="flex:0;padding:6px 14px;font-size:0.75em"
          onclick="downloadTableXLSX('${key}')">⬇ Mapping XLSX</button>
        ` : `
        <button class="btn-card-dl csv" style="flex:0;padding:6px 14px;font-size:0.75em"
          onclick="downloadTable('${key}','csv')">⬇ CSV</button>
        <button class="btn-card-dl xlsx" style="flex:0;padding:6px 14px;font-size:0.75em"
          onclick="downloadTable('${key}','xlsx')">⬇ XLSX</button>
        `}
        <div class="modal-row-count" id="modalRowCount">
          แสดง <span id="modalVisibleCount">${src.length.toLocaleString()}</span> / ${src.length.toLocaleString()} แถว
        </div>
      </div>
      <div class="table-modal-body" id="tableModalBody">
        <!-- filled by renderModalTable -->
      </div>
    </div>`;

  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  renderModalTable(cols, src, isSql);

  // Focus search
  setTimeout(() => document.getElementById('modalSearchInput')?.focus(), 50);
}

function closeTableModal() {
  const overlay = document.getElementById('tableModalOverlay');
  if (overlay) overlay.remove();
  document.body.style.overflow = '';
  _modalKey = null;
}

function onModalSearch(val) {
  _modalFilter = val.toLowerCase().trim();
  const t     = currentData[_modalKey];
  if (!t) return;
  const isSql = !!t.backendCols;
  const cols  = isSql ? MAP_HEADERS : t.headers;
  const src   = isSql ? toMappingRows(t.backendCols) : t.rows;
  renderModalTable(cols, src, isSql);
}

function onModalSort(colIdx) {
  const t     = currentData[_modalKey];
  if (!t) return;
  const isSql = !!t.backendCols;
  const cols  = isSql ? MAP_HEADERS : t.headers;
  const src   = isSql ? toMappingRows(t.backendCols) : t.rows;

  const col = cols[colIdx];
  if (_modalSort.col === col) {
    _modalSort.dir = _modalSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    _modalSort.col = col;
    _modalSort.dir = 'asc';
  }
  renderModalTable(cols, src, isSql);
}

function renderModalTable(cols, src, isSql) {
  // 1. Filter
  let rows = src;
  if (_modalFilter) {
    rows = src.filter(r =>
      cols.some(h => String(r[h] ?? '').toLowerCase().includes(_modalFilter))
    );
  }

  // 2. Sort
  if (_modalSort.col) {
    const sc = _modalSort.col;
    const dir = _modalSort.dir === 'asc' ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      const av = String(a[sc] ?? ''), bv = String(b[sc] ?? '');
      const an = parseFloat(av), bn = parseFloat(bv);
      if (!isNaN(an) && !isNaN(bn)) return (an - bn) * dir;
      return av.localeCompare(bv) * dir;
    });
  }

  // 3. Update row count
  const countEl = document.getElementById('modalVisibleCount');
  if (countEl) countEl.textContent = rows.length.toLocaleString();

  // 4. Build table HTML
  const hl = _modalFilter;

  function hlCell(val) {
    const s = String(val ?? '');
    if (!hl) return s;
    const idx = s.toLowerCase().indexOf(hl);
    if (idx === -1) return s;
    return s.slice(0, idx) + '<mark>' + s.slice(idx, idx + hl.length) + '</mark>' + s.slice(idx + hl.length);
  }

  const theadHtml = cols.map((h, i) => {
    const isSorted = _modalSort.col === h;
    const sortCls  = isSorted ? (_modalSort.dir === 'asc' ? 'sorted-asc' : 'sorted-desc') : '';
    const icon     = isSorted ? (_modalSort.dir === 'asc' ? '▲' : '▼') : '⇅';
    const numCls   = (i === 0 && isSql) ? 'modal-th-num' : '';
    return `<th class="${sortCls} ${numCls}" onclick="onModalSort(${i})" title="${h}">
      ${h}<span class="sort-icon">${icon}</span>
    </th>`;
  }).join('');

  let tbodyHtml;
  if (!rows.length) {
    tbodyHtml = `<tr><td colspan="${cols.length}" class="modal-no-results">
      <span>🔍</span>ไม่พบข้อมูลที่ตรงกับ "${_modalFilter}"
    </td></tr>`;
  } else {
    tbodyHtml = rows.map((r, ri) =>
      `<tr>
        ${cols.map((h, ci) => {
          const cls = (ci === 0 && isSql) ? 'modal-td-num' : '';
          return `<td class="${cls}" title="${String(r[h] ?? '')}">${hlCell(r[h])}</td>`;
        }).join('')}
      </tr>`
    ).join('');
  }

  const body = document.getElementById('tableModalBody');
  if (!body) return;
  body.innerHTML = `
    <table class="modal-preview-table">
      <thead><tr>${theadHtml}</tr></thead>
      <tbody>${tbodyHtml}</tbody>
    </table>`;
}

// Close modal on Esc
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && _modalKey) closeTableModal();
});

// ═══════════════════════════════════════════════════════════
//  UI HELPERS
// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
//  DUPLICATE DETECTION
// ═══════════════════════════════════════════════════════════

// คำนวณ hash แบบเร็ว (FNV-1a 32-bit) สำหรับเปรียบเทียบเนื้อหา
function _fnv32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16);
}

// อ่านไฟล์เป็น text (สำหรับ SQL และ CSV)
function _readAsText(file) {
  return new Promise(resolve => {
    const r = new FileReader();
    r.onload = e => resolve(e.target.result || '');
    r.onerror = () => resolve('');
    r.readAsText(file, 'utf-8');
  });
}

// ตรวจ duplicate ก่อน process — คืน array ของ issues ที่พบ
async function detectDuplicates(files) {
  const issues   = [];
  const nameSet  = new Map();   // name → index
  const hashSet  = new Map();   // hash → filename
  const tableSet = new Map();   // tableName → filename (SQL only)

  for (const file of files) {
    const nameLower = file.name.toLowerCase();

    // 1. ชื่อไฟล์ซ้ำ
    if (nameSet.has(nameLower)) {
      issues.push({
        type  : 'filename',
        label : '📄 ชื่อไฟล์ซ้ำ',
        detail: `"${file.name}" ซ้ำกับไฟล์ที่อัปโหลด`,
        files : [nameSet.get(nameLower), file.name],
      });
    } else {
      nameSet.set(nameLower, file.name);
    }

    // 2. เนื้อหาไฟล์ซ้ำ (hash) — ตรวจเฉพาะ SQL และ CSV
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'sql' || ext === 'csv') {
      const text = await _readAsText(file);
      const hash = _fnv32(text.replace(/\s+/g, ' ').trim());  // normalize whitespace
      if (hashSet.has(hash)) {
        issues.push({
          type  : 'content',
          label : '🔁 เนื้อหาเหมือนกัน',
          detail: `"${file.name}" มีเนื้อหาเหมือนกับ "${hashSet.get(hash)}" ทุกประการ`,
          files : [hashSet.get(hash), file.name],
        });
      } else {
        hashSet.set(hash, file.name);
      }

      // 3. Table name ซ้ำข้ามไฟล์ SQL
      if (ext === 'sql') {
        const tableMatches = [...text.matchAll(
          /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-zA-Z0-9_."`\[\]]+)\s*\(/gi
        )];
        for (const m of tableMatches) {
          const tname = m[1].replace(/["`\[\]]/g, '').split('.').pop().toLowerCase();
          if (tableSet.has(tname)) {
            issues.push({
              type  : 'table',
              label : '🗃️ Table ซ้ำข้ามไฟล์',
              detail: `Table "${tname}" พบทั้งใน "${tableSet.get(tname)}" และ "${file.name}"`,
              files : [tableSet.get(tname), file.name],
            });
          } else {
            tableSet.set(tname, file.name);
          }
        }
      }
    }
  }

  return issues;
}

// แสดง modal ให้ผู้ใช้ verify — คืน Promise<'proceed'|'cancel'>
function showDuplicateModal(issues, files) {
  return new Promise(resolve => {
    document.getElementById('dupModalOverlay')?.remove();

    const rows = issues.map(iss => `
      <tr>
        <td><span class="dup-type-badge">${iss.label}</span></td>
        <td class="dup-detail">${iss.detail}</td>
      </tr>`).join('');

    const overlay = document.createElement('div');
    overlay.id        = 'dupModalOverlay';
    overlay.className = 'dup-modal-overlay';
    overlay.innerHTML = `
      <div class="dup-modal">
        <div class="dup-modal-icon">⚠️</div>
        <div class="dup-modal-title">พบข้อมูลที่อาจซ้ำกัน — กรุณา Verify ก่อนดำเนินการ</div>
        <div class="dup-modal-sub">
          ตรวจพบ <strong>${issues.length}</strong> รายการที่ต้องระวัง
          จากไฟล์ที่อัปโหลดทั้งหมด <strong>${files.length}</strong> ไฟล์
        </div>
        <table class="dup-table">
          <thead><tr><th>ประเภท</th><th>รายละเอียด</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="dup-modal-hint">
          หากแน่ใจว่าต้องการดำเนินการต่อ คลิก <b>ดำเนินการต่อ</b>
          หรือ <b>ยกเลิก</b> เพื่อเลือกไฟล์ใหม่
        </div>
        <div class="dup-modal-actions">
          <button class="dup-btn-cancel"   id="dupBtnCancel">✕ ยกเลิก</button>
          <button class="dup-btn-proceed"  id="dupBtnProceed">✓ ดำเนินการต่อ</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    document.getElementById('dupBtnProceed').onclick = () => {
      overlay.remove();
      resolve('proceed');
    };
    document.getElementById('dupBtnCancel').onclick = () => {
      overlay.remove();
      resolve('cancel');
    };
  });
}


function renderFileChip(name, type) {
  const div = document.createElement('div');
  div.className = 'file-item';
  div.innerHTML = `
    <span class="file-type-badge ${type}">${type.toUpperCase()}</span>
    <span class="file-name" title="${name}">${name}</span>
    <button class="file-remove" onclick="this.parentElement.remove()">✕</button>`;
  document.getElementById('fileList').appendChild(div);
}

function clearUI() {
  document.getElementById('tablesGrid').innerHTML = `
    <div class="empty-state">
      <div class="empty-state-icon">🗄️</div>
      <div class="empty-state-text">อัปโหลดไฟล์ CSV, Excel หรือ SQL เพื่อเริ่มต้น</div>
    </div>`;
  document.getElementById('bulkSection').classList.remove('visible');
  document.getElementById('typeTableBody').innerHTML =
    '<tr><td colspan="3"><div class="empty-hint">No file loaded</div></td></tr>';
  const card = document.getElementById('sessionCard');
  if (card) card.style.display = 'none';
  document.getElementById('unknownWarnings')?.remove();
  document.getElementById('byteAnomalyWarnings')?.remove();
  updateStats(0,0,0);
  updateBadges(0,0,'ready');
}

function updateStats(files, tables, rows) {
  document.getElementById('statFiles').textContent  = files;
  document.getElementById('statTables').textContent = tables;
  document.getElementById('statRows').textContent   = rows.toLocaleString();
}

function updateBadges(tables, rows, status) {
  document.getElementById('badgeTables').textContent = tables+' tables';
  document.getElementById('badgeRows').textContent   = rows.toLocaleString()+' rows';
  const b = document.getElementById('badgeStatus');
  b.textContent = status;
  b.className   = 'badge' + ({mapped:' converted', loaded:' active'}[status] || '');
}

function showStatus(id, type, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className   = 'status-bar '+type+' show';
  if (type === 'success') setTimeout(() => el.classList.remove('show'), 4000);
}

function setLoading(on) {
  document.getElementById('loadingBar').classList.toggle('active', on);
}

// ── Health check ──────────────────────────────────────────
async function checkHealth() {
  try {
    const res = await fetch(`${API_BASE}/health`);
    setBackendStatus(res.ok && (await res.json()).status === 'ok');
  } catch { setBackendStatus(false); }
}

function setBackendStatus(ok) {
  const dot = document.getElementById('backendDot');
  const lbl = document.getElementById('backendLabel');
  if (!dot||!lbl) return;
  dot.className   = 'status-dot '+(ok?'online':'offline');
  lbl.textContent = ok ? 'API Online' : 'API Offline';
}

// ─── Theme Toggle ─────────────────────────────────────────
function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  document.getElementById('btnDark').classList.toggle('active',  theme === 'dark');
  document.getElementById('btnLight').classList.toggle('active', theme === 'light');
}

// ── Init ──────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  setTheme(localStorage.getItem('theme') || 'dark');
  checkHealth();
  setInterval(checkHealth, 30_000);
});

// ── Download Confluent XLSX (via backend) ─────────────────
async function downloadAllXLSX() {
  const keys = Object.keys(currentData).filter(k => currentData[k].backendCols);
  if (!keys.length) {
    showStatus('convertStatus', 'error', '❌ ไม่มีข้อมูล SQL — กรุณาอัปโหลดไฟล์ SQL ก่อน');
    return;
  }

  // รวมทุกตารางส่งไป backend ทีเดียว
  const tables = {};
  keys.forEach(k => { tables[k] = currentData[k].backendCols; });

  setLoading(true);
  try {
    const res = await fetch(`${API_BASE}/export/${sessionId}/xlsx`);
    if (!res.ok) throw new Error((await res.json().catch(()=>({}))).detail || res.statusText);

    const blob = await res.blob();
    triggerDownload(blob, 'confluent_mapping.xlsx');
    showStatus('convertStatus', 'success', '✓ ดาวน์โหลด XLSX สำเร็จ');
  } catch (err) {
    showStatus('convertStatus', 'error', '❌ ' + err.message);
  } finally {
    setLoading(false);
  }
}

async function downloadTableXLSX(tableName) {
  const t = currentData[tableName];
  if (!t?.backendCols) {
    showStatus('convertStatus', 'error', '❌ ไม่มีข้อมูล SQL สำหรับตารางนี้');
    return;
  }

  setLoading(true);
  try {
    const res = await fetch(`${API_BASE}/export/${sessionId}/xlsx/${tableName}`);
    if (!res.ok) throw new Error((await res.json().catch(()=>({}))).detail || res.statusText);

    const blob = await res.blob();
    triggerDownload(blob, `${tableName}.xlsx`);
    showStatus('convertStatus', 'success', `✓ ดาวน์โหลด ${tableName}.xlsx สำเร็จ`);
  } catch (err) {
    showStatus('convertStatus', 'error', '❌ ' + err.message);
  } finally {
    setLoading(false);
  }
}

window.addEventListener('beforeunload', () => {
  if (sessionId) navigator.sendBeacon(`${API_BASE}/session/${sessionId}`, '{}');
});
