'use client';
import React, { useState, useEffect, useMemo } from 'react';
import { ExecuteResult, MethodResultItem } from '../types';
import { fmt, fmtShort, CurrencyCode } from '../utils';
import ExportMenu from './ExportMenu';
import { downloadCSV, downloadExcel, downloadPDF, SheetDef, TableDef } from '../exportUtils';
import WeibullFitChart from './WeibullFitChart';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  AreaChart,
  Area,
  LineChart,
  Line,
} from 'recharts';

interface ResultsViewProps {
  sessionId: string;
  data: ExecuteResult;
  currency?: CurrencyCode;
  onBack: () => void;
}

const PROCESS_EXPLANATIONS: Record<string, string> = {
  "CL":  "Chain Ladder projects ultimate claims by multiplying the latest paid/incurred diagonal by Cumulative Development Factors (CDFs) derived from historical age-to-age LDFs. IBNR = Ultimate − Paid/Incurred.",
  "MCL": "Mack Chain Ladder calculates identical ultimates to CL but additionally computes sigma-squared variance for each column, producing standard errors and confidence intervals (75th/95th percentile) around the IBNR estimate.",
  "BF":  "Bornhuetter-Ferguson splits the IBNR into (a) expected unreported claims = Expected Ultimate × (1 − 1/CDF), plus (b) actual paid/incurred to date. Expected Ultimate = Premium × A Priori ELR.",
  "CC":  "Cape Cod derives the ELR automatically from actual data: ELR = Σ(Reported Claims) / Σ(Used-Up Premium). Used-Up Premium = Earned Premium × % Reported (1/CDF). IBNR is then computed identically to BF.",
  "BK":  "Benktander iteratively refines the BF estimate: BF Ultimate is fed back as the new A Priori, and IBNR is recomputed. Each iteration shifts credibility from BF toward Chain Ladder proportional to % reported.",
  "CO":  "Case Outstanding method sets IBNR = total case reserves currently held by adjusters. It assumes zero future newly-reported claims. Reserve = Incurred − Paid = Case Reserves.",
  "CLK": "Clark Stochastic fits a continuous growth curve (Log-Logistic or Weibull) to the paid triangle using maximum likelihood. Stabilised CDFs from the curve are applied to project ultimates with a distribution of outcomes.",
  "ELR": "Expected Loss Ratio projects future losses as Premium × Expected Loss Ratio. It does not use development factors for immature years, acting as a stable baseline indicator."
};

export default function ResultsView({ sessionId, data, currency = 'USD', onBack }: ResultsViewProps) {
  const [mounted, setMounted] = useState(false);
  const [selectedDetailCode, setSelectedDetailCode] = useState<string>('');
  
  const [auditState, setAuditState] = useState(data.compliance_audit || {});
  const [editingRule, setEditingRule] = useState<string | null>(null);
  const [overrideText, setOverrideText] = useState<string>('');
  const [overrideCategory, setOverrideCategory] = useState<string>('');
  const [chartMetric, setChartMetric] = useState<'Ultimate' | 'Reserve' | 'IBNR'>('IBNR');

  const [modelReports, setModelReports] = useState<Record<string, string>>({});
  const [generatingReportFor, setGeneratingReportFor] = useState<string | null>(null);

  // Dynamic API Base URL detection
  const getApiUrl = (endpoint: string) => {
    if (typeof window !== 'undefined') {
      const isLocal =
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1';
      const base = isLocal
        ? 'http://localhost:8000/api'
        : 'https://reserving-using-agentic-ai.onrender.com/api';
      return `${base}/${endpoint}`;
    }
    return `/api/${endpoint}`;
  };

  const handleOverrideSubmit = async () => {
    if (!editingRule || !overrideText.trim()) return;
    
    try {
      const res = await fetch(getApiUrl('override_compliance'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          category: overrideCategory,
          rule: editingRule,
          rationale: overrideText
        })
      });
      const resData = await res.json();
      if (!resData.success) throw new Error(resData.error);
      
      setAuditState(resData.compliance_audit);
      setEditingRule(null);
      setOverrideText('');
    } catch (e: any) {
      alert(`Override failed: ${e.message}`);
    }
  };

  const generateDeepDiveReport = async (methodCode: string) => {
    setGeneratingReportFor(methodCode);
    try {
      const res = await fetch(getApiUrl('generate_model_report'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, method_code: methodCode })
      });
      const resData = await res.json();
      if (!resData.success) throw new Error(resData.error);
      
      setModelReports(prev => ({ ...prev, [methodCode]: resData.report }));
    } catch (e: any) {
      alert(`Report generation failed: ${e.message}`);
    } finally {
      setGeneratingReportFor(null);
    }
  };

  const renderMarkdown = (text: string) => {
    if (!text) return '';
    let html = text
      .replace(/### (.*?)(?=\n|$)/g, '<h4 class="text-sm font-bold text-text-main mt-4 mb-2">$1</h4>')
      .replace(/## (.*?)(?=\n|$)/g, '<h3 class="text-md font-bold text-accent mt-5 mb-2">$1</h3>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\n\n/g, '</p><p class="mt-2">')
      .replace(/\n- (.*?)(?=\n|$)/g, '<li class="ml-4 list-disc">$1</li>')
      .replace(/\n\d+\. (.*?)(?=\n|$)/g, '<li class="ml-4 list-decimal">$1</li>')
      .replace(/\n/g, '<br />');
    return `<p>${html}</p>`;
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  // Sync selected method detail viewer with AI recommendation on load
  useEffect(() => {
    if (data.ai_recommendation?.recommended_method) {
      setSelectedDetailCode(data.ai_recommendation.recommended_method);
    } else {
      const firstSuccess = data.methods?.find(m => m.status === 'success');
      if (firstSuccess) {
        setSelectedDetailCode(firstSuccess.result_id || firstSuccess.code || firstSuccess.method || '');
      }
    }
  }, [data]);

  const activeMethods = useMemo(() => {
    if (!data.methods) return [];
    return data.methods.filter(m => m.status === 'success') as MethodResultItem[];
  }, [data.methods]);

  // Median, Min, Max Ultimate
  const ultimateStats = useMemo(() => {
    if (activeMethods.length === 0) return { min: 0, max: 0, median: 0 };
    const ultimates = activeMethods.map(m => m.ultimate || 0).sort((a, b) => a - b);
    const mid = Math.floor(ultimates.length / 2);
    const median = ultimates.length % 2 !== 0 ? ultimates[mid] : (ultimates[mid - 1] + ultimates[mid]) / 2;
    return {
      min: ultimates[0],
      max: ultimates[ultimates.length - 1],
      median
    };
  }, [activeMethods]);

  // Selected method detail
  const selectedMethodDetail = useMemo(() => {
    if (!data.methods) return undefined;
    return data.methods.find(m => (m.result_id || m.code) === selectedDetailCode);
  }, [data.methods, selectedDetailCode]);

  // Prepare trend data for selected method
  const trendData = useMemo(() => {
    if (!selectedMethodDetail || !selectedMethodDetail.results) return [];
    return selectedMethodDetail.results.map((r: any) => ({
      ay: r.ay,
      paid: parseFloat(r.paid) || 0,
      ibnr: parseFloat(r.ibnr) || 0,
      ultimate: parseFloat(r.ultimate) || 0,
      pctReported: (parseFloat(r.pctReported) || 0),
      settlementRate: parseFloat(r.ultimate) ? ((parseFloat(r.paid) || 0) / parseFloat(r.ultimate)) * 100 : 0
    }));
  }, [selectedMethodDetail]);

  const barChartData = useMemo(() => {
    return activeMethods.map(m => ({
      name: m.result_id || m.code,
      IBNR: m.ibnr || 0,
      Ultimate: m.ultimate || 0,
      Reserve: m.reserve || 0
    }));
  }, [activeMethods]);

  // Format percent diff helper
  const fmtPctDiff = (val: number) => {
    const sign = val > 0 ? '+' : '';
    return `${sign}${(val * 100).toFixed(1)}%`;
  };

  // ── Export Handlers ──────────────────────────────────────────────────────────

  const COMPARISON_HEADERS = [
    'Method Code', 'Method Name', 'Status', 'Ultimate', 'Reserve', 'IBNR',
    'Diff vs Median', 'Impl. Loss Ratio', 'Reserve/Case Ratio'
  ];

  const buildComparisonRows = (): (string | number | null)[][] =>
    (data.methods || []).map((m) => [
      m.result_id || m.code || '',
      m.name || m.method || '',
      m.status,
      m.status === 'success' ? Math.round(m.ultimate) : null,
      m.status === 'success' && m.reserve != null ? Math.round(m.reserve) : null,
      m.status === 'success' ? Math.round(m.ibnr) : null,
      m.status === 'success' && m.diff_from_median != null ? fmtPctDiff(m.diff_from_median) : null,
      m.status === 'success' && m.loss_ratio != null ? Number((m.loss_ratio * 100).toFixed(2)) : null,
      m.status === 'success' && m.reserve_to_case_ratio != null ? Number(m.reserve_to_case_ratio.toFixed(3)) : null,
    ]);

  const AY_DETAIL_HEADERS = ['Accident Year', 'Paid', 'Ultimate', 'IBNR', '% Reported'];

  const buildAYDetailRows = (method: MethodResultItem | undefined): (string | number | null)[][] => {
    if (!method?.results) return [];
    return method.results.map((r: any) => [
      r.ay,
      r.paid != null ? Math.round(parseFloat(r.paid)) : null,
      r.ultimate != null ? Math.round(parseFloat(r.ultimate)) : null,
      r.ibnr != null ? Math.round(parseFloat(r.ibnr)) : null,
      r.pctReported != null ? Number(parseFloat(r.pctReported).toFixed(1)) : null,
    ]);
  };

  const AI_REC_HEADERS = ['Field', 'Value'];
  const buildAIRecRows = (): (string | number | null)[][] => {
    const rec = data.ai_recommendation;
    if (!rec) return [];
    return [
      ['Recommended Method', rec.recommended_method],
      ['Confidence', rec.confidence],
      ...(rec.reasoning || []).map((r, i) => [`Reason ${i + 1}`, r] as [string, string]),
    ];
  };

  const handleResultsExportCSV = () => {
    const rows = buildComparisonRows();
    downloadCSV('ibnr_results.csv', COMPARISON_HEADERS, rows);
  };

  const handleResultsExportExcel = async () => {
    const recMethod = data.methods?.find(
      (m) => (m.result_id || m.code) === data.ai_recommendation?.recommended_method && m.status === 'success'
    );
    const sheets: SheetDef[] = [
      { name: 'Method Comparison', headers: COMPARISON_HEADERS, rows: buildComparisonRows() },
      ...(recMethod
        ? [{ name: `AY Detail (${recMethod.result_id || recMethod.code})`, headers: AY_DETAIL_HEADERS, rows: buildAYDetailRows(recMethod) }]
        : []),
      { name: 'AI Recommendation', headers: AI_REC_HEADERS, rows: buildAIRecRows() },
    ];
    await downloadExcel('ibnr_results.xlsx', sheets);
  };

  const handleResultsExportPDF = async () => {
    const recMethod = data.methods?.find(
      (m) => (m.result_id || m.code) === data.ai_recommendation?.recommended_method && m.status === 'success'
    );
    const tables: TableDef[] = [
      { title: 'Method Comparison Summary', headers: COMPARISON_HEADERS, rows: buildComparisonRows() },
      ...(recMethod
        ? [{ title: `Accident Year Detail — ${recMethod.name || recMethod.result_id}`, headers: AY_DETAIL_HEADERS, rows: buildAYDetailRows(recMethod) }]
        : []),
      { title: 'AI Reserve Recommendation', headers: AI_REC_HEADERS, rows: buildAIRecRows() },
    ];
    await downloadPDF('ibnr_results.pdf', 'IBNR Reserving Indication Report', tables);
  };

  return (
    <div className="flex flex-col flex-1 animate-slide-in pb-10 space-y-6">
      
      {/* View Header */}
      <div className="flex justify-between items-center border-b border-border pb-3">
        <div>
          <h2 className="text-base font-bold text-text-main">IBNR Reserving Indication Dashboard</h2>
          <p className="text-xs text-text-sub mt-0.5 font-sans">Compare multiple mathematical projection methodologies side-by-side.</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportMenu
            label="Export Results"
            onExportCSV={handleResultsExportCSV}
            onExportExcel={handleResultsExportExcel}
            onExportPDF={handleResultsExportPDF}
          />
          <button
            onClick={onBack}
            className="px-3.5 py-1.5 bg-transparent border border-border-2 rounded text-xs text-text-sub hover:border-text-sub hover:text-text-main transition-colors cursor-pointer"
          >
            ← Adjust loss triangles
          </button>
        </div>
      </div>

      {/* 1. AI Recommendation Panel */}
      {data.ai_recommendation && (
        <div className="p-5 bg-accent-dim/10 border border-accent/25 rounded-xl shadow-sm flex flex-col md:flex-row gap-5 items-start">
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider bg-accent text-white px-2 py-0.5 rounded">
                Recommended Reserve Model
              </span>
              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${
                data.ai_recommendation.confidence === 'High' 
                  ? 'bg-accent-green/10 border-accent-green/30 text-accent-green' 
                  : 'bg-accent-amber/10 border-accent-amber/30 text-accent-amber'
              }`}>
                {data.ai_recommendation.confidence} Confidence
              </span>
            </div>
            <h3 className="text-lg font-bold text-text-main flex items-center gap-2">
              ✨ {activeMethods.find(m => m.code === data.ai_recommendation?.recommended_method)?.name || data.ai_recommendation.recommended_method}
            </h3>
            
            <ul className="list-disc pl-5 text-xs text-text-sub leading-relaxed space-y-1">
              {data.ai_recommendation.reasoning.map((r, i) => (
                <li key={i} dangerouslySetInnerHTML={{ __html: r.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\*(.*?)\*/g, '<em>$1</em>') }} />
              ))}
            </ul>
          </div>
          
          <div className="bg-bg-1 border border-border rounded-lg p-4 flex flex-col items-center justify-center text-center w-full md:w-48 flex-shrink-0">
            <span className="text-[9.5px] font-bold text-text-muted uppercase tracking-wider mb-1">
              Recommended IBNR
            </span>
            <span className="text-2xl font-bold font-mono text-accent-green">
              {fmt(
                data.methods?.find(m => m.code === data.ai_recommendation?.recommended_method)?.ibnr || data.summary?.best_estimate || 0, 
                currency
              )}
            </span>
            <span className="text-[9px] text-text-muted mt-1">
              Best Estimate Indication
            </span>
          </div>
        </div>
      )}

      {/* 2. Method Comparison Summary Table */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold text-text-main uppercase tracking-wider">Method Comparison Summary</h3>
        <div className="table-scroll border border-border rounded-lg bg-bg-1">
          <table className="results-table w-full text-xs">
            <thead>
              <tr className="bg-bg-2">
                <th>Method Code</th>
                <th>Method Name</th>
                <th>Status</th>
                <th>Projected Ultimate</th>
                <th>Reserve</th>
                <th>Projected IBNR</th>
                <th>Diff vs Median</th>
                <th>Impl. Loss Ratio</th>
                <th>Reserve/Case Ratio</th>
              </tr>
            </thead>
            <tbody>
              {data.methods?.map((m, idx) => {
                const isSuccess = m.status === 'success';
                const isRecommended = m.result_id === data.ai_recommendation?.recommended_method || m.code === data.ai_recommendation?.recommended_method;
                
                return (
                  <tr key={idx} className={`${isRecommended ? 'bg-accent-dim/15 border-l-2 border-accent font-medium' : ''}`}>
                    <td className="font-bold text-accent font-mono">{m.result_id || m.code}</td>
                    <td className="font-semibold text-text-main">{m.name}</td>
                    <td>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                        m.status === 'success' 
                          ? 'bg-accent-green/10 text-accent-green' 
                          : m.status === 'incompatible' 
                          ? 'bg-text-muted/10 text-text-muted' 
                          : 'bg-accent-red/10 text-accent-red'
                      }`}>
                        {m.status}
                      </span>
                    </td>
                    <td className="font-mono font-bold text-text-main">{isSuccess ? fmt(m.ultimate, currency) : '—'}</td>
                    <td className="font-mono font-semibold text-accent-green">{isSuccess && m.reserve !== undefined ? fmt(m.reserve, currency) : '—'}</td>
                    <td className="font-mono">{isSuccess ? fmt(m.ibnr, currency) : '—'}</td>
                    <td className={`font-mono ${m.diff_from_median !== undefined && m.diff_from_median > 0 ? 'text-accent-red' : 'text-accent-green'}`}>
                      {isSuccess && m.diff_from_median !== undefined ? fmtPctDiff(m.diff_from_median) : '—'}
                    </td>
                    <td className="font-mono">{isSuccess && m.loss_ratio !== undefined ? `${(m.loss_ratio * 100).toFixed(1)}%` : '—'}</td>
                    <td className="font-mono">{isSuccess && m.reserve_to_case_ratio !== undefined ? m.reserve_to_case_ratio.toFixed(2) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 3. Charts Grid */}
      {mounted && activeMethods.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* comparison chart */}
          <div className="lg:col-span-2 bg-bg-1 border border-border rounded-lg p-5 flex flex-col justify-between">
            <div className="flex justify-between items-center mb-4">
              <div className="text-[11px] font-semibold text-text-sub uppercase tracking-wider">
                Method Comparison ({chartMetric})
              </div>
              <div className="flex gap-1 bg-bg-2 p-0.5 rounded border border-border/80">
                {(['Ultimate', 'Reserve', 'IBNR'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setChartMetric(m)}
                    className={`px-2 py-1 rounded text-[10px] font-bold uppercase transition-colors cursor-pointer select-none ${
                      chartMetric === m
                        ? 'bg-accent text-white shadow-sm'
                        : 'bg-transparent text-text-muted hover:text-text-main'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
            <div className="w-full h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barChartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(255, 255, 255, 0.05)" vertical={false} />
                  <XAxis dataKey="name" stroke="rgba(255, 255, 255, 0.4)" fontSize={10} tickLine={false} />
                  <YAxis stroke="rgba(255, 255, 255, 0.4)" fontSize={10} tickLine={false} tickFormatter={(v) => fmtShort(v, currency)} />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'rgba(17, 24, 39, 0.95)', border: '1px solid #334155', borderRadius: '8px', color: '#fff' }}
                    formatter={(v: any) => fmt(v, currency)}
                  />
                  <Bar dataKey={chartMetric} fill="#5b7cfa" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Reserve uncertainty range */}
          <div className="bg-bg-1 border border-border rounded-lg p-5 flex flex-col justify-between">
            <div>
              <div className="text-[11px] font-semibold text-text-sub mb-4 uppercase tracking-wider">
                Indicated Reserve Range
              </div>
              <div className="space-y-4 pt-2">
                <div className="flex justify-between text-xs border-b border-border/50 pb-2">
                  <span className="text-text-muted">Minimum Indication</span>
                  <span className="font-mono font-semibold">{fmt(ultimateStats.min, currency)}</span>
                </div>
                <div className="flex justify-between text-xs border-b border-border/50 pb-2">
                  <span className="text-text-muted">Median Indication</span>
                  <span className="font-mono font-semibold text-accent">{fmt(ultimateStats.median, currency)}</span>
                </div>
                <div className="flex justify-between text-xs border-b border-border/50 pb-2">
                  <span className="text-text-muted">Maximum Indication</span>
                  <span className="font-mono font-semibold">{fmt(ultimateStats.max, currency)}</span>
                </div>
              </div>
            </div>
            
            {/* Visual range bar */}
            <div className="pt-5 border-t border-border mt-4">
              <div className="h-2 bg-bg-3 rounded-full relative w-full flex items-center">
                <div className="absolute left-[10%] w-2 h-2 rounded-full bg-text-muted" title="Min" />
                <div className="h-full bg-accent rounded-full absolute left-[10%] right-[10%]" />
                <div className="absolute left-[50%] -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-accent border-2 border-white shadow" title="Median" />
                <div className="absolute right-[10%] w-2 h-2 rounded-full bg-text-muted" title="Max" />
              </div>
              <div className="flex justify-between text-[9px] text-text-muted mt-2">
                <span>Min</span>
                <span className="text-accent font-bold">Median</span>
                <span>Max</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3.5 Diagnostics (Weibull Fit) */}
      {mounted && data.diagnostics?.weibull_fit && (
        <WeibullFitChart data={data.diagnostics.weibull_fit} />
      )}

      {/* 4. Detailed Method Analysis */}
      <div className="border-t border-border pt-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-text-main uppercase tracking-wider">Detailed Method Analysis</h3>
            <p className="text-xs text-text-sub font-sans">Inspect the detailed accident-year grid and flowchart process for any method.</p>
          </div>
          
          <select
            value={selectedDetailCode}
            onChange={(e) => setSelectedDetailCode(e.target.value)}
            className="bg-bg-2 border border-border-2 rounded px-3 py-1.5 text-xs text-text-main font-semibold outline-none focus:border-accent h-9 cursor-pointer w-[240px]"
          >
            {activeMethods.map(m => (
              <option key={m.result_id || m.code} value={m.result_id || m.code}>{(m.result_id || m.code)} - {m.name}</option>
            ))}
          </select>
        </div>

        {/* Render selected detailed method outputs */}
        {selectedMethodDetail && (
          <div className="space-y-6">
            
            {/* Accident-year results matrix */}
            <div className="table-scroll border border-border rounded-lg bg-bg-1">
              <table className="results-table w-full text-xs">
                <thead>
                  <tr className="bg-bg-2">
                    <th>Accident Year</th>
                    <th>Paid/Incurred Loss</th>
                    <th>CDF to Ultimate</th>
                    <th>% Reported</th>
                    <th>Projected IBNR</th>
                    <th>Projected Ultimate</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedMethodDetail.results?.map((r: any, i) => (
                    <tr key={i}>
                      <td className="font-semibold">{r.ay}</td>
                      <td className="font-mono">{fmt(r.paid, currency)}</td>
                      <td className="font-mono">{r.cdfToUlt?.toFixed(4) || '—'}</td>
                      <td className="font-mono">{r.pctReported !== undefined ? `${r.pctReported.toFixed(1)}%` : '—'}</td>
                      <td className="font-mono">{fmt(r.ibnr, currency)}</td>
                      <td className="font-mono font-bold text-text-main">{fmt(r.ultimate, currency)}</td>
                    </tr>
                  ))}
                  <tr className="totals-row font-bold bg-bg-2/30">
                    <td>Total</td>
                    <td className="font-mono">
                      {fmt(selectedMethodDetail.results?.reduce((acc, r) => acc + (r.paid || 0), 0) || 0, currency)}
                    </td>
                    <td>—</td>
                    <td>—</td>
                    <td className="font-mono">{fmt(selectedMethodDetail.ibnr || 0, currency)}</td>
                    <td className="font-mono text-accent-green">{fmt(selectedMethodDetail.ultimate || 0, currency)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Narrative Process Flowchart */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-stretch">
              
              {/* Box 1: Required Inputs */}
              <div className="bg-bg-1 border border-border p-5 rounded-lg flex flex-col justify-between">
                <div>
                  <div className="text-[10px] font-bold text-blue-400 tracking-wider mb-3 flex items-center gap-1.5">
                    <span className="bg-blue-500 text-white w-4 h-4 rounded-full flex items-center justify-center text-[9px]">1</span>
                    REQUIRED INPUTS
                  </div>
                  <ul className="text-xs text-text-sub space-y-1.5 list-disc pl-4 font-sans">
                    <li>Loss development vectors</li>
                    <li>Tail factor: {(selectedMethodDetail.results?.[0]?.cdfToUlt || 1.0).toFixed(3)}</li>
                    {selectedMethodDetail.loss_ratio !== undefined && (
                      <li>Premium Volume data mapped</li>
                    )}
                  </ul>
                </div>
              </div>

              {/* Box 2: Mathematical Process */}
              <div className="bg-bg-1 border border-border p-5 rounded-lg flex flex-col justify-between md:col-span-2">
                <div>
                  <div className="text-[10px] font-bold text-accent tracking-wider mb-3 flex items-center gap-1.5">
                    <span className="bg-accent text-white w-4 h-4 rounded-full flex items-center justify-center text-[9px]">2</span>
                    MATHEMATICAL RESOURCING PROCESS
                  </div>
                  <p className="text-xs text-text-sub leading-relaxed font-sans">
                    {selectedMethodDetail 
                      ? (PROCESS_EXPLANATIONS[selectedMethodDetail.code || selectedMethodDetail.method || ''] || "Custom projection process.") 
                      : "Select a method to see process details."}
                  </p>
                </div>
              </div>
            </div>

            {/* Deep Dive Report Box */}
            <div className="bg-bg-1 border border-border p-5 rounded-lg mt-5">
              <div className="flex items-center justify-between mb-4">
                <div className="text-[10px] font-bold text-accent tracking-wider flex items-center gap-1.5">
                  <span className="bg-accent text-white w-4 h-4 rounded-full flex items-center justify-center text-[9px]">3</span>
                  AI DEEP DIVE ANALYSIS
                </div>
                {!modelReports[selectedDetailCode] && (
                  <button 
                    onClick={() => generateDeepDiveReport(selectedDetailCode)}
                    disabled={generatingReportFor === selectedDetailCode}
                    className="px-4 py-2 bg-accent hover:bg-accent-hover disabled:bg-bg-3 disabled:text-text-muted text-white text-[11px] font-bold rounded transition-colors flex items-center gap-2"
                  >
                    {generatingReportFor === selectedDetailCode ? (
                      <><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></span> Generating...</>
                    ) : 'Generate Analysis Report'}
                  </button>
                )}
              </div>
              
              {modelReports[selectedDetailCode] ? (
                <div 
                  className="text-[13px] text-text-sub leading-relaxed font-sans mt-2 pb-2"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(modelReports[selectedDetailCode]) }}
                />
              ) : (
                <div className="text-xs text-text-muted italic">
                  Generate a deep dive actuarial report tailored specifically to {selectedDetailCode}'s results.
                </div>
              )}
            </div>

            {/* Selected Method Trend Graphs */}
            {mounted && trendData.length > 0 && (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 pt-4">
                
                {/* 1. IBNR vs Paid Composition */}
                <div className="bg-bg-1 border border-border rounded-lg p-5">
                  <div className="text-xs font-semibold text-text-sub mb-4 uppercase tracking-wider">
                    Ultimate Composition (Paid vs IBNR)
                  </div>
                  <div className="w-full h-[230px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={trendData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                        <CartesianGrid stroke="rgba(255, 255, 255, 0.05)" vertical={false} />
                        <XAxis dataKey="ay" stroke="rgba(255, 255, 255, 0.4)" fontSize={10} tickLine={false} />
                        <YAxis stroke="rgba(255, 255, 255, 0.4)" fontSize={10} tickLine={false} tickFormatter={(v) => fmtShort(v, currency)} />
                        <Tooltip
                          contentStyle={{ backgroundColor: 'rgba(17, 24, 39, 0.95)', border: '1px solid #334155', borderRadius: '8px', color: '#fff' }}
                          formatter={(v: any) => fmt(v, currency)}
                        />
                        <Legend iconType="circle" wrapperStyle={{ fontSize: '10px' }} />
                        <Bar dataKey="paid" name="Paid/Incurred to Date" stackId="a" fill="#10b981" radius={[0, 0, 4, 4]} />
                        <Bar dataKey="ibnr" name="Projected IBNR" stackId="a" fill="#6366f1" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* 2. % Reported Trends */}
                <div className="bg-bg-1 border border-border rounded-lg p-5">
                  <div className="text-xs font-semibold text-text-sub mb-4 uppercase tracking-wider">
                    % Reported To Ultimate
                  </div>
                  <div className="w-full h-[230px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trendData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                        <CartesianGrid stroke="rgba(255, 255, 255, 0.05)" vertical={false} />
                        <XAxis dataKey="ay" stroke="rgba(255, 255, 255, 0.4)" fontSize={10} tickLine={false} />
                        <YAxis stroke="rgba(255, 255, 255, 0.4)" fontSize={10} tickLine={false} tickFormatter={(v) => `${v}%`} />
                        <Tooltip
                          contentStyle={{ backgroundColor: 'rgba(17, 24, 39, 0.95)', border: '1px solid #334155', borderRadius: '8px', color: '#fff' }}
                          formatter={(v: any) => `${v.toFixed(1)}%`}
                        />
                        <Line type="stepAfter" dataKey="pctReported" name="% Reported" stroke="#f59e0b" strokeWidth={2.5} dot={{ r: 4 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── ASOP Compliance Audit Report ── */}
      {auditState && Object.keys(auditState).length > 0 && (
        <div className="mt-8 border-t border-dashed border-white/10 pt-8">
          <div className="text-sm font-bold text-white mb-6 uppercase tracking-wider flex items-center gap-2">
            <svg className="w-5 h-5 text-accent-green" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            ASOP Compliance Audit Report
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {Object.entries(auditState).map(([category, rules]) => (
              <div key={category} className="bg-black/20 border border-white/10 rounded-lg p-5">
                <div className="text-xs font-semibold text-accent mb-4 uppercase tracking-wider border-b border-white/10 pb-2 text-indigo-300">
                  {category}
                </div>
                <div className="space-y-4">
                  {rules.map((ruleObj, idx) => (
                    <div key={idx} className="flex flex-col gap-1">
                      <div className="flex items-start justify-between gap-4">
                        <span className="text-xs font-medium text-white/90">{ruleObj.rule}</span>
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-sm uppercase tracking-wider whitespace-nowrap ${
                          ruleObj.status === 'PASS' ? 'bg-green-500/20 text-green-400 border border-green-500/30' :
                          ruleObj.status === 'FAIL' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                          ruleObj.status === 'WARNING' ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' :
                          ruleObj.status.includes('OVERRIDDEN') ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' :
                          'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                        }`}>
                          {ruleObj.status.replace('_', ' ')}
                        </span>
                      </div>
                      <div className="text-[10px] text-white/50 leading-relaxed">
                        {ruleObj.details}
                      </div>
                      
                      {ruleObj.status !== 'PASS' && !ruleObj.status.includes('OVERRIDDEN') && (
                        <div className="mt-2">
                          {editingRule === ruleObj.rule ? (
                            <div className="flex flex-col gap-2 mt-2 bg-black/40 p-2 rounded border border-white/5">
                              <textarea
                                className="w-full bg-bg-1 border border-white/10 rounded p-2 text-[10px] text-white focus:outline-none focus:border-accent"
                                rows={2}
                                placeholder="Document actuarial rationale here to override..."
                                value={overrideText}
                                onChange={e => setOverrideText(e.target.value)}
                              />
                              <div className="flex justify-end gap-2">
                                <button onClick={() => { setEditingRule(null); setOverrideText(''); }} className="px-2 py-1 text-[9px] font-bold text-white/60 hover:text-white uppercase tracking-wider">Cancel</button>
                                <button onClick={handleOverrideSubmit} className="px-2 py-1 text-[9px] font-bold bg-accent text-white rounded hover:bg-opacity-80 uppercase tracking-wider">Submit Override</button>
                              </div>
                            </div>
                          ) : (
                            <button
                              onClick={() => { setEditingRule(ruleObj.rule); setOverrideCategory(category); setOverrideText(''); }}
                              className="text-[9px] font-bold text-accent hover:text-white uppercase tracking-wider opacity-80 mt-1"
                            >
                              + Document Rationale
                            </button>
                          )}
                        </div>
                      )}
                      
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
