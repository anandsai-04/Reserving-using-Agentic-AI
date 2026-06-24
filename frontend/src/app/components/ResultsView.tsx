'use client';
import React, { useState, useEffect } from 'react';
import { ExecuteResult } from '../types';
import { fmt, fmtShort, CurrencyCode } from '../utils';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
  LineChart,
  Line,
  Legend,
} from 'recharts';

interface ResultsViewProps {
  data: ExecuteResult;
  currency?: CurrencyCode;
  onBack: () => void;
}

export default function ResultsView({ data, currency = 'USD', onBack }: ResultsViewProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // 1. Prepare dynamic columns for results table
  let keys: string[] = [];
  let trendData: any[] = [];
  if (data.results && data.results.length > 0) {
    const keySet = new Set<string>();
    data.results.forEach((r) => Object.keys(r).forEach((k) => keySet.add(k)));
    keys = Array.from(keySet);

    trendData = data.results.map((r: any) => ({
      ay: r.ay,
      paid: parseFloat(r.paid) || 0,
      ibnr: parseFloat(r.ibnr) || 0,
      ultimate: parseFloat(r.ultimate) || 0,
      pctReported: (parseFloat(r.pctReported) || 0) * 100,
      settlementRate: parseFloat(r.ultimate) ? ((parseFloat(r.paid) || 0) / parseFloat(r.ultimate)) * 100 : 0
    }));
  }

  const lrTrendData = data.loss_ratios?.map((r: any) => ({
    ay: r.accident_year,
    paid_lr: r.paid_lr_pct,
    ultimate_lr: r.ultimate_lr_pct
  })) || [];

  const coreKeys = ['ay', 'paid', 'cdfToUlt', 'pctReported', 'ultimate', 'ibnr'];
  const extraKeys = keys.filter((k) => !coreKeys.includes(k));
  const finalKeys = [...coreKeys.filter((k) => keys.includes(k)), ...extraKeys];

  const headerMap: Record<string, string> = {
    ay: 'Accident Year',
    paid: 'Paid Claims',
    cdfToUlt: 'CDF to Ultimate',
    pctReported: '% Reported',
    ultimate: 'Ultimate Claims',
    ibnr: 'IBNR',
  };

  // Compute totals for results table
  const totalPaid = data.results?.reduce((acc, r) => acc + (parseFloat(r.paid) || 0), 0) || 0;
  const totalUlt = data.results?.reduce((acc, r) => acc + (parseFloat(r.ultimate) || 0), 0) || 0;
  const totalIBNR = data.results?.reduce((acc, r) => acc + (parseFloat(r.ibnr) || 0), 0) || 0;

  // Format cell helper
  const formatCell = (key: string, val: any) => {
    if (typeof val === 'number') {
      if (key === 'ay' || key === 'pctReported' || key.includes('ELR') || key.includes('cdf')) {
        if (key === 'pctReported') {
          return `${(val * 100).toFixed(1)}%`;
        }
        return val;
      }
      return fmt(val, currency);
    }
    return val != null ? val : '—';
  };

  // 2. Parse AI Narration JSON
  let report: any = null;
  if (data.narration) {
    try {
      const cleanJson = data.narration.replace(/```json/g, '').replace(/```/g, '').trim();
      report = JSON.parse(cleanJson);
    } catch (e) {
      // Fallback if not JSON
      report = { raw: data.narration };
    }
  }

  // Inputs rendering
  const renderInputs = () => {
    if (!report || !report.inputs) return 'Detailed inputs unavailable.';
    if (Array.isArray(report.inputs)) {
      return (
        <ul className="list-disc pl-5 text-white/90 gap-1 flex flex-col">
          {report.inputs.map((inp: string, index: number) => (
            <li key={index}>{inp}</li>
          ))}
        </ul>
      );
    }
    if (typeof report.inputs === 'object' && report.inputs !== null) {
      return (
        <ul className="list-disc pl-5 text-white/90 gap-1 flex flex-col">
          {Object.entries(report.inputs).map(([k, v]: any) => (
            <li key={k}>
              <strong>{k}:</strong> {v}
            </li>
          ))}
        </ul>
      );
    }
    return <p className="text-white/90 leading-relaxed">{report.inputs}</p>;
  };

  // Graph Data
  const chartData =
    mounted && data.dev_ages && data.ldfs
      ? data.dev_ages.map((age, idx) => ({
          name: `${age}m`,
          ldf: data.ldfs[idx] || 0,
        }))
      : [];

  // Environmental sensitivity colors
  const impactColor: Record<string, string> = {
    SEVERE: 'text-red-400 border-red-500/30 bg-red-500/10',
    MODERATE: 'text-orange-400 border-orange-500/30 bg-orange-500/10',
    SLIGHT: 'text-yellow-400 border-yellow-500/30 bg-yellow-500/10',
    NONE: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
  };

  return (
    <div className="flex flex-col flex-1 animate-slide-in pb-10">
      <div className="view-header flex justify-between items-start mb-5">
        <div>
          <h2 className="text-lg font-bold text-text-main">IBNR Results</h2>
        </div>
        <button
          onClick={onBack}
          className="px-3.5 py-1.5 bg-transparent border border-border-2 rounded text-xs text-text-sub hover:border-text-sub hover:text-text-main transition-colors cursor-pointer"
        >
          ← Back
        </button>
      </div>

      {/* KPI Blocks */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
        <div className="bg-bg-1 border border-border rounded-lg p-4.5">
          <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-1.5">
            Total IBNR
          </div>
          <div className="text-2xl font-bold font-mono text-text-main tracking-tight">
            {fmt(data.totalIBNR, currency)}
          </div>
        </div>
        <div className="bg-bg-1 border border-border rounded-lg p-4.5">
          <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-1.5">
            Total Ultimate
          </div>
          <div className="text-2xl font-bold font-mono text-text-main tracking-tight">
            {fmt(data.totalUlt, currency)}
          </div>
        </div>
      </div>

      {/* Premium On-Leveling comparison table */}
      {data.olf_results && data.olf_results.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-bold text-accent mb-3 uppercase tracking-wider">
            Premium On-Leveling Results
          </h3>
          <div className="table-scroll border border-accent/30 rounded-lg bg-bg-1">
            <table className="results-table w-full">
              <thead>
                <tr>
                  <th>Accident Year</th>
                  <th>Historical Premium</th>
                  <th>Avg Rate Level</th>
                  <th>On-Level Factor (OLF)</th>
                  <th>On-Level Premium</th>
                </tr>
              </thead>
              <tbody>
                {data.olf_results.map((r, idx) => (
                  <tr key={idx}>
                    <td>{r.accident_year}</td>
                    <td>{fmt(r.earned_premium, currency)}</td>
                    <td>{r.average_rate_level.toFixed(4)}</td>
                    <td>{r.olf.toFixed(4)}</td>
                    <td className="text-accent-green font-bold">{fmt(r.on_level_premium, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Actuarial Results Matrix */}
      {data.results && data.results.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-bold text-accent mb-3 uppercase tracking-wider">
            Actuarial Calculations
          </h3>
          <div className="table-scroll border border-border rounded-lg bg-bg-1">
            <table className="results-table w-full">
              <thead>
                <tr>
                  {finalKeys.map((k) => (
                    <th key={k}>{headerMap[k] || k.charAt(0).toUpperCase() + k.slice(1)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.results.map((r, idx) => (
                  <tr key={idx}>
                    {finalKeys.map((k) => (
                      <td key={k}>{formatCell(k, r[k])}</td>
                    ))}
                  </tr>
                ))}
                {/* Summary Totals Row */}
                <tr className="totals-row">
                  <td>Total</td>
                  {finalKeys.slice(1).map((k, idx) => {
                    if (k === 'paid') return <td key={idx}>{fmt(totalPaid, currency)}</td>;
                    if (k === 'ultimate') return <td key={idx}>{fmt(totalUlt, currency)}</td>;
                    if (k === 'ibnr') return <td key={idx}>{fmt(totalIBNR, currency)}</td>;
                    return <td key={idx}>—</td>;
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Loss Ratios table */}
      {data.loss_ratios && data.loss_ratios.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-bold text-accent mb-3 uppercase tracking-wider">
            Loss Ratios
          </h3>
          <div className="table-scroll border border-accent/30 rounded-lg bg-bg-1">
            <table className="results-table w-full">
              <thead>
                <tr>
                  <th>Accident Year</th>
                  <th>Premium</th>
                  <th>Paid LR</th>
                  <th>Ultimate LR</th>
                </tr>
              </thead>
              <tbody>
                {data.loss_ratios.map((r, idx) => (
                  <tr key={idx}>
                    <td>{r.accident_year}</td>
                    <td>{fmt(r.premium, currency)}</td>
                    <td>{r.paid_lr_pct !== null ? `${r.paid_lr_pct.toFixed(1)}%` : '—'}</td>
                    <td className="text-accent-green font-bold">
                      {r.ultimate_lr_pct !== null ? `${r.ultimate_lr_pct.toFixed(1)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.suggested_elr && (
            <div className="mt-2 text-xs font-semibold text-accent">
              Cape Cod Suggested A Priori ELR: {data.suggested_elr.toFixed(1)}%
            </div>
          )}
        </div>
      )}

      {/* LDF Stability Diagnostics table */}
      {data.ldf_stability && data.ldf_stability.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-bold text-accent mb-3 uppercase tracking-wider">
            LDF Stability Diagnostics
          </h3>
          <div className="table-scroll border border-accent/30 rounded-lg bg-bg-1">
            <table className="results-table w-full">
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
              <tbody>
                {data.ldf_stability.map((r, idx) => {
                  const isHigh = r.stability === 'High';
                  const isMod = r.stability === 'Moderate';
                  const stabClass = isHigh ? 'text-accent-green' : isMod ? 'text-accent-amber' : 'text-accent-red';

                  return (
                    <tr key={idx}>
                      <td>{r.from_age}-{r.to_age}</td>
                      <td>{r.n}</td>
                      <td>{r.vw !== null ? r.vw.toFixed(3) : '—'}</td>
                      <td>{r.cov_pct !== null ? `${r.cov_pct.toFixed(1)}%` : '—'}</td>
                      <td>
                        <span className={`font-bold ${stabClass}`}>{r.stability}</span>
                      </td>
                      <td>{r.credibility}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Structured AI Report / Flowchart */}
      {report && (
        <div className="mt-6 border-t border-border pt-6">
          <h2 className="text-base font-bold text-text-main mb-5">Execution Report</h2>

          {report.raw ? (
            <div className="p-4 bg-white/5 border border-white/10 rounded-lg text-xs leading-relaxed white-space-pre-wrap">
              {report.raw}
            </div>
          ) : (
            <div className="flex flex-col gap-2 max-w-3xl mx-auto w-full">
              
              {/* Box 1: Required Inputs */}
              <div className="bg-white/3 p-5 rounded-lg border border-white/8 shadow-md">
                <div className="text-[11px] font-bold text-blue-400 tracking-wider mb-3 flex items-center gap-2">
                  <span className="bg-blue-500 text-white w-4.5 h-4.5 rounded-full flex items-center justify-center text-[10px]">
                    1
                  </span>
                  REQUIRED INPUTS
                </div>
                <div className="text-xs font-normal text-white/95 leading-relaxed">{renderInputs()}</div>
              </div>

              {/* Arrow 1 */}
              <div className="text-center text-white/20 text-lg">↓</div>

              {/* Box 2: Mathematical Process */}
              <div className="bg-white/3 p-5 rounded-lg border border-white/8 shadow-md">
                <div className="text-[11px] font-bold text-blue-400 tracking-wider mb-3 flex items-center gap-2">
                  <span className="bg-blue-500 text-white w-4.5 h-4.5 rounded-full flex items-center justify-center text-[10px]">
                    2
                  </span>
                  MATHEMATICAL PROCESS
                </div>
                <div className="text-xs text-white/95 leading-relaxed mb-5">{report.process}</div>

                {/* Recharts LDF Chart */}
                {mounted && chartData.length > 0 && (
                  <div className="mb-5 p-4 bg-black/20 border border-white/5 rounded-lg">
                    <div className="text-xs font-semibold text-accent-green mb-3 uppercase tracking-wider">
                      LDF Decay Curve Visualizer
                    </div>
                    <div className="w-full h-[250px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                          <defs>
                            <linearGradient id="ldfGradient" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.2} />
                              <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid stroke="rgba(255, 255, 255, 0.05)" vertical={false} />
                          <XAxis dataKey="name" stroke="rgba(255, 255, 255, 0.4)" fontSize={10} tickLine={false} />
                          <YAxis stroke="rgba(255, 255, 255, 0.4)" fontSize={10} tickLine={false} domain={['auto', 'auto']} />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: 'rgba(17, 24, 39, 0.95)',
                              border: '1px solid #a78bfa',
                              borderRadius: '8px',
                              color: '#fff',
                            }}
                          />
                          <Area
                            type="monotone"
                            dataKey="ldf"
                            stroke="#a78bfa"
                            strokeWidth={2.5}
                            fill="url(#ldfGradient)"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {/* Sub reports */}
                <div className="flex flex-col gap-4 border-t border-dashed border-white/10 pt-4 text-xs">
                  <div>
                    <strong className="block text-accent uppercase text-[10px] tracking-wider mb-1">
                      6-Criteria LDF Analysis
                    </strong>
                    <div className="text-white/80 leading-relaxed">
                      {report.ldf_analysis || 'No analysis available.'}
                    </div>
                  </div>

                  <div className="border-t border-dashed border-white/10 pt-4">
                    <strong className="block text-accent uppercase text-[10px] tracking-wider mb-1">
                      Tail Factor Selection
                    </strong>
                    <div className="text-white/80 leading-relaxed">
                      {report.tail_factor_selection || 'No tail factor selection details provided.'}
                    </div>
                  </div>

                  <div className="border-t border-dashed border-white/10 pt-4">
                    <strong className="block text-accent uppercase text-[10px] tracking-wider mb-1">
                      Impact of Exposures
                    </strong>
                    <div className="text-white/80 leading-relaxed">
                      {report.impact || 'No impact analysis provided.'}
                    </div>
                  </div>

                  {/* Environmental Sensitivity */}
                  {report.environment_sensitivity && (
                    <div className="border-t border-dashed border-white/10 pt-4">
                      <strong className="block text-orange-400 uppercase text-[10px] tracking-wider mb-3">
                        ⚠ Environmental Sensitivity Analysis
                      </strong>
                      <div className="table-scroll">
                        <table className="w-full text-xs text-left border-collapse">
                          <thead>
                            <tr className="bg-white/4">
                              <th className="p-2 text-white/50 text-[10px] uppercase font-bold tracking-wider border-b border-white/10">
                                Environmental Factor
                              </th>
                              <th className="p-2 text-center text-white/50 text-[10px] uppercase font-bold tracking-wider border-b border-white/10 w-24">
                                Impact
                              </th>
                              <th className="p-2 text-white/50 text-[10px] uppercase font-bold tracking-wider border-b border-white/10">
                                Explanation
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {[
                              ['Changing Product Mix / Exposures', report.environment_sensitivity.changing_product_mix],
                              ['Increasing Claim Ratios', report.environment_sensitivity.increasing_claim_ratios],
                              ['Case Outstanding Strengthening', report.environment_sensitivity.case_outstanding_strengthening],
                              ['Changing Settlement Rates', report.environment_sensitivity.changing_settlement_rates],
                            ].map(([label, info]: any, idx) => {
                              if (!info) return null;
                              const badgeClass = impactColor[info.impact] || 'text-text-sub border-border';
                              return (
                                <tr key={idx} className="border-b border-white/5 last:border-0 hover:bg-white/1">
                                  <td className="p-2.5 font-semibold text-white/85 w-[30%]">
                                    {label}
                                  </td>
                                  <td className="p-2.5 text-center">
                                    <span className={`inline-block px-2.5 py-0.5 border rounded-full text-[10px] font-bold ${badgeClass}`}>
                                      {info.impact}
                                    </span>
                                  </td>
                                  <td className="p-2.5 text-text-sub text-[11.5px] leading-relaxed">
                                    {info.explanation}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Arrow 2 */}
              <div className="text-center text-accent-green/40 text-lg">↓</div>

              {/* Box 3: Output */}
              <div className="bg-accent-green/5 p-5 rounded-lg border border-accent-green/30 shadow-md">
                <div className="text-[11px] font-bold text-accent-green tracking-wider mb-3 flex items-center gap-2">
                  <span className="bg-accent-green text-white w-4.5 h-4.5 rounded-full flex items-center justify-center text-[10px]">
                    3
                  </span>
                  FINAL OUTPUT &amp; RECOMMENDATION
                </div>
                <div className="text-xs text-white/95 leading-relaxed mb-5">
                  {report.output_text}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  {Object.entries(report.output_numbers || {}).map(([k, v]: any) => (
                    <div
                      key={k}
                      className="bg-black/30 border border-accent-green/15 rounded-lg p-4 flex flex-col items-center justify-center text-center"
                    >
                      <span className="text-white/60 text-[10px] font-semibold uppercase tracking-wider mb-2">
                        {k}
                      </span>
                      <span className="font-bold text-accent-green text-2xl font-mono">
                        {fmt(v, currency)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Diagnostic Trend Graphs ── */}
      {mounted && trendData.length > 0 && (
        <div className="mt-8 border-t border-dashed border-white/10 pt-8">
          <div className="text-sm font-bold text-white mb-6 uppercase tracking-wider">
            Diagnostic Trends By Accident Year
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            
            {/* 1. IBNR vs Paid Composition */}
            <div className="bg-bg-1 border border-border rounded-lg p-5">
              <div className="text-xs font-semibold text-text-sub mb-4 uppercase tracking-wider">
                Ultimate Composition (Paid vs IBNR)
              </div>
              <div className="w-full h-[250px]">
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
                    <Bar dataKey="paid" name="Paid Claims" stackId="a" fill="#10b981" radius={[0, 0, 4, 4]} />
                    <Bar dataKey="ibnr" name="IBNR" stackId="a" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* 2. Settlement Rate / Paid-to-Ultimate */}
            <div className="bg-bg-1 border border-border rounded-lg p-5">
              <div className="text-xs font-semibold text-text-sub mb-4 uppercase tracking-wider">
                Settlement Rate (Paid to Ultimate)
              </div>
              <div className="w-full h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trendData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="settlementGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="rgba(255, 255, 255, 0.05)" vertical={false} />
                    <XAxis dataKey="ay" stroke="rgba(255, 255, 255, 0.4)" fontSize={10} tickLine={false} />
                    <YAxis stroke="rgba(255, 255, 255, 0.4)" fontSize={10} tickLine={false} tickFormatter={(v) => `${v}%`} />
                    <Tooltip
                      contentStyle={{ backgroundColor: 'rgba(17, 24, 39, 0.95)', border: '1px solid #334155', borderRadius: '8px', color: '#fff' }}
                      formatter={(v: any) => `${v.toFixed(1)}%`}
                    />
                    <Area type="monotone" dataKey="settlementRate" name="Settlement Rate" stroke="#10b981" strokeWidth={2.5} fill="url(#settlementGradient)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* 3. Loss Ratio Trends */}
            {lrTrendData.length > 0 && (
              <div className="bg-bg-1 border border-border rounded-lg p-5">
                <div className="text-xs font-semibold text-text-sub mb-4 uppercase tracking-wider">
                  Loss Ratio Trends
                </div>
                <div className="w-full h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={lrTrendData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                      <CartesianGrid stroke="rgba(255, 255, 255, 0.05)" vertical={false} />
                      <XAxis dataKey="ay" stroke="rgba(255, 255, 255, 0.4)" fontSize={10} tickLine={false} />
                      <YAxis stroke="rgba(255, 255, 255, 0.4)" fontSize={10} tickLine={false} tickFormatter={(v) => `${v}%`} />
                      <Tooltip
                        contentStyle={{ backgroundColor: 'rgba(17, 24, 39, 0.95)', border: '1px solid #334155', borderRadius: '8px', color: '#fff' }}
                        formatter={(v: any) => `${v.toFixed(1)}%`}
                      />
                      <Legend iconType="circle" wrapperStyle={{ fontSize: '10px' }} />
                      <Line type="monotone" dataKey="paid_lr" name="Paid LR" stroke="#64748b" strokeWidth={2} dot={{ r: 3 }} />
                      <Line type="monotone" dataKey="ultimate_lr" name="Ultimate LR" stroke="#a78bfa" strokeWidth={2.5} dot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* 4. % Reported Trends */}
            <div className="bg-bg-1 border border-border rounded-lg p-5">
              <div className="text-xs font-semibold text-text-sub mb-4 uppercase tracking-wider">
                % Reported To Ultimate
              </div>
              <div className="w-full h-[250px]">
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
        </div>
      )}
    </div>
  );
}
