'use client';
import React, { useState, useEffect, useMemo } from 'react';
import { SummaryData } from '../types';
import { fmt, CurrencyCode } from '../utils';

interface SummaryViewProps {
  summary: SummaryData;
  currency?: CurrencyCode;
  onProceed: () => void;
  onUpdateMappings: (newRoles: Record<string, string | null>, selectedEntities?: string[] | null) => Promise<void>;
}

export default function SummaryView({ summary, currency = 'USD', onProceed, onUpdateMappings }: SummaryViewProps) {
  const roles = [
    { key: 'origin_col', label: 'Origin Period (AY)', roleDesc: 'Identifies the accident/underwriting period' },
    { key: 'dev_col', label: 'Development Lag', roleDesc: 'Identifies the duration from the origin period' },
    { key: 'paid_col', label: 'Cumulative Paid Claims', roleDesc: 'Represents paid claim amounts' },
    { key: 'incurred_col', label: 'Incurred Claims', roleDesc: 'Represents paid + case reserve claims' },
    { key: 'premium_col', label: 'Net Earned Premium', roleDesc: 'Earned premium for rate on-leveling / ELR' },
    { key: 'count_col', label: 'Claim Count', roleDesc: 'Frequency counts for reserving' }
  ];

  const [localRoles, setLocalRoles] = useState<Record<string, string | null>>({});
  const [entityMode, setEntityMode] = useState<'all' | 'custom'>('all');
  const [chosenEntities, setChosenEntities] = useState<string[]>([]);
  const [isUpdating, setIsUpdating] = useState(false);

  // Sync state with summary data
  useEffect(() => {
    if (summary.inspection?.reserving_roles) {
      setLocalRoles(summary.inspection.reserving_roles);
    }
    if (summary.selected_entities) {
      setEntityMode('custom');
      setChosenEntities(summary.selected_entities);
    } else {
      setEntityMode('all');
      setChosenEntities([]);
    }
  }, [summary]);

  const originalCols = useMemo(() => {
    return summary.original_columns || [];
  }, [summary]);

  const handleRoleChange = (roleKey: string, value: string) => {
    setLocalRoles((prev) => ({
      ...prev,
      [roleKey]: value === '' ? null : value,
    }));
  };

  // Check if mapping has changed from original summary roles
  const isRoleChanged = useMemo(() => {
    if (!summary.inspection?.reserving_roles) return false;
    return roles.some((role) => {
      const original = summary.inspection?.reserving_roles[role.key] || null;
      const current = localRoles[role.key] || null;
      return (original || '').toLowerCase() !== (current || '').toLowerCase();
    });
  }, [localRoles, summary]);

  // Check if entity settings have changed from original summary selected_entities
  const isEntityChanged = useMemo(() => {
    const originalSelected = summary.selected_entities || null;
    if (entityMode === 'all') {
      return originalSelected !== null;
    } else {
      if (originalSelected === null) return true;
      if (originalSelected.length !== chosenEntities.length) return true;
      const origSet = new Set(originalSelected);
      return chosenEntities.some((e) => !origSet.has(e));
    }
  }, [entityMode, chosenEntities, summary]);

  const isChanged = useMemo(() => {
    return isRoleChanged || isEntityChanged;
  }, [isRoleChanged, isEntityChanged]);

  const handleSaveMappings = async () => {
    setIsUpdating(true);
    try {
      const entitiesToPass = entityMode === 'all' ? null : chosenEntities;
      await onUpdateMappings(localRoles, entitiesToPass);
    } catch (e) {
      console.error(e);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 animate-slide-in space-y-6">
      <div>
        <h2 className="text-lg font-bold text-text-main">Data Summary</h2>
        <p className="text-xs text-text-sub mt-1">
          Review the characteristics and auto-discovered schema of your uploaded dataset.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
        {/* Accident Years */}
        <div className="bg-bg-1 border border-border rounded-lg p-4.5 hover:border-border-2 transition-colors">
          <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-1.5">
            Accident Years
          </div>
          <div className="text-2xl font-bold font-mono text-text-main tracking-tight">
            {summary.accidentYears}
          </div>
          <div className="text-xs text-text-sub mt-1">
            {summary.oldestAY} – {summary.latestAY}
          </div>
        </div>

        {/* Dev Periods */}
        <div className="bg-bg-1 border border-border rounded-lg p-4.5 hover:border-border-2 transition-colors">
          <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-1.5">
            Dev Periods
          </div>
          <div className="text-2xl font-bold font-mono text-text-main tracking-tight">
            {summary.devPeriods}
          </div>
          <div className="text-xs text-text-sub mt-1">
            Max: {summary.maxDevAge}m
          </div>
        </div>

        {/* Total Paid */}
        <div className="bg-bg-1 border border-border rounded-lg p-4.5 hover:border-border-2 transition-colors">
          <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-1.5">
            Total Paid
          </div>
          <div className="text-2xl font-bold font-mono text-text-main tracking-tight">
            {fmt(summary.totalPaid, currency)}
          </div>
          <div className="text-xs text-text-sub mt-1">
            latest diagonal
          </div>
        </div>

        {/* Premium Data */}
        <div className="bg-bg-1 border border-border rounded-lg p-4.5 hover:border-border-2 transition-colors">
          <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-1.5">
            Premium Data
          </div>
          <div className="text-2xl font-bold font-mono text-text-main tracking-tight">
            {summary.hasPremium ? 'Yes ✓' : 'No'}
          </div>
          <div className="text-xs text-text-sub mt-1">
            Required for BF/Cape Cod
          </div>
        </div>
      </div>

      {/* Schema Discovery & Column Mapping */}
      {summary.classification && (
        <div className="bg-bg-1 border border-border rounded-lg p-5">
          <div className="flex items-center justify-between border-b border-border pb-2.5 mb-4">
            <h3 className="text-xs font-bold text-text-main uppercase tracking-wider">
              Step 1: Column Classification & Reserving Roles Mapping
            </h3>
            {isChanged && (
              <span className="text-[10px] bg-accent-amber/15 text-accent-amber border border-accent-amber/25 px-2 py-0.5 rounded font-bold animate-pulse">
                Unsaved Configuration Changes
              </span>
            )}
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
            <div className="bg-bg-2 border border-border rounded p-3 flex flex-col justify-between">
              <div className="text-[10px] text-text-muted font-bold uppercase tracking-wider">Classification</div>
              <div className="text-sm font-bold text-text-main mt-1 font-mono">
                {summary.classification.data_type.replace('_', ' ')}
              </div>
            </div>
            <div className="bg-bg-2 border border-border rounded p-3 flex flex-col justify-between">
              <div className="text-[10px] text-text-muted font-bold uppercase tracking-wider">Confidence Level</div>
              <div className="mt-1">
                <span className={`text-xs px-2 py-0.5 rounded font-bold ${
                  summary.classification.confidence === 'HIGH' ? 'bg-accent-green/10 text-accent-green border border-accent-green/20' : 'bg-accent-amber/10 text-accent-amber border border-accent-amber/20'
                }`}>
                  {summary.classification.confidence}
                </span>
              </div>
            </div>
            <div className="bg-bg-2 border border-border rounded p-3 flex flex-col justify-between">
              <div className="text-[10px] text-text-muted font-bold uppercase tracking-wider">Fingerprint Schema</div>
              <div className="text-xs font-bold text-text-main mt-1">
                {summary.classification.is_cas_format ? (
                  <span className="text-accent-green">✓ CAS Reserving Format</span>
                ) : (
                  <span className="text-text-sub">Generic Schema</span>
                )}
              </div>
            </div>
          </div>

          {/* Multi-Entity Notice */}
          {summary.inspection?.is_multi_entity && (
            <div className="bg-accent-dim/30 border border-accent/20 rounded p-3.5 mb-5 text-xs flex items-center justify-between">
              <div>
                <span className="font-bold text-accent">Multi-Entity Dataset:</span> Discovered <span className="font-bold text-text-main">{summary.inspection.entity_count}</span> unique companies/entities partitioned by column <code className="font-mono bg-bg-2 px-1 rounded border border-border text-text-main">{summary.inspection.entity_column}</code>.
              </div>
              <span className="text-[10px] bg-accent/20 text-accent font-bold px-2 py-0.5 rounded uppercase font-mono">
                Entity Partition Active
              </span>
            </div>
          )}

          {/* Column Roles Map Table */}
          <div className="border border-border rounded overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-bg-2 text-[10px] text-text-muted font-bold uppercase tracking-wider border-b border-border">
                  <th className="py-2.5 px-4 w-1/4">Actuarial Role</th>
                  <th className="py-2.5 px-4 w-1/3">Role Description</th>
                  <th className="py-2.5 px-4">Mapped CSV Column (Editable)</th>
                  <th className="py-2.5 px-4 w-1/6">Accumulation State</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60 text-xs">
                {roles.map((role) => {
                  const currentValue = localRoles[role.key];
                  const matchedCol = originalCols.find(c => c.toLowerCase() === (currentValue || '').toLowerCase()) || '';
                  const state = matchedCol ? summary.inspection?.accumulation_states[matchedCol] : null;
                  
                  return (
                    <tr key={role.key} className="hover:bg-bg-2/30 transition-colors">
                      <td className="py-3 px-4 font-semibold text-text-main">{role.label}</td>
                      <td className="py-3 px-4 text-text-sub">{role.roleDesc}</td>
                      <td className="py-3 px-4">
                        <select
                          value={matchedCol}
                          onChange={(e) => handleRoleChange(role.key, e.target.value)}
                          className="font-mono bg-bg-2 text-accent px-2 py-1.5 rounded border border-border outline-none focus:border-border-2 text-xs w-full max-w-[240px] cursor-pointer"
                        >
                          <option value="">-- Not Mapped --</option>
                          {originalCols.map((col) => (
                            <option key={col} value={col}>
                              {col}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-3 px-4">
                        {state ? (
                          <span className={`inline-flex items-center text-[10px] font-bold px-1.5 py-0.25 rounded uppercase font-mono ${
                            state === 'cumulative' 
                              ? 'bg-accent-green/10 text-accent-green' 
                              : state === 'incremental' 
                                ? 'bg-accent-amber/10 text-accent-amber' 
                                : 'bg-bg-3 text-text-sub'
                          }`}>
                            {state}
                          </span>
                        ) : (
                          <span className="text-text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Entity Scope Selector Panel */}
          {summary.inspection?.is_multi_entity && summary.entities && summary.entities.length > 0 && (
            <div className="mt-5 border border-border rounded p-4.5 bg-bg-2/40">
              <div className="flex items-center justify-between border-b border-border/80 pb-2 mb-3">
                <span className="text-xs font-bold text-text-main uppercase tracking-wider">
                  Entity Scope Selection
                </span>
                <span className="text-[10px] text-text-muted">
                  Partition Column: <code className="font-mono bg-bg-3 px-1.5 py-0.5 rounded border border-border/60">{summary.inspection.entity_column}</code>
                </span>
              </div>
              
              <div className="flex gap-5 items-center text-xs mb-4">
                <label className="flex items-center gap-2 cursor-pointer text-text-main font-medium select-none">
                  <input
                    type="radio"
                    name="entity_mode"
                    checked={entityMode === 'all'}
                    onChange={() => setEntityMode('all')}
                    className="accent-accent w-4 h-4 cursor-pointer"
                  />
                  All Entities Aggregated (Pool Total)
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-text-main font-medium select-none">
                  <input
                    type="radio"
                    name="entity_mode"
                    checked={entityMode === 'custom'}
                    onChange={() => setEntityMode('custom')}
                    className="accent-accent w-4 h-4 cursor-pointer"
                  />
                  Select Specific Group / Entities
                </label>
              </div>

              {entityMode === 'custom' && (
                <div className="space-y-2 animate-slide-in">
                  <div className="flex gap-2 text-[10px]">
                    <button
                      onClick={() => setChosenEntities(summary.entities || [])}
                      className="px-2.5 py-1 bg-bg-3 border border-border text-text-sub hover:text-text-main rounded font-bold cursor-pointer transition-colors"
                    >
                      Select All
                    </button>
                    <button
                      onClick={() => setChosenEntities([])}
                      className="px-2.5 py-1 bg-bg-3 border border-border text-text-sub hover:text-text-main rounded font-bold cursor-pointer transition-colors"
                    >
                      Clear Selection
                    </button>
                    <span className="ml-auto text-text-muted font-mono self-center">
                      Selected: <span className="text-accent font-bold">{chosenEntities.length}</span> of {summary.entities.length}
                    </span>
                  </div>
                  <div className="max-h-36 overflow-y-auto border border-border p-2 bg-bg-3/40 rounded grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2 text-xs font-mono">
                    {summary.entities.map((ent) => {
                      const isChecked = chosenEntities.includes(ent);
                      return (
                        <label
                          key={ent}
                          className={`flex items-center gap-1.5 p-1 px-2 rounded border cursor-pointer select-none transition-colors ${
                            isChecked
                              ? 'bg-accent-dim/20 border-accent/40 text-accent font-semibold'
                              : 'border-border/40 text-text-sub hover:bg-bg-3 hover:text-text-main'
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
                            className="accent-accent cursor-pointer"
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

          {/* Rebuild Mapping Actions */}
          {isChanged && (
            <div className="mt-4 flex justify-end gap-3 animate-slide-in">
              <button
                onClick={() => {
                  setLocalRoles(summary.inspection?.reserving_roles || {});
                  if (summary.selected_entities) {
                    setEntityMode('custom');
                    setChosenEntities(summary.selected_entities);
                  } else {
                    setEntityMode('all');
                    setChosenEntities([]);
                  }
                }}
                className="px-4 py-2 bg-bg-2 border border-border text-text-sub hover:text-text-main text-xs font-bold rounded transition-colors cursor-pointer"
              >
                Reset Changes
              </button>
              <button
                onClick={handleSaveMappings}
                disabled={isUpdating}
                className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded transition-colors cursor-pointer disabled:opacity-50"
              >
                {isUpdating ? '⚙️ Building...' : 'Save & Build Triangle'}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end pt-2">
        <button
          onClick={onProceed}
          disabled={isChanged || isUpdating}
          className="px-5 py-2.5 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded shadow-[0_4px_16px_rgba(91,124,250,0.3)] transition-colors cursor-pointer disabled:bg-bg-2 disabled:text-text-muted disabled:border disabled:border-border disabled:shadow-none disabled:cursor-not-allowed"
          title={isChanged ? 'Please save configurations first to build the triangle.' : ''}
        >
          Review Loss Triangle →
        </button>
      </div>
    </div>
  );
}
