// ================================================================
// app.js — Frontend Client for Python Backend
// ================================================================

const API_BASE = 'http://localhost:8000/api';

const State = {
  step: 0,
  csvText: null,
  triangle: null,
  summary: null,
  recommendation: null,
  selectedMethod: null,
  customLDFs: null,
  ldfBase: 'volumeWeighted',
  methodParams: {},
  chatHistory: [],
  apiKey: '',
};

const STEPS = ['Upload', 'Data Summary', 'Loss Triangle', 'Select Model', 'IBNR Results'];

document.addEventListener('DOMContentLoaded', () => {
  setupDropzone();
  setupChat();
  setupAPIKey();
  renderStepBar();
  setRightPanel('upload');
  addAgentMessage('system', 'Backend architecture active. Please start the Python server, then upload a CSV file.');
});

// ── API Key ───────────────────────────────────────────────────────
function setupAPIKey() {
  const btn = document.getElementById('api-key-btn');
  const modal = document.getElementById('api-key-modal');
  const input = document.getElementById('api-key-input');
  const save = document.getElementById('api-key-save');
  const cancel = document.getElementById('api-key-cancel');
  const ind = document.getElementById('api-key-indicator');

  const stored = localStorage.getItem('gemini_api_key');
  if (stored) {
    State.apiKey = stored;
    ind.classList.add('connected');
    ind.title = 'Gemini API connected';
  }

  btn.addEventListener('click', () => { input.value = State.apiKey; modal.classList.add('open'); });
  save.addEventListener('click', () => {
    const key = input.value.trim();
    if (!key) { showToast('Please enter a valid API key.', 'error'); return; }
    State.apiKey = key;
    localStorage.setItem('gemini_api_key', key);
    ind.classList.add('connected');
    modal.classList.remove('open');
    showToast('API key saved for backend.', 'success');
  });
  cancel.addEventListener('click', () => modal.classList.remove('open'));
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('open'); });
}

// ── UI Helpers ────────────────────────────────────────────────────
function renderStepBar() {
  document.getElementById('step-bar').innerHTML = STEPS.map((label, i) => `
    <div class="step-item ${i < State.step ? 'done' : i === State.step ? 'active' : 'pending'}">
      <div class="step-dot">${i < State.step ? '✓' : i + 1}</div>
      <div class="step-label">${label}</div>
    </div>
    ${i < STEPS.length - 1 ? '<div class="step-line ' + (i < State.step ? 'done' : '') + '"></div>' : ''}
  `).join('');
}

function advanceStep(n) { State.step = n; renderStepBar(); }

let _msgId = 0;
function addAgentMessage(type, html, state = '') {
  const id = `msg-${++_msgId}`;
  const log = document.getElementById('agent-log');
  const icon = { system: '⬡', agent: '◆', action: '→', error: '✕', warn: '⚠' }[type] || '●';
  log.insertAdjacentHTML('beforeend', `<div class="agent-msg type-${type} ${state ? 'state-'+state : ''}" id="${id}"><span class="msg-icon">${icon}</span><span class="msg-body">${html}</span></div>`);
  log.scrollTop = log.scrollHeight;
  return id;
}

function updateAgentMessage(id, html) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('state-analyzing');
  el.querySelector('.msg-body').innerHTML = html;
  el.parentElement.scrollTop = el.parentElement.scrollHeight;
}

function showToast(msg, type = 'info') {
  let toast = document.getElementById('toast');
  if (!toast) { toast = document.createElement('div'); toast.id = 'toast'; document.body.appendChild(toast); }
  toast.className = `toast toast-${type} show`;
  toast.textContent = msg;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 3500);
}

function fmt(n) {
  if (n == null || isNaN(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtShort(n) {
  if (n == null || isNaN(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return n.toFixed(0);
}

// ── Views ─────────────────────────────────────────────────────────
function setRightPanel(view, data = {}) {
  const panel = document.getElementById('right-panel');
  panel.innerHTML = '';
  switch (view) {
    case 'upload':       panel.innerHTML = renderUploadView(); setupDropzone(); break;
    case 'summary':      panel.innerHTML = renderSummaryView(data); break;
    case 'triangle':     panel.innerHTML = renderTriangleView(); setupLDFEditing(); break;
    case 'model-select': panel.innerHTML = renderModelSelectView(data); break;
    case 'params':       panel.innerHTML = renderParamsView(data); break;
    case 'results':      panel.innerHTML = renderResultsView(data); break;
  }
}

function renderUploadView() {
  return `
    <div class="view-header"><h2>Upload Loss Data</h2><p class="view-sub">API powered by Python Backend</p></div>
    <div class="dropzone" id="dropzone"><div class="dz-icon">↑</div><div class="dz-title">Drop CSV file here</div><input type="file" id="file-input" accept=".csv,.txt" style="display:none"></div>
  `;
}

function setupDropzone() {
  const dz = document.getElementById('dropzone');
  const input = document.getElementById('file-input');
  if (!dz || !input) return;
  dz.addEventListener('click', () => input.click());
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('drag-over'); processFile(e.dataTransfer.files[0]); });
  input.addEventListener('change', () => processFile(input.files[0]));
}

async function processFile(file) {
  if (!file) return;
  addAgentMessage('system', `Uploading to backend: <strong>${file.name}</strong>...`);
  
  const formData = new FormData();
  formData.append('file', file);
  if (State.apiKey) formData.append('api_key', State.apiKey);

  try {
    const res = await fetch(`${API_BASE}/upload`, { method: 'POST', body: formData });
    const data = await res.json();
    
    if (!data.success) throw new Error(data.error);
    
    State.csvText = data.csv_text;
    State.summary = data.summary;
    State.triangle = data.triangle;
    State.customLDFs = null; // Clear any cached LDFs from previous runs
    
    addAgentMessage('system', `✓ Processed by Python backend.`);
    if (data.narration) addAgentMessage('agent', data.narration);
    
    advanceStep(1);
    setRightPanel('summary', State.summary);
  } catch (e) {
    showToast('Backend Error: ' + e.message, 'error');
    addAgentMessage('error', `Failed to process: ${e.message}`);
  }
}

function renderSummaryView(s) {
  return `
    <div class="view-header"><h2>Data Summary</h2></div>
    <div class="summary-grid">
      <div class="summary-card"><div class="sc-label">Accident Years</div><div class="sc-value">${s.accidentYears}</div><div class="sc-detail">${s.oldestAY} – ${s.latestAY}</div></div>
      <div class="summary-card"><div class="sc-label">Dev Periods</div><div class="sc-value">${s.devPeriods}</div><div class="sc-detail">Max: ${s.maxDevAge}m</div></div>
      <div class="summary-card"><div class="sc-label">Total Paid</div><div class="sc-value">${fmt(s.totalPaid)}</div><div class="sc-detail">latest diagonal</div></div>
      <div class="summary-card"><div class="sc-label">Premium Data</div><div class="sc-value">${s.hasPremium ? 'Yes ✓' : 'No'}</div></div>
    </div>
    <div style="margin-top:24px; text-align:right;"><button class="btn-run" onclick="viewTriangle()">Generate Loss Triangle →</button></div>`;
}

function viewTriangle() {
  advanceStep(2);
  if (!State.customLDFs) {
    State.customLDFs = State.triangle.ldfs.slice(0, -1).map(s => s[State.ldfBase] ?? 1.0);
  }
  setRightPanel('triangle');
}

function renderTriangleView() {
  const t = State.triangle;
  const triRows = t.accidentYears.map((ay, i) => {
    const cells = t.devAges.map((dev, j) => {
      const v = t.matrix[i][j];
      return `<td class="tri-cell ${v === null ? 'empty' : ''}">${v !== null ? fmtShort(v) : '—'}</td>`;
    }).join('');
    return `<tr><td class="tri-ay">${ay}</td>${cells}</tr>`;
  }).join('');

  const rowHtml = (label, key) => {
    const cells = t.ldfs.slice(0, -1).map(s => `<td class="ldf-cell ${State.ldfBase === key ? 'active-base' : ''}">${s[key] ? s[key].toFixed(3) : '—'}</td>`).join('');
    return `<tr class="ldf-row ${State.ldfBase === key ? 'active-row' : ''}"><td class="tri-ay">${label}</td>${cells}<td></td></tr>`;
  };

  const selRow = State.customLDFs.map((v, j) => `<td class="ldf-cell"><input type="number" class="ldf-input" data-idx="${j}" value="${v.toFixed(4)}" step="0.001"></td>`).join('');
  const devHeaders = t.devAges.map(d => `<th>${d}m</th>`).join('');

  return `
    <div class="view-header">
      <h2>Loss Development Triangle</h2>
      <div class="view-actions">
        <select id="ldf-base-select" onchange="changeLDFBase(this.value)" class="param-input" style="height:32px;">
          <option value="volumeWeighted" ${State.ldfBase === 'volumeWeighted' ? 'selected' : ''}>Vol. Weighted Avg</option>
          <option value="straightAvg" ${State.ldfBase === 'straightAvg' ? 'selected' : ''}>Straight Avg</option>
          <option value="weighted3yr" ${State.ldfBase === 'weighted3yr' ? 'selected' : ''}>3-Year Weighted Avg</option>
          <option value="weighted5yr" ${State.ldfBase === 'weighted5yr' ? 'selected' : ''}>5-Year Weighted Avg</option>
        </select>
      </div>
    </div>
    <div class="table-scroll">
      <table class="tri-table">
        <thead><tr><th>AY ╲ Dev</th>${devHeaders}</tr></thead>
        <tbody>
          ${triRows}
          ${rowHtml('Vol. Wtd', 'volumeWeighted')}
          ${rowHtml('Straight', 'straightAvg')}
          ${rowHtml('3-Year', 'weighted3yr')}
          ${rowHtml('5-Year', 'weighted5yr')}
          <tr class="ldf-row sel-row"><td class="tri-ay">Selected LDF</td>${selRow}<td class="ldf-cell tail">1.000 (tail)</td></tr>
        </tbody>
      </table>
    </div>
    <div style="margin-top:24px; text-align:right;"><button class="btn-run" onclick="runAnalysis()">Run Analysis & Select Model →</button></div>`;
}

function setupLDFEditing() {
  document.querySelectorAll('.ldf-input').forEach(input => {
    input.addEventListener('change', () => { State.customLDFs[parseInt(input.dataset.idx)] = parseFloat(input.value); });
  });
}

window.changeLDFBase = function(base) {
  State.ldfBase = base;
  State.customLDFs = State.triangle.ldfs.slice(0, -1).map(s => s[base] ?? 1.0);
  setRightPanel('triangle');
};

async function runAnalysis() {
  advanceStep(3);
  const msgId = addAgentMessage('agent', '🤖 <strong>Analysis Agent</strong> evaluating methods on Python backend…', 'analyzing');

  try {
    const res = await fetch(`${API_BASE}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv_text: State.csvText, api_key: State.apiKey })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    State.recommendation = data.recommendation;
    setRightPanel('model-select', data.recommendation);
    
    if (data.narration) updateAgentMessage(msgId, data.narration);
    else updateAgentMessage(msgId, 'Analysis complete.');
  } catch (e) {
    updateAgentMessage(msgId, 'Analysis failed: ' + e.message);
  }
}

function renderModelSelectView({ ranked, warnings }) {
  const cards = ranked.map(m => `
    <div class="method-card ${m.recommended ? 'recommended' : ''} ${m.score <= 1 ? 'disabled' : ''}" onclick="selectMethod('${m.code}')">
      <div class="mc-header"><div class="mc-code">${m.code}</div><div class="mc-label">${m.label}</div></div>
      <div class="mc-desc">${m.desc}</div>
      <div class="mc-score-bar"><div class="mc-score-fill" style="width:${Math.min(m.score * 12, 100)}%"></div></div>
    </div>`).join('');
  return `<div class="view-header"><h2>Select Method</h2></div><div class="method-grid">${cards}</div>`;
}

window.selectMethod = function(code) {
  State.selectedMethod = code;
  // Hardcode params req for now since we don't fetch MethodClass logic
  const params = code === 'BF' || code === 'BK' ? [{key: 'aprioriLossRatio', label: 'A Priori Loss Ratio', default: 0.65}] : [];
  if (params.length > 0) setRightPanel('params', { code, params });
  else submitParams(code);
};

function renderParamsView({ code, params }) {
  const fields = params.map(p => `<div class="param-field"><label>${p.label}</label><input type="number" id="param-${p.key}" class="param-input" data-key="${p.key}" value="${p.default}" step="any"></div>`).join('');
  return `<div class="view-header"><h2>Parameters</h2></div><div class="params-container">${fields}<button class="btn-run" onclick="submitParams('${code}')">Execute →</button></div>`;
}

window.submitParams = async function(code) {
  const params = {};
  document.querySelectorAll('.param-input').forEach(i => params[i.dataset.key] = parseFloat(i.value));

  advanceStep(4);
  const msgId = addAgentMessage('agent', `⚙️ <strong>Execution Agent</strong> running ${code} on backend…`, 'analyzing');

  try {
    const res = await fetch(`${API_BASE}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        csv_text: State.csvText,
        method_code: code,
        params: params,
        custom_ldfs: [...State.customLDFs, 1.0], // add tail
        api_key: State.apiKey
      })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    setRightPanel('results', data);
    
    if (data.narration) updateAgentMessage(msgId, data.narration);
    else updateAgentMessage(msgId, 'Execution complete.');
  } catch (e) {
    updateAgentMessage(msgId, 'Execution failed: ' + e.message);
  }
};

function renderResultsView(data) {
  const rows = data.results.map(r => `<tr><td class="col-ay">${r.ay}</td><td>${fmt(r.paid)}</td><td>${fmt(r.ultimate)}</td><td>${fmt(r.ibnr)}</td></tr>`).join('');
  return `
    <div class="view-header"><h2>IBNR Results</h2><button class="btn-ghost" onclick="setRightPanel('model-select', State.recommendation); advanceStep(3);">← Back</button></div>
    <div class="kpi-strip">
      <div class="kpi-block"><div class="kpi-label">Total IBNR</div><div class="kpi-value">${fmt(data.totalIBNR)}</div></div>
      <div class="kpi-block"><div class="kpi-label">Total Ultimate</div><div class="kpi-value">${fmt(data.totalUlt)}</div></div>
    </div>
    <table class="results-table">
      <thead><tr><th>AY</th><th>Paid</th><th>Ultimate</th><th>IBNR</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function setupChat() {
  const input = document.getElementById('chat-input');
  const send = document.getElementById('chat-send');
  const submit = async () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    if (!State.apiKey) { showToast('API key required for chat.', 'error'); return; }
    
    addAgentMessage('user', escapeHTML(text));
    const typingId = addAgentMessage('agent', '…', 'analyzing');
    
    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: State.chatHistory,
          context_data: { summary: State.summary, results: State.results },
          api_key: State.apiKey
        })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      
      State.chatHistory.push({ role: 'user', text });
      State.chatHistory.push({ role: 'model', text: data.reply });
      updateAgentMessage(typingId, data.reply);
    } catch (e) {
      updateAgentMessage(typingId, 'Error: ' + e.message);
    }
  };
  send.addEventListener('click', submit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } });
}

function escapeHTML(str) { return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
