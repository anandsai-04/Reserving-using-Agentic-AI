'use client';
import React, { useState, useEffect, useMemo } from 'react';
import { TriangleData, SummaryData } from '../types';
import { fmtShort, CurrencyCode } from '../utils';
import ExportMenu from './ExportMenu';
import { downloadCSV, downloadExcel, downloadPDF, SheetDef, TableDef } from '../exportUtils';

interface TriangleViewProps {
  triangle: TriangleData;
  summary: SummaryData;
  currency?: CurrencyCode;
  ldfBase: string;
  onChangeLdfBase: (base: string) => void;
  customLDFs: number[];
  onChangeCustomLDFs: (ldfs: number[]) => void;
  tailFactor: number;
  onChangeTailFactor: (val: number) => void;
  incurredLdfBase: string;
  onChangeIncurredLdfBase: (base: string) => void;
  customIncurredLDFs: number[];
  onChangeCustomIncurredLDFs: (ldfs: number[]) => void;
  incurredTailFactor: number;
  onChangeIncurredTailFactor: (val: number) => void;
  onProceed: () => void;
  onUpdateEntities: (selectedEntities: string[] | null) => Promise<void>;
}

export default function TriangleView({
  triangle,
  summary,
  currency = 'USD',
  ldfBase,
  onChangeLdfBase,
  customLDFs,
  onChangeCustomLDFs,
  tailFactor,
  onChangeTailFactor,
  incurredLdfBase,
  onChangeIncurredLdfBase,
  customIncurredLDFs,
  onChangeCustomIncurredLDFs,
  incurredTailFactor,
  onChangeIncurredTailFactor,
  onProceed,
  onUpdateEntities,
}: TriangleViewProps) {
  const [inputs, setInputs] = useState<string[]>([]);
  const [incurredInputs, setIncurredInputs] = useState<string[]>([]);
  
  // Entity states
  const [entityMode, setEntityMode] = useState<'all' | 'single' | 'custom'>('all');
  const [singleEntity, setSingleEntity] = useState<string>('');
  const [chosenEntities, setChosenEntities] = useState<string[]>([]);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    setInputs(customLDFs.map((v) => v.toFixed(4)));
  }, [customLDFs]);

  useEffect(() => {
    setIncurredInputs(customIncurredLDFs.map((v) => v.toFixed(4)));
  }, [customIncurredLDFs]);

  // Sync entity states with summary updates
  useEffect(() => {
    if (summary.selected_entities) {
      if (summary.selected_entities.length === 1) {
        setEntityMode('single');
        setSingleEntity(summary.selected_entities[0]);
        setChosenEntities(summary.selected_entities);
      } else {
        setEntityMode('custom');
        setChosenEntities(summary.selected_entities);
      }
    } else {
      setEntityMode('all');
      setChosenEntities([]);
    }
  }, [summary]);

  const handleLdfChange = (idx: number, valStr: string) => {
    const updatedInputs = [...inputs];
    updatedInputs[idx] = valStr;
    setInputs(updatedInputs);

    const val = parseFloat(valStr);
    if (!isNaN(val)) {
      const updatedLDFs = [...customLDFs];
      updatedLDFs[idx] = val;
      onChangeCustomLDFs(updatedLDFs);
    }
  };

  const handleIncurredLdfChange = (idx: number, valStr: string) => {
    const updatedInputs = [...incurredInputs];
    updatedInputs[idx] = valStr;
    setIncurredInputs(updatedInputs);

    const val = parseFloat(valStr);
    if (!isNaN(val)) {
      const updatedLDFs = [...customIncurredLDFs];
      updatedLDFs[idx] = val;
      onChangeCustomIncurredLDFs(updatedLDFs);
    }
  };

  const hasIncurred = useMemo(() => {
    return (
      triangle.incurred_matrix &&
      triangle.incurred_matrix.length > 0 &&
      triangle.incurred_matrix.some((row) => row && row.some((v) => v !== null))
    );
  }, [triangle]);

  const linkRatiosMatrix = useMemo(() => {
    return triangle.matrix.map((row) => {
      const linkRatios: (number | null)[] = [];
      for (let j = 0; j < row.length - 1; j++) {
        const cur = row[j];
        const nxt = row[j + 1];
        if (cur !== null && nxt !== null && cur !== 0) {
          linkRatios.push(nxt / cur);
        } else {
          linkRatios.push(null);
        }
      }
      return linkRatios;
    });
  }, [triangle.matrix]);

  const incurredLinkRatiosMatrix = useMemo(() => {
    if (!triangle.incurred_matrix) return [];
    return triangle.incurred_matrix.map((row) => {
      const linkRatios: (number | null)[] = [];
      for (let j = 0; j < row.length - 1; j++) {
        const cur = row[j];
        const nxt = row[j + 1];
        if (cur !== null && nxt !== null && cur !== 0) {
          linkRatios.push(nxt / cur);
        } else {
          linkRatios.push(null);
        }
      }
      return linkRatios;
    });
  }, [triangle.incurred_matrix]);

  const linkRatioHeaders = useMemo(() => {
    const headers: string[] = [];
    for (let i = 0; i < triangle.devAges.length - 1; i++) {
      headers.push(`${triangle.devAges[i]}-${triangle.devAges[i + 1]}`);
    }
    return headers;
  }, [triangle.devAges]);

  const getLdfRow = (label: string, key: 'volumeWeighted' | 'straightAvg' | 'weighted3yr' | 'weighted5yr') => {
    const isActive = ldfBase === key;
    return (
      <tr className={`ldf-row ${isActive ? 'active-row bg-accent-dim/15 font-semibold text-text-main' : ''}`}>
        <td className="tri-ay">{label}</td>
        {triangle.ldfs.slice(0, -1).map((s, idx) => {
          const val = s[key];
          return (
            <td
              key={idx}
              className={`ldf-cell ${isActive ? 'active-base text-accent font-bold' : ''}`}
            >
              {val !== null ? val.toFixed(3) : '—'}
            </td>
          );
        })}
        <td></td>
      </tr>
    );
  };

  const getIncurredLdfRow = (label: string, key: 'volumeWeighted' | 'straightAvg' | 'weighted3yr' | 'weighted5yr') => {
    const isActive = incurredLdfBase === key;
    const ldfs = triangle.incurred_ldfs || [];
    return (
      <tr className={`ldf-row ${isActive ? 'active-row bg-accent-dim/15 font-semibold text-text-main' : ''}`}>
        <td className="tri-ay">{label}</td>
        {ldfs.slice(0, -1).map((s, idx) => {
          const val = s[key];
          return (
            <td
              key={idx}
              className={`ldf-cell ${isActive ? 'active-base text-accent font-bold' : ''}`}
            >
              {val !== null ? val.toFixed(3) : '—'}
            </td>
          );
        })}
        <td></td>
      </tr>
    );
  };

  const handleApplyEntities = async (mode: 'all' | 'single' | 'custom', items?: string[]) => {
    setIsUpdating(true);
    try {
      if (mode === 'all') {
        await onUpdateEntities(null);
      } else if (mode === 'single') {
        const selected = items ? items[0] : singleEntity || (summary.entities && summary.entities[0]) || '';
        if (selected) {
          await onUpdateEntities([selected]);
        }
      } else {
        await onUpdateEntities(items || chosenEntities);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsUpdating(false);
    }
  };

  // Check if checkboxes configuration differs from what is saved in summary
  const isCustomEntityChanged = useMemo(() => {
    const orig = summary.selected_entities || null;
    if (entityMode !== 'custom') return false;
    if (orig === null) return chosenEntities.length > 0;
    if (orig.length !== chosenEntities.length) return true;
    const origSet = new Set(orig);
    return chosenEntities.some(e => !origSet.has(e));
  }, [entityMode, chosenEntities, summary]);

  // ── Export Handlers ─────────────────────────────────────────────────────────

  const buildTriangleSheets = () => {
    const devHeaders = ['Accident Year', ...triangle.devAges.map((d) => `${d}mo`)];

    // Paid triangle
    const paidRows = triangle.accidentYears.map((ay, i) => [
      ay,
      ...triangle.matrix[i].map((v) => (v !== null ? Math.round(v) : null)),
    ]);

    // Incurred triangle (if present)
    const hasInc =
      triangle.incurred_matrix &&
      triangle.incurred_matrix.some((r) => r && r.some((v) => v !== null));
    const incRows = hasInc
      ? triangle.accidentYears.map((ay, i) => [
          ay,
          ...triangle.incurred_matrix[i].map((v) =>
            v !== null ? Math.round(v) : null
          ),
        ])
      : [];

    // Paid Age-to-Age factors (link ratios)
    const ageToAgeHeaders = ['Accident Year', ...linkRatioHeaders.map((h) => `${h}mo`)];
    const paidAgeToAgeRows = triangle.accidentYears.map((ay, i) => [
      ay,
      ...linkRatiosMatrix[i].map((v) => (v !== null ? Number(v.toFixed(4)) : null)),
    ]);

    // Incurred Age-to-Age factors (link ratios)
    const incAgeToAgeRows = hasInc
      ? triangle.accidentYears.map((ay, i) => [
          ay,
          ...incurredLinkRatiosMatrix[i].map((v) => (v !== null ? Number(v.toFixed(4)) : null)),
        ])
      : [];

    const ldfKeys: Array<'volumeWeighted' | 'straightAvg' | 'weighted3yr' | 'weighted5yr'> = [
      'volumeWeighted',
      'straightAvg',
      'weighted3yr',
      'weighted5yr',
    ];
    const ldfLabels = [
      'Volume Weighted',
      'Straight Average',
      '3-Year Weighted',
      '5-Year Weighted',
    ];

    // Paid LDFs
    const paidLdfHeaders = [
      'Period',
      ...triangle.ldfs.map((l) =>
        l.isTail ? 'Tail' : `${l.fromAge}→${l.toAge}mo`
      ),
    ];
    const paidLdfRows = ldfKeys.map((k, ki) => [
      ldfLabels[ki],
      ...triangle.ldfs.map((l) => {
        const v = l[k];
        return v !== null ? Number(v.toFixed(4)) : null;
      }),
    ]);

    // Incurred LDFs
    const incLdfs = triangle.incurred_ldfs || [];
    const incLdfHeaders = [
      'Period',
      ...incLdfs.map((l) =>
        l.isTail ? 'Tail' : `${l.fromAge}→${l.toAge}mo`
      ),
    ];
    const incLdfRows = hasInc
      ? ldfKeys.map((k, ki) => [
          ldfLabels[ki],
          ...incLdfs.map((l) => {
            const v = l[k];
            return v !== null ? Number(v.toFixed(4)) : null;
          }),
        ])
      : [];

    return {
      hasInc,
      paidTriangle: { headers: devHeaders, rows: paidRows },
      incTriangle: hasInc ? { headers: devHeaders, rows: incRows } : null,
      paidAgeToAge: { headers: ageToAgeHeaders, rows: paidAgeToAgeRows },
      incAgeToAge: hasInc ? { headers: ageToAgeHeaders, rows: incAgeToAgeRows } : null,
      paidLdf: { headers: paidLdfHeaders, rows: paidLdfRows },
      incLdf: hasInc ? { headers: incLdfHeaders, rows: incLdfRows } : null,
    };
  };

  const handleTriangleExportCSV = () => {
    const { hasInc, paidTriangle, incTriangle, paidAgeToAge, incAgeToAge, paidLdf, incLdf } = buildTriangleSheets();
    
    const lines = [
      '# Paid Loss Triangle',
      paidTriangle.headers.join(','),
      ...paidTriangle.rows.map((r) => r.map((v) => (v === null ? '' : String(v))).join(',')),
      '',
      '# Paid Age-to-Age Factors',
      paidAgeToAge.headers.join(','),
      ...paidAgeToAge.rows.map((r) => r.map((v) => (v === null ? '' : String(v))).join(',')),
      '',
      '# Paid LDF Table',
      paidLdf.headers.join(','),
      ...paidLdf.rows.map((r) => r.map((v) => (v === null ? '' : String(v))).join(',')),
    ];

    if (hasInc && incTriangle && incAgeToAge && incLdf) {
      lines.push(
        '',
        '# Incurred Loss Triangle',
        incTriangle.headers.join(','),
        ...incTriangle.rows.map((r) => r.map((v) => (v === null ? '' : String(v))).join(',')),
        '',
        '# Incurred Age-to-Age Factors',
        incAgeToAge.headers.join(','),
        ...incAgeToAge.rows.map((r) => r.map((v) => (v === null ? '' : String(v))).join(',')),
        '',
        '# Incurred LDF Table',
        incLdf.headers.join(','),
        ...incLdf.rows.map((r) => r.map((v) => (v === null ? '' : String(v))).join(','))
      );
    }

    const blob = new Blob(['\uFEFF' + lines.join('\n')], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'loss_triangle_and_ldfs.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleTriangleExportExcel = async () => {
    const { hasInc, paidTriangle, incTriangle, paidAgeToAge, incAgeToAge, paidLdf, incLdf } = buildTriangleSheets();

    const sheets: SheetDef[] = [
      { name: 'Paid Triangle', headers: paidTriangle.headers, rows: paidTriangle.rows },
      { name: 'Paid Age-to-Age', headers: paidAgeToAge.headers, rows: paidAgeToAge.rows },
      { name: 'Paid LDFs', headers: paidLdf.headers, rows: paidLdf.rows },
    ];

    if (hasInc && incTriangle && incAgeToAge && incLdf) {
      sheets.push(
        { name: 'Incurred Triangle', headers: incTriangle.headers, rows: incTriangle.rows },
        { name: 'Incurred Age-to-Age', headers: incAgeToAge.headers, rows: incAgeToAge.rows },
        { name: 'Incurred LDFs', headers: incLdf.headers, rows: incLdf.rows }
      );
    }

    await downloadExcel('loss_triangle_and_ldfs.xlsx', sheets);
  };

  const handleTriangleExportPDF = async () => {
    const { hasInc, paidTriangle, incTriangle, paidAgeToAge, incAgeToAge, paidLdf, incLdf } = buildTriangleSheets();

    const tables: TableDef[] = [
      { title: 'Paid Loss Triangle', headers: paidTriangle.headers, rows: paidTriangle.rows },
      { title: 'Paid Age-to-Age Factors', headers: paidAgeToAge.headers, rows: paidAgeToAge.rows },
      { title: 'Paid Loss Development Factors (LDF) Table', headers: paidLdf.headers, rows: paidLdf.rows },
    ];

    if (hasInc && incTriangle && incAgeToAge && incLdf) {
      tables.push(
        { title: 'Incurred Loss Triangle', headers: incTriangle.headers, rows: incTriangle.rows },
        { title: 'Incurred Age-to-Age Factors', headers: incAgeToAge.headers, rows: incAgeToAge.rows },
        { title: 'Incurred Loss Development Factors (LDF) Table', headers: incLdf.headers, rows: incLdf.rows }
      );
    }

    await downloadPDF('loss_triangle_and_ldfs.pdf', 'Loss Development Triangle & LDF Report', tables);
  };

  return (
    <div className="flex flex-col flex-1 animate-slide-in space-y-6 overflow-y-auto pr-1">
      
      {/* ── Entity Filter & Scope Panel ────────────────────────────────── */}
      {summary.inspection?.is_multi_entity && summary.entities && summary.entities.length > 0 && (
        <div className="bg-bg-1 border border-border rounded-lg p-4.5 relative overflow-hidden">
          {isUpdating && (
            <div className="absolute inset-0 bg-bg-1/70 z-10 flex items-center justify-center text-xs font-mono font-bold text-accent">
              ⏳ Rebuilding loss triangles...
            </div>
          )}
          
          <div className="flex items-center justify-between border-b border-border/80 pb-2 mb-3">
            <span className="text-xs font-bold text-text-main uppercase tracking-wider">
              Entity Scope Analysis Filter
            </span>
            <span className="text-[10px] text-text-muted">
              Partition Column: <code className="font-mono bg-bg-2 px-1.5 py-0.5 rounded border border-border/60">{summary.inspection.entity_column}</code>
            </span>
          </div>

          <div className="flex flex-wrap gap-5 items-center text-xs">
            {/* Scope selectors */}
            <div className="flex gap-4 items-center">
              <label className="flex items-center gap-1.5 cursor-pointer text-text-main font-medium select-none">
                <input
                  type="radio"
                  name="tri_entity_mode"
                  checked={entityMode === 'all'}
                  onChange={() => {
                    setEntityMode('all');
                    handleApplyEntities('all');
                  }}
                  className="accent-accent w-4 h-4 cursor-pointer"
                />
                All Entities Aggregated
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer text-text-main font-medium select-none">
                <input
                  type="radio"
                  name="tri_entity_mode"
                  checked={entityMode === 'single'}
                  onChange={() => {
                    setEntityMode('single');
                    const initialVal = singleEntity || (summary.entities && summary.entities[0]) || '';
                    if (initialVal) {
                      setSingleEntity(initialVal);
                      handleApplyEntities('single', [initialVal]);
                    }
                  }}
                  className="accent-accent w-4 h-4 cursor-pointer"
                />
                Single Entity
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer text-text-main font-medium select-none">
                <input
                  type="radio"
                  name="tri_entity_mode"
                  checked={entityMode === 'custom'}
                  onChange={() => {
                    setEntityMode('custom');
                    setChosenEntities(summary.selected_entities || []);
                  }}
                  className="accent-accent w-4 h-4 cursor-pointer"
                />
                Multiple Entities (Custom Pool)
              </label>
            </div>

            {/* Single Select Dropdown */}
            {entityMode === 'single' && (
              <div className="flex items-center gap-2 animate-slide-in">
                <select
                  value={singleEntity}
                  onChange={(e) => {
                    setSingleEntity(e.target.value);
                    handleApplyEntities('single', [e.target.value]);
                  }}
                  className="bg-bg-2 border border-border text-accent px-2 py-1 rounded text-xs outline-none focus:border-accent font-mono cursor-pointer"
                >
                  {summary.entities.map((ent) => (
                    <option key={ent} value={ent}>
                      Entity: {ent}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Checklist for custom pooling */}
          {entityMode === 'custom' && (
            <div className="space-y-3 mt-3.5 border-t border-border/60 pt-3.5 animate-slide-in">
              <div className="flex gap-2 text-[10px]">
                <button
                  onClick={() => setChosenEntities(summary.entities || [])}
                  className="px-2 py-0.5 bg-bg-2 border border-border text-text-sub hover:text-text-main rounded font-bold cursor-pointer"
                >
                  Select All
                </button>
                <button
                  onClick={() => setChosenEntities([])}
                  className="px-2 py-0.5 bg-bg-2 border border-border text-text-sub hover:text-text-main rounded font-bold cursor-pointer"
                >
                  Clear Selection
                </button>
                <span className="self-center text-text-muted font-mono ml-2">
                  Pool Size: <span className="text-accent font-bold">{chosenEntities.length}</span> of {summary.entities.length}
                </span>

                {/* Apply Button */}
                <button
                  onClick={() => handleApplyEntities('custom')}
                  disabled={!isCustomEntityChanged || chosenEntities.length === 0}
                  className="ml-auto px-3 py-0.5 bg-accent hover:bg-accent-hover disabled:bg-bg-3 text-white disabled:text-text-muted rounded text-[10px] font-bold cursor-pointer transition-colors"
                >
                  Apply Selection Scope
                </button>
              </div>
              
              <div className="max-h-24 overflow-y-auto border border-border p-2 bg-bg-2/30 rounded grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2 text-[10px] font-mono">
                {summary.entities.map((ent) => {
                  const isChecked = chosenEntities.includes(ent);
                  return (
                    <label
                      key={ent}
                      className={`flex items-center gap-1.5 p-0.5 px-2 rounded border cursor-pointer select-none transition-colors ${
                        isChecked
                          ? 'bg-accent-dim/10 border-accent/30 text-accent font-semibold'
                          : 'border-border/40 text-text-sub hover:bg-bg-3'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setChosenEntities((prev) => [...prev, ent]);
                          } else {
                            setChosenEntities((prev) => prev.filter((x) => x !== ent));
                          }
                        }}
                        className="accent-accent w-3 h-3 cursor-pointer"
                      />
                      <span>{ent}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 1. Paid Claims Triangle (Active Projector) ────────────────── */}
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-text-main">Cumulative Paid Claims Triangle</h2>
          <p className="text-xs text-text-sub mt-0.5">Active projection source cumulative claims values.</p>
        </div>

        <div className="table-scroll border border-border rounded-lg bg-bg-1 max-w-full">
          <table className="tri-table w-full">
            <thead>
              <tr>
                <th>AY ╲ Dev</th>
                {triangle.devAges.map((age) => (
                  <th key={age}>{age}m</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Paid Claims Matrix Rows */}
              {triangle.accidentYears.map((ay, i) => (
                <tr key={ay}>
                  <td className="tri-ay">{ay}</td>
                  {triangle.devAges.map((dev, j) => {
                    const val = triangle.matrix[i][j];
                    return (
                      <td
                        key={dev}
                        className={`tri-cell ${val === null ? 'empty text-text-muted bg-black/20' : ''}`}
                      >
                        {val !== null ? fmtShort(val, currency) : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Paid Claims Age-to-Age Factors (Link Ratios) Table */}
        <div className="space-y-3 mt-4 pt-2">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-sm font-bold text-text-main">Paid Claims Age-to-Age Factors (Link Ratios)</h3>
              <p className="text-xs text-text-sub mt-0.5">Individual development factor transitions, averages, and active model inputs.</p>
            </div>
            <div className="view-actions">
              <select
                value={ldfBase}
                onChange={(e) => onChangeLdfBase(e.target.value)}
                className="bg-bg-2 border border-border-2 rounded px-3 py-1 text-xs text-text-main outline-none focus:border-accent h-8 cursor-pointer"
              >
                <option value="volumeWeighted">Vol. Weighted Avg</option>
                <option value="straightAvg">Straight Avg</option>
                <option value="weighted3yr">3-Year Weighted Avg</option>
                <option value="weighted5yr">5-Year Weighted Avg</option>
              </select>
            </div>
          </div>

          <div className="table-scroll border border-border rounded-lg bg-bg-1 max-w-full">
            <table className="tri-table w-full">
              <thead>
                <tr>
                  <th>AY ╲ Dev Transition</th>
                  {linkRatioHeaders.map((hdr) => (
                    <th key={hdr}>{hdr}m</th>
                  ))}
                  <th>Tail</th>
                </tr>
              </thead>
              <tbody>
                {triangle.accidentYears.map((ay, i) => (
                  <tr key={ay}>
                    <td className="tri-ay">{ay}</td>
                    {linkRatiosMatrix[i].map((val, j) => (
                      <td
                        key={j}
                        className={`tri-cell ${val === null ? 'empty text-text-muted bg-black/20' : ''}`}
                      >
                        {val !== null ? val.toFixed(4) : '—'}
                      </td>
                    ))}
                    <td className="tri-cell empty bg-black/20 text-text-muted">—</td>
                  </tr>
                ))}

                {/* Separator spacing */}
                <tr className="h-2"><td colSpan={linkRatioHeaders.length + 2}></td></tr>

                {/* Average LDF calculations */}
                {getLdfRow('Vol. Wtd', 'volumeWeighted')}
                {getLdfRow('Straight', 'straightAvg')}
                {getLdfRow('3-Year', 'weighted3yr')}
                {getLdfRow('5-Year', 'weighted5yr')}

                {/* Editable Selection Row */}
                <tr className="ldf-row sel-row bg-bg-2">
                  <td className="tri-ay font-bold text-text-main">Selected LDF</td>
                  {inputs.map((v, idx) => (
                    <td key={idx} className="ldf-cell">
                      <input
                        type="number"
                        value={v}
                        onChange={(e) => handleLdfChange(idx, e.target.value)}
                        step="0.001"
                        className="w-[80px] bg-bg-3 border border-border-2 text-text-main px-2 py-1 rounded font-mono text-xs text-right outline-none focus:border-accent"
                      />
                    </td>
                  ))}
                  <td className="ldf-cell tail text-text-muted px-3 text-xs whitespace-nowrap">
                    <input
                      type="number"
                      value={tailFactor}
                      onChange={(e) => onChangeTailFactor(parseFloat(e.target.value) || 1.0)}
                      step="0.001"
                      className="w-[60px] bg-bg-3 border border-border-2 text-text-main px-2 py-1 rounded font-mono text-xs text-center outline-none focus:border-accent mr-1"
                    />
                    (tail)
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── 2. Incurred Claims Triangle (Reference Display) ───────────── */}
      {hasIncurred && (
        <div className="space-y-4 pt-4 border-t border-border">
          <div>
            <h3 className="text-sm font-bold text-text-main">Cumulative Incurred Claims Triangle</h3>
            <p className="text-xs text-text-sub mt-0.5">Historical incurred claims (paid + case reserves).</p>
          </div>
          <div className="table-scroll border border-border rounded-lg bg-bg-1 max-w-full">
            <table className="tri-table w-full">
              <thead>
                <tr>
                  <th>AY ╲ Dev</th>
                  {triangle.devAges.map((age) => (
                    <th key={age}>{age}m</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {triangle.accidentYears.map((ay, i) => (
                  <tr key={ay}>
                    <td className="tri-ay">{ay}</td>
                    {triangle.devAges.map((dev, j) => {
                      const val = triangle.incurred_matrix[i][j];
                      return (
                        <td
                          key={dev}
                          className={`tri-cell ${val === null ? 'empty text-text-muted bg-black/20' : ''}`}
                        >
                          {val !== null ? fmtShort(val, currency) : '—'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Incurred Age-to-Age Factors Triangle */}
          {triangle.incurred_ldfs && (
            <div className="space-y-3 mt-4 pt-2">
              <div className="flex justify-between items-center">
                <div>
                  <h4 className="text-sm font-bold text-text-main">Incurred Claims Age-to-Age Factors (Link Ratios)</h4>
                  <p className="text-xs text-text-sub mt-0.5">Historical incurred development transitions, averages, and customized selections.</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-text-sub">Incurred LDF Base:</span>
                  <select
                    value={incurredLdfBase}
                    onChange={(e) => onChangeIncurredLdfBase(e.target.value)}
                    className="bg-bg-2 border border-border-2 rounded px-3 py-1 text-xs text-text-main outline-none focus:border-accent h-8 cursor-pointer"
                  >
                    <option value="volumeWeighted">Vol. Weighted Avg</option>
                    <option value="straightAvg">Straight Avg</option>
                    <option value="weighted3yr">3-Year Weighted Avg</option>
                    <option value="weighted5yr">5-Year Weighted Avg</option>
                  </select>
                </div>
              </div>

              <div className="table-scroll border border-border rounded-lg bg-bg-1 max-w-full">
                <table className="tri-table w-full">
                  <thead>
                    <tr>
                      <th>AY ╲ Dev Transition</th>
                      {linkRatioHeaders.map((hdr) => (
                        <th key={hdr}>{hdr}m</th>
                      ))}
                      <th>Tail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {triangle.accidentYears.map((ay, i) => (
                      <tr key={ay}>
                        <td className="tri-ay">{ay}</td>
                        {incurredLinkRatiosMatrix[i].map((val, j) => (
                          <td
                            key={j}
                            className={`tri-cell ${val === null ? 'empty text-text-muted bg-black/20' : ''}`}
                          >
                            {val !== null ? val.toFixed(4) : '—'}
                          </td>
                        ))}
                        <td className="tri-cell empty bg-black/20 text-text-muted">—</td>
                      </tr>
                    ))}

                    <tr className="h-2"><td colSpan={linkRatioHeaders.length + 2}></td></tr>
                    {getIncurredLdfRow('Vol. Wtd', 'volumeWeighted')}
                    {getIncurredLdfRow('Straight', 'straightAvg')}
                    {getIncurredLdfRow('3-Year', 'weighted3yr')}
                    {getIncurredLdfRow('5-Year', 'weighted5yr')}

                    <tr className="ldf-row sel-row bg-bg-2">
                      <td className="tri-ay font-bold text-text-main">Selected LDF</td>
                      {incurredInputs.map((v, idx) => (
                        <td key={idx} className="ldf-cell">
                          <input
                            type="number"
                            value={v}
                            onChange={(e) => handleIncurredLdfChange(idx, e.target.value)}
                            step="0.001"
                            className="w-[80px] bg-bg-3 border border-border-2 text-text-main px-2 py-1 rounded font-mono text-xs text-right outline-none focus:border-accent"
                          />
                        </td>
                      ))}
                      <td className="ldf-cell tail text-text-muted px-3 text-xs whitespace-nowrap">
                        <input
                          type="number"
                          value={incurredTailFactor}
                          onChange={(e) => onChangeIncurredTailFactor(parseFloat(e.target.value) || 1.0)}
                          step="0.001"
                          className="w-[60px] bg-bg-3 border border-border-2 text-text-main px-2 py-1 rounded font-mono text-xs text-center outline-none focus:border-accent mr-1"
                        />
                        (tail)
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Footer Navigation ────────────────────────────────────────── */}
      <div className="flex justify-between items-center pt-2">
        <ExportMenu
          label="Export Triangle"
          onExportCSV={() => handleTriangleExportCSV()}
          onExportExcel={() => handleTriangleExportExcel()}
          onExportPDF={() => handleTriangleExportPDF()}
        />
        <button
          onClick={onProceed}
          className="px-5 py-2.5 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded shadow-[0_4px_16px_rgba(91,124,250,0.3)] transition-colors cursor-pointer"
        >
          Select Execution Model →
        </button>
      </div>
    </div>
  );
}
