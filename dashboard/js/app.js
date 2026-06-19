// ================================================================
// app.js — Agentic Frontend Client
// ================================================================

// Dynamically set API_BASE based on where the frontend is hosted
const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const API_BASE = isLocalhost 
  ? 'http://localhost:8000/api' 
  : 'https://reserving-using-agentic-ai.onrender.com/api';

window.__DEMO_TEXT__ = `Line of Business: Private Passenger Auto Liability (short-tail line).

Data: 10 accident years of cumulative paid loss development data organized in a standard triangle format. No earned premium data is available in this dataset — only paid claims.

Environment: The business environment has been relatively stable over the past decade. No significant changes in claims processing systems, management philosophy, or settlement speed. No major tort reform in the operating jurisdiction.

Claims Profile: This is a high-frequency, low-severity portfolio. Claims are reported promptly and settle within 12–24 months in most cases. The average claim cost is modest, with no exposure to catastrophic single-loss events. Claims are evenly distributed throughout each accident year.

Distortions: No known distortions from unusually large claims. No significant CAT events affected this portfolio. No changes in case reserve adequacy or claims adjuster behavior during the observed period.

Data Volume: With 10 years of clean, consistent historical data, the triangle is credible enough for a data-driven development approach.`;

const State = {
  step: 0,
  sessionId: null,
  triangle: null,
  summary: null,
  recommendation: null,
  selectedMethod: null,
  customLDFs: null,
  ldfBase: 'volumeWeighted',
  methodParams: {},
  chatHistory: [],
  apiKey: '',
  baseUrl: '',
  modelName: '',
  pendingFile: null,
};

const STEPS = ['Ingestion Pipeline', 'Data Summary', 'Loss Triangle', 'Select Model', 'IBNR Results'];

document.addEventListener('DOMContentLoaded', () => {
  setupDropzone();
  setupChat();
  renderStepBar();
  setRightPanel('upload');
  addAgentMessage('system', 'Multi-Agent architecture active. Please start the Python server, then configure your parameters and upload a CSV file.');
});

// AI Settings handled universally on backend

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
  const rateChangesHTML = `
    <div style="margin-bottom: 24px; padding: 16px; background: rgba(255,255,255,0.05); border-radius: 8px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px;">
        <label style="font-weight:500;">Historical Rate Changes (Optional):</label>
        <button class="btn-ghost" onclick="addRateChangeRow()" style="font-size:12px; padding: 4px 8px;">+ Add Row</button>
      </div>
      <div id="rate-changes-container"></div>
      <div style="font-size: 11px; color: rgba(255,255,255,0.5); margin-top: 8px;">If provided, the Preprocessing Agent will on-level your premiums automatically before the Triangle Builder runs.</div>
    </div>
  `;

  const descriptionHTML = `
    <div style="margin-top: 20px; padding: 16px; background: rgba(167, 139, 250, 0.05); border: 1px solid rgba(167, 139, 250, 0.2); border-radius: 8px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px;">
        <label style="font-weight: 600; color: #a78bfa; font-size: 13px;">✦ Business & Data Context (for AI model recommendation)</label>
        <button class="btn-ghost" onclick="fillDemoDescription()" style="font-size:11px; padding: 3px 10px; color: #a78bfa; border-color: rgba(167,139,250,0.4);">Try Demo ✦</button>
      </div>
      <textarea
        id="business-description"
        rows="6"
        style="width: 100%; background: rgba(0,0,0,0.3); border: 1px solid rgba(167,139,250,0.3); border-radius: 6px; color: white; padding: 10px; font-size: 13px; resize: vertical; box-sizing: border-box; line-height: 1.5;"
        placeholder="Describe your data and business context to help the AI recommend the right model. Key points to include:
• Line of business (e.g., auto liability, workers' comp, property)
• Tail length (short-tail or long-tail?)
• Data volume & history (how many years of data?)
• Environment stability (any major changes in operations, legal environment, settlement speed?)
• Claims characteristics (high-frequency/low-severity vs large sporadic claims?)
• Any known distortions (large CAT events, case reserve changes?)"></textarea>
      <div style="font-size: 11px; color: rgba(255,255,255,0.4); margin-top: 6px;">The more detail you provide, the more accurate and specific the AI's model recommendation will be.</div>
    </div>
  `;

  return `
    <div class="view-header"><h2>Upload Loss Data</h2><p class="view-sub">Sequential Agent Pipeline</p></div>
    ${rateChangesHTML}
    <div class="dropzone" id="dropzone">
      <div class="dz-icon" id="dz-icon">↑</div>
      <div class="dz-title" id="dz-title">Drop CSV file here or click to browse</div>
      <input type="file" id="file-input" accept=".csv,.txt" style="display:none">
    </div>
    <div id="file-preview" style="display:none; margin-top:10px; padding:10px 14px; background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.3); border-radius:6px; align-items:center; gap:10px;">
      <span style="color:#10b981; font-size:18px;">✓</span>
      <span id="file-preview-name" style="color:#10b981; font-size:13px; font-weight:600; flex:1;"></span>
      <button onclick="clearSelectedFile()" style="background:none; border:none; color:rgba(255,255,255,0.4); cursor:pointer; font-size:16px; line-height:1;">✕</button>
    </div>
    ${descriptionHTML}
    <button id="submit-pipeline-btn" onclick="submitUpload()" disabled
      style="margin-top:24px; width:100%; padding:14px; border-radius:8px; border:none; cursor:not-allowed;
             background:rgba(255,255,255,0.06); color:rgba(255,255,255,0.3);
             font-size:15px; font-weight:700; letter-spacing:0.5px; transition:all 0.3s;">
      🚀 Run Pipeline →
    </button>
    <div id="submit-hint" style="font-size:11px; color:rgba(255,255,255,0.3); text-align:center; margin-top:8px;">Select a CSV file above to enable submission</div>
  `;
}


window.fillDemoDescription = function() {
  const el = document.getElementById('business-description');
  if (el) {
    el.value = window.__DEMO_TEXT__;
    el.style.borderColor = 'rgba(167,139,250,0.6)';
    setTimeout(() => { el.style.borderColor = 'rgba(167,139,250,0.3)'; }, 800);
  }
}

window.addRateChangeRow = function() {
  const container = document.getElementById('rate-changes-container');
  if(!container) return;
  const row = document.createElement('div');
  row.style = "display:flex; gap:8px; margin-bottom:8px;";
  row.innerHTML = `
    <input type="date" class="rc-date" style="flex:1; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: white; padding: 8px; border-radius: 4px;">
    <input type="number" class="rc-pct" placeholder="Change % (e.g. 5)" step="any" style="flex:1; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: white; padding: 8px; border-radius: 4px;">
    <button class="btn-ghost" onclick="this.parentElement.remove()" style="padding: 8px;">✕</button>
  `;
  container.appendChild(row);
}

function setupDropzone() {
  const dz = document.getElementById('dropzone');
  const input = document.getElementById('file-input');
  if (!dz || !input) return;
  dz.addEventListener('click', () => input.click());
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('drag-over'); previewFile(e.dataTransfer.files[0]); });
  input.addEventListener('change', () => previewFile(input.files[0]));
}

function previewFile(file) {
  if (!file) return;
  State.pendingFile = file;
  // Update dropzone appearance
  const dz = document.getElementById('dropzone');
  const dzTitle = document.getElementById('dz-title');
  const dzIcon = document.getElementById('dz-icon');
  if (dz) dz.style.borderColor = 'rgba(16,185,129,0.5)';
  if (dzIcon) dzIcon.textContent = '📄';
  if (dzTitle) dzTitle.textContent = 'File selected — see preview below';
  // Show preview bar
  const preview = document.getElementById('file-preview');
  const previewName = document.getElementById('file-preview-name');
  if (preview) { preview.style.display = 'flex'; }
  if (previewName) previewName.textContent = `${file.name}  (${(file.size/1024).toFixed(1)} KB)`;
  // Enable submit button
  const btn = document.getElementById('submit-pipeline-btn');
  const hint = document.getElementById('submit-hint');
  if (btn) {
    btn.disabled = false;
    btn.style.cursor = 'pointer';
    btn.style.background = 'linear-gradient(135deg, #a78bfa, #10b981)';
    btn.style.color = 'white';
    btn.style.boxShadow = '0 4px 20px rgba(167,139,250,0.4)';
  }
  if (hint) hint.textContent = 'All inputs ready — click to launch the pipeline';
}

window.clearSelectedFile = function() {
  State.pendingFile = null;
  const dz = document.getElementById('dropzone');
  const dzTitle = document.getElementById('dz-title');
  const dzIcon = document.getElementById('dz-icon');
  if (dz) dz.style.borderColor = '';
  if (dzIcon) dzIcon.textContent = '↑';
  if (dzTitle) dzTitle.textContent = 'Drop CSV file here or click to browse';
  const preview = document.getElementById('file-preview');
  if (preview) preview.style.display = 'none';
  const btn = document.getElementById('submit-pipeline-btn');
  const hint = document.getElementById('submit-hint');
  if (btn) {
    btn.disabled = true;
    btn.style.cursor = 'not-allowed';
    btn.style.background = 'rgba(255,255,255,0.06)';
    btn.style.color = 'rgba(255,255,255,0.3)';
    btn.style.boxShadow = 'none';
  }
  if (hint) hint.textContent = 'Select a CSV file above to enable submission';
  const fi = document.getElementById('file-input');
  if (fi) fi.value = '';
}

window.submitUpload = function() {
  if (!State.pendingFile) { showToast('Please select a CSV file first.', 'error'); return; }
  const btn = document.getElementById('submit-pipeline-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Launching...'; }
  processFile(State.pendingFile);
  State.pendingFile = null;
}

async function processFile(file) {
  if (!file) return;
  const nYears = 5; // Hardcoded default
  
  const rate_changes = [];
  let maxYear = null;
  document.querySelectorAll('#rate-changes-container > div').forEach(row => {
    const date = row.querySelector('.rc-date').value;
    const pct = parseFloat(row.querySelector('.rc-pct').value);
    if (date && !isNaN(pct)) {
      rate_changes.push({ effective_date: date, rate_change: pct / 100.0 });
      
      const year = new Date(date).getFullYear();
      if (!maxYear || year > maxYear) maxYear = year;
    }
  });
  
  const valYear = maxYear;

  const msgId = addAgentMessage('agent', `🚀 Launching Sequential Multi-Agent Pipeline for <strong>${file.name}</strong>...`, 'analyzing');
  State.uploadMsgId = msgId;
  
  const formData = new FormData();
  formData.append('file', file);
  formData.append('n_years', nYears);
  if (valYear) formData.append('valuation_year', valYear);
  if (rate_changes.length > 0) {
    formData.append('rate_changes_json', JSON.stringify(rate_changes));
  }
  
  const bizDesc = document.getElementById('business-description');
  if (bizDesc && bizDesc.value.trim()) {
    formData.append('business_description', bizDesc.value.trim());
  }
  
  if (State.apiKey) {
    formData.append('api_key', State.apiKey);
    formData.append('base_url', State.baseUrl);
    formData.append('model_name', State.modelName);
  }

  try {
    const res = await fetch(`${API_BASE}/upload`, { method: 'POST', body: formData });
    if (!res.ok) throw new Error('Network response was not ok');

    await processPipelineStream(res);
  } catch (e) {
    showToast('Pipeline Error: ' + e.message, 'error');
    updateAgentMessage(msgId, `Failed to process: ${e.message}`);
  }
}

async function processPipelineStream(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.type === "agent") {
          addAgentMessage('action', `<strong>[${msg.agent}]</strong> ${msg.text}`);
          if (msg.agent === "System Error") {
            updateAgentMessage(State.uploadMsgId, 'Pipeline aborted due to error.');
          }
        } else if (msg.type === "input_required") {
          State.sessionId = msg.session_id; // Save it now so resume works
          addAgentMessage('action', `<strong>[${msg.agent}]</strong> ${msg.prompt}`);
          
          const container = document.getElementById('agent-log');
          const promptBox = document.createElement('div');
          promptBox.className = 'agent-msg action';
          promptBox.style = "border: 1px solid rgba(167, 139, 250, 0.4); background: rgba(167, 139, 250, 0.1); flex-direction: column; align-items: flex-start; padding: 12px;";
          promptBox.innerHTML = `
            <div style="margin-bottom: 12px; color: #a78bfa; font-weight: bold;">[${msg.agent}] Requires Input: Data Conditions</div>
            <div style="font-size: 13px; color: #ddd; margin-bottom: 16px; line-height: 1.5;">
              <label style="display:flex; align-items:center; gap:8px; cursor:pointer;"><input type="checkbox" id="cond-credible" value="true"> Large amount of credible historical claims data available</label>
              <label style="display:flex; align-items:center; gap:8px; margin-top:8px; cursor:pointer;"><input type="checkbox" id="cond-freq" value="true"> High-frequency, low-severity lines with stable/timely reporting</label>
              <label style="display:flex; align-items:center; gap:8px; margin-top:8px; cursor:pointer;"><input type="checkbox" id="cond-distort" value="true"> Presence/absence of large claims does not greatly distort data</label>
            </div>
            <div style="display:flex; justify-content:flex-end; width: 100%;">
              <button class="btn-run" onclick="submitPipelineConditions(this)" style="padding: 6px 16px; font-size: 13px;">Submit & Resume →</button>
            </div>
          `;
          container.appendChild(promptBox);
          container.scrollTop = container.scrollHeight;
          
          return; 
        } else if (msg.type === "complete") {
          State.sessionId = msg.session_id;
          State.summary = msg.summary;
          State.triangle = msg.triangle;
          State.recommendation = msg.recommendation; // Save the recommendation
          State.customLDFs = null;
          
          updateAgentMessage(State.uploadMsgId, 'Pipeline execution completed. See summary in right panel.');
          setTimeout(() => {
            advanceStep(1);
            setRightPanel('summary', State.summary);
          }, 1000);
        } else if (msg.type === "error") {
          updateAgentMessage(State.uploadMsgId, `Failed: ${msg.message}`);
        }
      } catch(err) {
        console.error("Stream parse error:", err);
      }
    }
  }
}

window.submitPipelineConditions = function(btn) {
  const conditions = {
    credible: document.getElementById('cond-credible').checked,
    freq: document.getElementById('cond-freq').checked,
    distort: document.getElementById('cond-distort').checked
  };
  
  // Disable inputs to show it's submitted
  btn.disabled = true;
  document.getElementById('cond-credible').disabled = true;
  document.getElementById('cond-freq').disabled = true;
  document.getElementById('cond-distort').disabled = true;
  
  resumePipeline(conditions);
}

async function resumePipeline(conditions) {
  try {
    const res = await fetch(`${API_BASE}/resume_pipeline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: State.sessionId,
        conditions: conditions
      })
    });
    
    if (!res.ok) throw new Error('Network response was not ok');
    await processPipelineStream(res);
  } catch (e) {
    showToast('Pipeline Resume Error: ' + e.message, 'error');
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
    <div style="margin-top:24px; text-align:right;"><button class="btn-run" onclick="viewTriangle()">Review Loss Triangle →</button></div>`;
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
          <tr class="ldf-row sel-row"><td class="tri-ay">Selected LDF</td>${selRow}<td class="ldf-cell tail"><input type="number" id="tail-factor-input" value="${State.tailFactor || 1.0}" step="0.001" style="width: 60px; text-align: center; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.2); color: white; border-radius: 4px;"> (tail)</td></tr>
        </tbody>
      </table>
    </div>
    <div style="margin-top:24px; text-align:right;"><button class="btn-run" onclick="proceedToModelSelection()">Select Execution Model →</button></div>`;
}

function setupLDFEditing() {
  document.querySelectorAll('.ldf-input').forEach(input => {
    input.addEventListener('change', () => { State.customLDFs[parseInt(input.dataset.idx)] = parseFloat(input.value); });
  });
  const tailInput = document.getElementById('tail-factor-input');
  if (tailInput) {
    State.tailFactor = parseFloat(tailInput.value) || 1.0;
    tailInput.addEventListener('change', () => { State.tailFactor = parseFloat(tailInput.value) || 1.0; });
  }
}

window.changeLDFBase = function(base) {
  State.ldfBase = base;
  State.customLDFs = State.triangle.ldfs.slice(0, -1).map(s => s[base] ?? 1.0);
  setRightPanel('triangle');
};

function proceedToModelSelection() {
  advanceStep(3);
  let ranked = [
    { code: 'BF', label: 'Bornhuetter-Ferguson', desc: 'Uses a priori expected loss ratios.', score: 10, recommended: true, params: [{key: 'aprioriLossRatio', label: 'A Priori Loss Ratio (%)', default: 65}] },
    { code: 'CL', label: 'Chain Ladder (Basic)', desc: 'Standard development method.', score: 9, recommended: true, params: [] },
    { code: 'CC', label: 'Cape Cod', desc: 'Uses an overall loss ratio for stability.', score: 8, recommended: false, params: [{key: 'decay', label: 'Decay Factor', default: 1.0}] },
    { code: 'BK', label: 'Benktander', desc: 'Iterative blend of BF and CL.', score: 7, recommended: false, params: [{key: 'aprioriLossRatio', label: 'A Priori Loss Ratio (%)', default: 65}, {key: 'iterations', label: 'Iterations (c)', default: 1}] },
    { code: 'MCL', label: 'Mack Chain Ladder', desc: 'Calculates standard errors and variance.', score: 6, recommended: false, params: [] },
    { code: 'CLK', label: 'Clark Stochastic', desc: 'Stochastic curve fitting approximation.', score: 5, recommended: false, params: [{key: 'curveType', label: 'Growth Curve', default: 'loglogistic'}] },
    { code: 'CO', label: 'Case Outstanding', desc: 'Uses only reported case reserves.', score: 4, recommended: false, params: [] }
  ];

  if (State.triangle && !State.triangle.hasPremium) {
    ranked = ranked.filter(m => !['BF', 'CC', 'BK'].includes(m.code));
  }

  State.ranked = ranked;
  setRightPanel('model-select', { ranked });
}

function renderModelSelectView({ ranked }) {
  const cards = ranked.map(m => `
    <div class="method-card ${m.recommended ? 'recommended' : ''}" onclick="selectMethod('${m.code}')">
      <div class="mc-header"><div class="mc-code">${m.code}</div><div class="mc-label">${m.label}</div></div>
      <div class="mc-desc">${m.desc}</div>
      <div class="mc-score-bar"><div class="mc-score-fill" style="width:${Math.min(m.score * 10, 100)}%"></div></div>
    </div>`).join('');
  
  const recHtml = State.recommendation ? `
    <div style="margin-bottom: 24px; padding: 16px; background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 8px;">
      <h3 style="margin-top: 0; color: #60a5fa; font-size: 14px; margin-bottom: 8px;">✨ AI Recommendation</h3>
      <div style="font-size: 13px; line-height: 1.5; color: var(--text-main);">${State.recommendation}</div>
    </div>` : '';

  return `<div class="view-header"><h2>Select Execution Model</h2><p class="view-sub">Select a tool for the Execution Agent</p></div>${recHtml}<div class="method-grid">${cards}</div>`;
}

window.selectMethod = function(code) {
  State.selectedMethod = code;
  const method = State.ranked.find(m => m.code === code);
  const params = method ? method.params : [];
  if (params.length > 0) setRightPanel('params', { code, params });
  else submitParams(code);
};

window.addRateChangeRow = function() {
  const container = document.getElementById('rate-changes-container');
  if(!container) return;
  const row = document.createElement('div');
  row.style = "display:flex; gap:8px; margin-bottom:8px;";
  row.innerHTML = `
    <input type="date" class="rc-date" style="flex:1; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: white; padding: 8px; border-radius: 4px;">
    <input type="number" class="rc-pct" placeholder="Change % (e.g. 5)" step="any" style="flex:1; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: white; padding: 8px; border-radius: 4px;">
    <button class="btn-ghost" onclick="this.parentElement.remove()" style="padding: 8px;">✕</button>
  `;
  container.appendChild(row);
}

function renderParamsView({ code, params }) {
  const fields = params.map(p => `<div class="param-field"><label>${p.label}</label><input type="number" id="param-${p.key}" class="param-input" data-key="${p.key}" value="${p.default}" step="any"></div>`).join('');
  
  return `<div class="view-header"><h2>Parameters</h2></div><div class="params-container" style="display:flex; flex-direction:column; gap:16px;">${fields}<button class="btn-run" onclick="submitParams('${code}')">Execute Tool →</button></div>`;
}

window.submitParams = async function(code) {
  const params = {};
  document.querySelectorAll('.param-input').forEach(i => {
    const v = parseFloat(i.value);
    params[i.dataset.key] = isNaN(v) ? null : v;
  });

  advanceStep(4);
  const msgId = addAgentMessage('agent', `⚙️ <strong>Execution Agent</strong> running ${code} on backend…`, 'analyzing');

  try {
    const res = await fetch(`${API_BASE}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: State.sessionId,
        method_code: code,
        params: params,
        custom_ldfs: [...State.customLDFs, State.tailFactor || 1.0], // add custom tail
        api_key: State.apiKey,
        base_url: State.baseUrl,
        model_name: State.modelName
      })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    setRightPanel('results', data);
    
    setTimeout(() => {
      if (data.ldfs && data.dev_ages) {
        drawLDFChart(data.dev_ages, data.ldfs);
      }
    }, 100);
    
    updateAgentMessage(msgId, 'Execution complete. Report displayed in right panel.');
  } catch (e) {
    updateAgentMessage(msgId, 'Execution failed: ' + e.message);
  }
};

let ldfChartInstance = null;
function drawLDFChart(labels, ldfData) {
  const ctx = document.getElementById('ldfChart');
  if (!ctx) return;
  
  if (ldfChartInstance) {
    ldfChartInstance.destroy();
  }
  
  // Format labels: "12m", "24m", etc.
  const chartLabels = labels.map(l => l + 'm');
  
  ldfChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: chartLabels,
      datasets: [{
        label: 'Loss Development Factor (LDF)',
        data: ldfData,
        borderColor: '#a78bfa',
        backgroundColor: 'rgba(167, 139, 250, 0.2)',
        borderWidth: 3,
        pointBackgroundColor: '#111827',
        pointBorderColor: '#a78bfa',
        pointBorderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 6,
        fill: true,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(17, 24, 39, 0.9)',
          titleColor: '#a78bfa',
          bodyFont: { size: 14, weight: 'bold' },
          padding: 12,
          displayColors: false,
          callbacks: {
            label: function(context) {
              return 'LDF: ' + context.parsed.y.toFixed(4);
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: false,
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: 'rgba(255, 255, 255, 0.5)' }
        },
        x: {
          grid: { display: false },
          ticks: { color: 'rgba(255, 255, 255, 0.5)' }
        }
      }
    }
  });
}

function renderResultsView(data) {
  // Extract all unique keys from results array to form dynamic columns
  let keys = new Set();
  data.results.forEach(r => Object.keys(r).forEach(k => keys.add(k)));
  keys = Array.from(keys);
  
  // Custom ordering: ay, paid, cdfToUlt, pctReported, ultimate, ibnr... then others
  const coreKeys = ['ay', 'paid', 'cdfToUlt', 'pctReported', 'ultimate', 'ibnr'];
  const extraKeys = keys.filter(k => !coreKeys.includes(k));
  const finalKeys = [...coreKeys, ...extraKeys];
  
  const headerMap = {
    ay: 'Accident Year',
    paid: 'Paid Claims',
    cdfToUlt: 'CDF to Ultimate',
    pctReported: '% Reported',
    ultimate: 'Ultimate Claims',
    ibnr: 'IBNR'
  };
  const headers = finalKeys.map(k => `<th>${headerMap[k] || (k.charAt(0).toUpperCase() + k.slice(1))}</th>`).join('');
  const rows = data.results.map(r => {
    return '<tr>' + finalKeys.map(k => {
      let val = r[k];
      if (typeof val === 'number') {
        if (k === 'ay' || k === 'pctReported' || k.includes('ELR') || k.includes('cdf')) val = val;
        else val = fmt(val);
      }
      return `<td>${val != null ? val : '—'}</td>`;
    }).join('') + '</tr>';
  }).join('');
  
  let olfTableHtml = '';
  if (data.olf_results && data.olf_results.length > 0) {
    const olfRows = data.olf_results.map(r => `
      <tr>
        <td>${r.accident_year}</td>
        <td>${fmt(r.earned_premium)}</td>
        <td>${r.average_rate_level.toFixed(4)}</td>
        <td>${r.olf.toFixed(4)}</td>
        <td style="color:#10b981; font-weight:bold;">${fmt(r.on_level_premium)}</td>
      </tr>
    `).join('');
    olfTableHtml = `
      <h3 style="margin-top: 24px; margin-bottom: 12px; color: #a78bfa;">Premium On-Leveling Results</h3>
      <div class="table-scroll" style="margin-bottom: 24px; border: 1px solid rgba(167, 139, 250, 0.3);">
        <table class="results-table">
          <thead>
            <tr>
              <th>Accident Year</th>
              <th>Historical Premium</th>
              <th>Avg Rate Level</th>
              <th>On-Level Factor (OLF)</th>
              <th>On-Level Premium</th>
            </tr>
          </thead>
          <tbody>${olfRows}</tbody>
        </table>
      </div>
    `;
  }
  
  return `
    <div class="view-header"><h2>IBNR Results</h2><button class="btn-ghost" onclick="advanceStep(3); proceedToModelSelection();">← Back</button></div>
    <div class="kpi-strip">
      <div class="kpi-block"><div class="kpi-label">Total IBNR</div><div class="kpi-value">${fmt(data.totalIBNR)}</div></div>
      <div class="kpi-block"><div class="kpi-label">Total Ultimate</div><div class="kpi-value">${fmt(data.totalUlt)}</div></div>
    </div>
    
    ${olfTableHtml}
    
    <div class="table-scroll" style="margin-bottom: 24px;">
      <table class="results-table">
        <thead><tr>${headers}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    
    ${(function() {
      if (!data.loss_ratios || data.loss_ratios.length === 0) return '';
      const lrRows = data.loss_ratios.map(r => `
        <tr>
          <td>${r.accident_year}</td>
          <td>${fmt(r.premium)}</td>
          <td>${r.paid_lr_pct !== null ? r.paid_lr_pct.toFixed(1) + '%' : '—'}</td>
          <td style="color:#10b981; font-weight:bold;">${r.ultimate_lr_pct !== null ? r.ultimate_lr_pct.toFixed(1) + '%' : '—'}</td>
        </tr>
      `).join('');
      
      const elrHtml = data.suggested_elr ? 
        `<div style="margin-top:12px; font-size:13px; color:#a78bfa;"><strong>Cape Cod Suggested A Priori ELR:</strong> ${data.suggested_elr.toFixed(1)}%</div>` : '';

      return `
        <h3 style="margin-top: 24px; margin-bottom: 12px; color: #a78bfa;">Loss Ratios</h3>
        <div class="table-scroll" style="margin-bottom: 24px; border: 1px solid rgba(167, 139, 250, 0.3);">
          <table class="results-table">
            <thead>
              <tr>
                <th>Accident Year</th>
                <th>Premium</th>
                <th>Paid LR</th>
                <th>Ultimate LR</th>
              </tr>
            </thead>
            <tbody>${lrRows}</tbody>
          </table>
        </div>
        ${elrHtml}
      `;
    })()}

    ${(function() {
      if (!data.ldf_stability || data.ldf_stability.length === 0) return '';
      const stabRows = data.ldf_stability.map(r => {
        const stabColor = r.stability === 'High' ? '#10b981' : (r.stability === 'Moderate' ? '#f59e0b' : '#ef4444');
        return `
          <tr>
            <td>${r.from_age}-${r.to_age}</td>
            <td>${r.n}</td>
            <td>${r.vw !== null ? r.vw.toFixed(3) : '—'}</td>
            <td>${r.cov_pct !== null ? r.cov_pct.toFixed(1) + '%' : '—'}</td>
            <td><span style="color:${stabColor}; font-weight:bold;">${r.stability}</span></td>
            <td>${r.credibility}</td>
          </tr>
        `;
      }).join('');

      return `
        <h3 style="margin-top: 24px; margin-bottom: 12px; color: #a78bfa;">LDF Stability Diagnostics</h3>
        <div class="table-scroll" style="margin-bottom: 24px; border: 1px solid rgba(167, 139, 250, 0.3);">
          <table class="results-table">
            <thead>
              <tr>
                <th>Age-to-Age</th>
                <th>Data Points (n)</th>
                <th>Vol-Weighted LDF</th>
                <th>Coef of Var (CoV)</th>
                <th>Stability</th>
                <th>Credibility</th>
              </tr>
            </thead>
            <tbody>${stabRows}</tbody>
          </table>
        </div>
      `;
    })()}

    <h2 style="margin-bottom: 16px;">Execution Report</h2>
    <div id="report-container">
      ${(function() {
        if (!data.narration) return '<div style="color: rgba(255,255,255,0.5);">Detailed process explanation unavailable.</div>';
        try {
          let cleanJson = data.narration.replace(/```json/g, '').replace(/```/g, '').trim();
          const rep = JSON.parse(cleanJson);
          
          let inputsHtml = rep.inputs;
          if (Array.isArray(rep.inputs)) {
            inputsHtml = '<ul style="margin: 0; padding-left: 20px; color: rgba(255,255,255,0.9);">' + rep.inputs.map(i => `<li style="margin-bottom: 4px;">${i}</li>`).join('') + '</ul>';
          } else if (typeof rep.inputs === 'object' && rep.inputs !== null) {
            inputsHtml = '<ul style="margin: 0; padding-left: 20px; color: rgba(255,255,255,0.9);">' + Object.entries(rep.inputs).map(([k,v]) => `<li style="margin-bottom: 4px;"><strong>${k}:</strong> ${v}</li>`).join('') + '</ul>';
          }

          const numHtml = Object.entries(rep.output_numbers || {}).map(([k, v]) => `
            <div style="background: rgba(0,0,0,0.3); padding: 16px; border-radius: 8px; border: 1px solid rgba(16, 185, 129, 0.15); display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;">
              <span style="color: rgba(255,255,255,0.6); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">${k}</span>
              <span style="font-weight: 700; color: #10b981; font-size: 24px;">${fmt(v)}</span>
            </div>
          `).join('');
          
          return `
            <div style="display: flex; flex-direction: column; gap: 8px; max-width: 800px; margin: 0 auto;">
              
              <!-- Step 1: Inputs -->
              <div style="background: rgba(255,255,255,0.03); padding: 24px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.08); box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                <div style="color: #60a5fa; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
                  <span style="background: #3b82f6; color: white; width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; font-size: 10px;">1</span> REQUIRED INPUTS
                </div>
                <div style="font-size: 14px; line-height: 1.6; color: rgba(255,255,255,0.9);">${inputsHtml}</div>
              </div>
              
              <!-- Arrow Down -->
              <div style="text-align: center; color: rgba(255,255,255,0.2); font-size: 20px;">↓</div>
              
              <!-- Step 2: Process -->
              <div style="background: rgba(255,255,255,0.03); padding: 24px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.08); box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                <div style="color: #60a5fa; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
                  <span style="background: #3b82f6; color: white; width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; font-size: 10px;">2</span> MATHEMATICAL PROCESS
                </div>
                <div style="font-size: 14px; line-height: 1.6; color: rgba(255,255,255,0.9);">${rep.process}</div>
                
                <!-- NEW LDF VISUALIZATION -->
                <div style="margin-top: 24px; padding: 16px; background: rgba(0,0,0,0.2); border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">
                  <div style="font-size: 12px; color: #a78bfa; font-weight: 600; text-transform: uppercase; margin-bottom: 12px; letter-spacing: 1px;">LDF Decay Curve Visualizer</div>
                  <canvas id="ldfChart" style="max-height: 250px; width: 100%;"></canvas>
                </div>
                
                <div style="margin-top: 16px; padding-top: 16px; border-top: 1px dashed rgba(255,255,255,0.1); font-size: 13px; color: rgba(255,255,255,0.7); line-height: 1.5;">
                  <strong style="color: #a78bfa; text-transform: uppercase; font-size: 10px; letter-spacing: 1px; display: block; margin-bottom: 4px;">6-Criteria LDF Analysis</strong> 
                  ${rep.ldf_analysis || 'No analysis available.'}
                </div>

                <div style="margin-top: 16px; padding-top: 16px; border-top: 1px dashed rgba(255,255,255,0.1); font-size: 13px; color: rgba(255,255,255,0.7); line-height: 1.5;">
                  <strong style="color: #a78bfa; text-transform: uppercase; font-size: 10px; letter-spacing: 1px; display: block; margin-bottom: 4px;">Tail Factor Selection</strong> 
                  ${rep.tail_factor_selection || 'No tail factor selection details provided.'}
                </div>

                <div style="margin-top: 16px; padding-top: 16px; border-top: 1px dashed rgba(255,255,255,0.1); font-size: 13px; color: rgba(255,255,255,0.7); line-height: 1.5;">
                  <strong style="color: #a78bfa; text-transform: uppercase; font-size: 10px; letter-spacing: 1px; display: block; margin-bottom: 4px;">Impact of Exposures</strong> 
                  ${rep.impact}
                </div>

                ${(() => {
                  const env = rep.environment_sensitivity;
                  if (!env) return '';
                  const impactColor = { 'SEVERE': '#f87171', 'MODERATE': '#fb923c', 'SLIGHT': '#facc15', 'NONE': '#4ade80' };
                  const rows = [
                    ['Changing Product Mix / Exposures', env.changing_product_mix],
                    ['Increasing Claim Ratios', env.increasing_claim_ratios],
                    ['Case Outstanding Strengthening', env.case_outstanding_strengthening],
                    ['Changing Settlement Rates', env.changing_settlement_rates]
                  ].map(([label, data]) => {
                    if (!data) return '';
                    const color = impactColor[data.impact] || '#94a3b8';
                    return `<tr>
                      <td style="padding:10px 12px; border-bottom:1px solid rgba(255,255,255,0.06); font-weight:600; color:rgba(255,255,255,0.85); width:28%;">${label}</td>
                      <td style="padding:10px 12px; border-bottom:1px solid rgba(255,255,255,0.06); width:14%; text-align:center;">
                        <span style="display:inline-block; padding:2px 10px; border-radius:20px; font-size:11px; font-weight:700; background:${color}22; color:${color}; border:1px solid ${color}44;">${data.impact}</span>
                      </td>
                      <td style="padding:10px 12px; border-bottom:1px solid rgba(255,255,255,0.06); color:rgba(255,255,255,0.65); font-size:12px; line-height:1.5;">${data.explanation}</td>
                    </tr>`;
                  }).join('');
                  return `
                  <div style="margin-top: 20px; padding-top: 16px; border-top: 1px dashed rgba(255,255,255,0.1);">
                    <strong style="color: #f97316; text-transform: uppercase; font-size: 10px; letter-spacing: 1px; display: block; margin-bottom: 12px;">⚠ Environmental Sensitivity Analysis</strong>
                    <table style="width:100%; border-collapse:collapse; font-size:13px;">
                      <thead>
                        <tr style="background:rgba(255,255,255,0.04);">
                          <th style="padding:8px 12px; text-align:left; color:rgba(255,255,255,0.5); font-size:10px; text-transform:uppercase; letter-spacing:1px; border-bottom:1px solid rgba(255,255,255,0.1);">Environmental Factor</th>
                          <th style="padding:8px 12px; text-align:center; color:rgba(255,255,255,0.5); font-size:10px; text-transform:uppercase; letter-spacing:1px; border-bottom:1px solid rgba(255,255,255,0.1);">Impact</th>
                          <th style="padding:8px 12px; text-align:left; color:rgba(255,255,255,0.5); font-size:10px; text-transform:uppercase; letter-spacing:1px; border-bottom:1px solid rgba(255,255,255,0.1);">Explanation</th>
                        </tr>
                      </thead>
                      <tbody>${rows}</tbody>
                    </table>
                  </div>`;
                })()}
              </div>
              
              <!-- Arrow Down -->
              <div style="text-align: center; color: rgba(16, 185, 129, 0.4); font-size: 20px;">↓</div>
              
              <!-- Step 3: Output -->
              <div style="background: rgba(16, 185, 129, 0.05); padding: 24px; border-radius: 8px; border: 1px solid rgba(16, 185, 129, 0.3); box-shadow: 0 4px 12px rgba(16, 185, 129, 0.05);">
                <div style="color: #10b981; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 16px; display: flex; align-items: center; gap: 8px;">
                  <span style="background: #10b981; color: white; width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; font-size: 10px;">3</span> FINAL OUTPUT & RECOMMENDATION
                </div>
                <div style="font-size: 14px; line-height: 1.6; color: rgba(255,255,255,0.9); margin-bottom: 24px;">${rep.output_text}</div>
                
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">
                  ${numHtml}
                </div>
              </div>
              
            </div>
          `;
        } catch (e) {
          return `<div style="padding: 16px; background: rgba(255,255,255,0.05); border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); font-size: 13px; line-height: 1.6; white-space: pre-wrap;">${data.narration}</div>`;
        }
      })()}
    </div>`;
}

function setupChat() {
  const input = document.getElementById('chat-input');
  const send = document.getElementById('chat-send');
  const submit = async () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    if (!State.apiKey) { showToast('API key required for chat.', 'error'); return; }
    if (!State.sessionId) { showToast('Upload data first to query the Parallel Agent.', 'error'); return; }
    
    addAgentMessage('user', escapeHTML(text));
    const typingId = addAgentMessage('agent', '…', 'analyzing');
    
    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: State.sessionId,
          message: text,
          history: State.chatHistory,
          api_key: State.apiKey,
          base_url: State.baseUrl,
          model_name: State.modelName
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
