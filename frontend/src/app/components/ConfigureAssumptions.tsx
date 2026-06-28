'use client';
import React from 'react';
import { ExecutionConfig, TriangleData, MethodConfig } from '../types';

interface ConfigureAssumptionsProps {
  configs: ExecutionConfig;
  onChangeConfigs: (newConfigs: ExecutionConfig) => void;
  triangle: TriangleData;
  suggestedElrPaid: number | null;
  suggestedElrIncurred: number | null;
  suggestedMatureYears: number[];
  matureCdfThreshold: number;
  onChangeMatureCdfThreshold: (threshold: number) => void;
  paidLdfBase: string;
  incurredLdfBase: string;
  paidTailFactor: number;
  incurredTailFactor: number;
  onBack: () => void;
  onRunComparison: () => void;
}

export const AVAILABLE_METHODS = [
  { code: 'CL', label: 'Chain Ladder (Basic)', desc: 'Standard volume-weighted link ratio projection.' },
  { code: 'BF', label: 'Bornhuetter-Ferguson', desc: 'A priori exposure-based blending.', needsPremium: true },
  { code: 'BK', label: 'Benktander', desc: 'Iterative credibility weighting of BF.', needsPremium: true },
  { code: 'CC', label: 'Cape Cod (Stanard-Bühlmann)', desc: 'Used-up premium derived expected loss ratio.', needsPremium: true },
  { code: 'CO', label: 'Case Outstanding', desc: 'Pure baseline: IBNR equals current case reserves.' },
  { code: 'ELR', label: 'Expected Loss Ratio', desc: 'Ignores development, uses purely premium × ELR.', needsPremium: true },
];

export default function ConfigureAssumptions({
  configs,
  onChangeConfigs,
  triangle,
  suggestedElrPaid,
  suggestedElrIncurred,
  suggestedMatureYears,
  matureCdfThreshold,
  onChangeMatureCdfThreshold,
  paidLdfBase,
  incurredLdfBase,
  paidTailFactor,
  incurredTailFactor,
  onBack,
  onRunComparison,
}: ConfigureAssumptionsProps) {

  const handleToggleMethod = (code: string) => {
    const current = configs[code] || { enabled: true, runPaid: true, runIncurred: true };
    onChangeConfigs({
      ...configs,
      [code]: { ...current, enabled: !current.enabled },
    });
  };

  const handleToggleSource = (code: string, sourceField: 'runPaid' | 'runIncurred') => {
    const current = configs[code] || { enabled: true, runPaid: true, runIncurred: true };
    onChangeConfigs({
      ...configs,
      [code]: { ...current, [sourceField]: !current[sourceField] },
    });
  };

  const handleParamChange = (code: string, key: string, value: any) => {
    const current = configs[code] || { enabled: true, runPaid: true, runIncurred: true };
    onChangeConfigs({
      ...configs,
      [code]: { ...current, [key]: value },
    });
  };

  const handleMatureYearToggle = (code: string, year: number) => {
    const current = configs[code] || { enabled: true, runPaid: true, runIncurred: true };
    const currentYears = current.matureYears || [];
    const newYears = currentYears.includes(year)
      ? currentYears.filter((y) => y !== year)
      : [...currentYears, year];
    handleParamChange(code, 'matureYears', newYears);
  };

  const hasPremium = triangle.hasPremium;

  return (
    <div className="flex flex-col flex-1 max-w-5xl mx-auto animate-slide-in pb-12 font-sans text-text-main text-left">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight">Configure Reserving Assumptions</h2>
          <p className="text-xs text-text-sub mt-1">Specify model-level data sources and parameters before running the comparison engine.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="px-4 py-2 border border-border bg-bg-1 rounded text-xs font-semibold hover:bg-bg-2 cursor-pointer transition-all"
          >
            ← Back to Triangle
          </button>
          <button
            onClick={onRunComparison}
            className="px-5 py-2 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded shadow-[0_4px_16px_rgba(91,124,250,0.35)] cursor-pointer transition-all"
          >
            Run Comparison Dashboard →
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: Method config panels */}
        <div className="lg:col-span-2 flex flex-col gap-5">
          {AVAILABLE_METHODS.map((method) => {
            const config = configs[method.code] || { enabled: false, source: 'paid' };
            const isDisabledByPremium = method.needsPremium && !hasPremium;

            return (
              <div
                key={method.code}
                className={`bg-bg-1 border rounded-xl p-5 transition-all ${
                  isDisabledByPremium
                    ? 'border-border-2 opacity-60'
                    : config.enabled
                    ? 'border-accent shadow-[0_2px_8px_rgba(91,124,250,0.05)]'
                    : 'border-border'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={config.enabled && !isDisabledByPremium}
                      disabled={isDisabledByPremium}
                      onChange={() => handleToggleMethod(method.code)}
                      className="w-4 h-4 text-accent border-border-2 rounded focus:ring-accent accent-accent cursor-pointer disabled:cursor-not-allowed"
                    />
                    <div>
                      <h3 className="text-sm font-bold flex items-center gap-2">
                        {method.label}
                        {isDisabledByPremium && (
                          <span className="text-[10px] font-bold text-accent-red bg-accent-red/10 px-2 py-0.5 rounded uppercase tracking-wide">
                            Disabled (No Premium)
                          </span>
                        )}
                      </h3>
                      <p className="text-xs text-text-sub mt-0.5">{method.desc}</p>
                    </div>
                  </div>

                  {config.enabled && !isDisabledByPremium && (
                    <div className="flex items-center gap-1.5 bg-bg-2 p-1 border border-border rounded-lg text-xs">
                      {method.code === 'CO' ? (
                        <span className="px-3 py-1 font-semibold text-text-sub uppercase tracking-wider text-[10px]">
                          Requires Paid + Incurred
                        </span>
                      ) : (
                        <>
                          <label className="flex items-center gap-1.5 px-2 py-1 cursor-pointer font-semibold text-text-sub hover:text-text-main">
                            <input
                              type="checkbox"
                              checked={!!config.runPaid}
                              onChange={() => handleToggleSource(method.code, 'runPaid')}
                              className="w-3.5 h-3.5 text-accent border-border-2 rounded focus:ring-accent accent-accent"
                            />
                            Paid
                          </label>
                          <label className="flex items-center gap-1.5 px-2 py-1 cursor-pointer font-semibold text-text-sub hover:text-text-main">
                            <input
                              type="checkbox"
                              checked={!!config.runIncurred}
                              onChange={() => handleToggleSource(method.code, 'runIncurred')}
                              className="w-3.5 h-3.5 text-accent border-border-2 rounded focus:ring-accent accent-accent"
                            />
                            Incurred
                          </label>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {config.enabled && !isDisabledByPremium && (
                  <div className="mt-4 pt-4 border-t border-border flex flex-col gap-4 animate-slide-in">
                    {/* Bornhuetter-Ferguson & Benktander settings */}
                    {(method.code === 'BF' || method.code === 'BK') && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-bold text-text-sub">A Priori Expected Loss Ratio (%)</label>
                          <div className="flex flex-wrap items-center gap-2 mt-1">
                            <input
                              type="number"
                              value={config.aprioriLossRatio !== undefined && config.aprioriLossRatio !== null ? config.aprioriLossRatio : ''}
                              placeholder="e.g. 65"
                              onChange={(e) => handleParamChange(method.code, 'aprioriLossRatio', e.target.value === '' ? null : parseFloat(e.target.value))}
                              className="bg-bg-2 border border-border rounded px-3 py-1.5 text-xs outline-none focus:border-accent w-32"
                            />
                            {suggestedElrPaid !== null && (
                              <span className="text-[10px] font-semibold text-accent bg-accent/10 px-2 py-1 rounded">
                                Paid Suggestion: {suggestedElrPaid}%
                              </span>
                            )}
                            {suggestedElrIncurred !== null && (
                              <span className="text-[10px] font-semibold text-accent bg-accent/10 px-2 py-1 rounded">
                                Incurred Suggestion: {suggestedElrIncurred}%
                              </span>
                            )}
                          </div>
                        </div>

                        {method.code === 'BK' && (
                          <div className="flex flex-col gap-1">
                            <label className="text-xs font-bold text-text-sub">Iterations (c)</label>
                            <input
                              type="number"
                              min="1"
                              max="10"
                              value={config.iterations !== undefined ? config.iterations : 2}
                              onChange={(e) => handleParamChange(method.code, 'iterations', parseInt(e.target.value) || 2)}
                              className="bg-bg-2 border border-border rounded px-3 py-1.5 text-xs outline-none focus:border-accent w-20 mt-1"
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {/* Cape Cod settings */}
                    {method.code === 'CC' && (
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-bold text-text-sub">Decay Factor</label>
                        <input
                          type="number"
                          step="0.05"
                          min="0.1"
                          max="1.0"
                          value={config.decay !== undefined ? config.decay : 0.9}
                          onChange={(e) => handleParamChange(method.code, 'decay', parseFloat(e.target.value) || 0.9)}
                          className="bg-bg-2 border border-border rounded px-3 py-1.5 text-xs outline-none focus:border-accent w-24 mt-1"
                        />
                      </div>
                    )}

                    {/* Expected Loss Ratio settings */}
                    {method.code === 'ELR' && (
                      <div className="flex flex-col gap-4">
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-bold text-text-sub">Mature year selection threshold (CDF)</label>
                          <select
                            value={matureCdfThreshold}
                            onChange={(e) => onChangeMatureCdfThreshold(parseFloat(e.target.value))}
                            className="bg-bg-2 border border-border rounded px-3 py-1.5 text-xs outline-none focus:border-accent w-32 mt-1 cursor-pointer"
                          >
                            <option value={1.02}>1.02</option>
                            <option value={1.05}>1.05</option>
                            <option value={1.10}>1.10</option>
                          </select>
                        </div>

                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-bold text-text-sub mb-1.5">Select Mature Accident Years</label>
                          <div className="flex flex-wrap gap-2">
                            {triangle.accidentYears.map((ay) => {
                              const isSelected = (config.matureYears || []).includes(ay);
                              const isSuggested = suggestedMatureYears.includes(ay);
                              return (
                                <button
                                  key={ay}
                                  type="button"
                                  onClick={() => handleMatureYearToggle(method.code, ay)}
                                  className={`px-3 py-1.5 rounded border text-xs font-medium cursor-pointer transition-all ${
                                    isSelected
                                      ? 'bg-accent/15 border-accent text-accent font-bold'
                                      : isSuggested
                                      ? 'border-dashed border-border-2 hover:border-accent font-bold text-text-main'
                                      : 'border-border hover:border-border-2 text-text-sub'
                                  }`}
                                >
                                  {ay} {isSuggested && !isSelected && '⭐️'}
                                </button>
                              );
                            })}
                          </div>
                          <span className="text-[10px] text-text-sub mt-2">
                            ⭐️ Auto-detected mature years (CDF &le; {matureCdfThreshold} or development age &ge; 84 months). Click to select.
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Clark Stochastic settings */}
                    {method.code === 'CLK' && (
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-bold text-text-sub">Growth Curve shape</label>
                        <div className="flex gap-4 mt-1.5">
                          <label className="flex items-center gap-2 text-xs cursor-pointer">
                            <input
                              type="radio"
                              name="clark_curve"
                              checked={config.curveType === 'weibull' || !config.curveType}
                              onChange={() => handleParamChange(method.code, 'curveType', 'weibull')}
                              className="text-accent focus:ring-accent accent-accent"
                            />
                            <div>
                              <span className="font-bold">Weibull</span>
                              <span className="text-[10px] text-text-sub block">Smoother tail projection</span>
                            </div>
                          </label>
                          <label className="flex items-center gap-2 text-xs cursor-pointer">
                            <input
                              type="radio"
                              name="clark_curve"
                              checked={config.curveType === 'loglogistic'}
                              onChange={() => handleParamChange(method.code, 'curveType', 'loglogistic')}
                              className="text-accent focus:ring-accent accent-accent"
                            />
                            <div>
                              <span className="font-bold">Log-Logistic</span>
                              <span className="text-[10px] text-text-sub block">Heavier tail projection</span>
                            </div>
                          </label>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Right column: Selected LDF summary audit box */}
        <div className="flex flex-col gap-5 text-left">
          <div className="bg-bg-1 border border-border rounded-xl p-5 sticky top-6">
            <h3 className="text-sm font-bold mb-4 flex items-center gap-2 border-b border-border pb-2.5">
              📋 Input Selection Audit
            </h3>

            <div className="flex flex-col gap-4">
              {/* Paid LDF Selection */}
              <div>
                <span className="text-[11px] font-bold text-text-sub uppercase tracking-wide">Paid Development Info</span>
                <div className="flex flex-col gap-1.5 mt-2 bg-bg-2 border border-border rounded-lg p-3 font-mono text-xs">
                  <div className="flex justify-between">
                    <span className="text-text-sub font-semibold">LDF Basis:</span>
                    <span className="text-text-main font-bold capitalize">{paidLdfBase.replace(/([A-Z])/g, ' $1')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-sub font-semibold">Tail Factor:</span>
                    <span className="text-accent font-bold">{paidTailFactor.toFixed(4)}</span>
                  </div>
                  <div className="mt-2 text-[10px] border-t border-border pt-2 text-text-sub leading-relaxed">
                    Selected Paid LDFs: [{triangle.ldfs.slice(0, 3).map((f) => (f[paidLdfBase as keyof typeof f] as number || 1.0).toFixed(3)).join(', ')}, ...]
                  </div>
                </div>
              </div>

              {/* Incurred LDF Selection */}
              {triangle.incurred_ldfs && (
                <div>
                  <span className="text-[11px] font-bold text-text-sub uppercase tracking-wide">Incurred Development Info</span>
                  <div className="flex flex-col gap-1.5 mt-2 bg-bg-2 border border-border rounded-lg p-3 font-mono text-xs">
                    <div className="flex justify-between">
                      <span className="text-text-sub font-semibold">LDF Basis:</span>
                      <span className="text-text-main font-bold capitalize">{incurredLdfBase.replace(/([A-Z])/g, ' $1')}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-sub font-semibold">Tail Factor:</span>
                      <span className="text-accent font-bold">{incurredTailFactor.toFixed(4)}</span>
                    </div>
                    <div className="mt-2 text-[10px] border-t border-border pt-2 text-text-sub leading-relaxed">
                      Selected Incurred LDFs: [{triangle.incurred_ldfs.slice(0, 3).map((f) => (f[incurredLdfBase as keyof typeof f] as number || 1.0).toFixed(3)).join(', ')}, ...]
                    </div>
                  </div>
                </div>
              )}

              {/* Premium Status Warning */}
              {!hasPremium && (
                <div className="bg-accent-red/5 border border-accent-red/20 text-accent-red rounded-lg p-3.5 text-xs leading-relaxed">
                  ⚠️ <strong>Earned Premium data is missing.</strong> Premium-dependent methods (BF, Benktander, Cape Cod, ELR) will be excluded from execution.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
