'use client';
import React from 'react';
import { RankedModel } from '../types';

interface ModelSelectorProps {
  ranked: RankedModel[];
  recommendation: string | null;
  dataSource: 'paid' | 'incurred';
  onChangeDataSource: (source: 'paid' | 'incurred') => void;
  onSelectMethod: (code: string) => void;
}

export default function ModelSelector({
  ranked,
  recommendation,
  dataSource,
  onChangeDataSource,
  onSelectMethod,
}: ModelSelectorProps) {
  return (
    <div className="flex flex-col flex-1 animate-slide-in">
      <div className="view-header mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-text-main">Select Execution Model</h2>
          <p className="text-xs text-text-sub mt-0.5">Select a tool for the Execution Agent</p>
        </div>
        
        {/* Data Source Selector */}
        <div className="flex items-center gap-2 bg-bg-1 border border-border rounded-lg px-3 py-1.5 shadow-sm">
          <span className="text-[11.5px] font-semibold text-text-sub font-sans">Data Source:</span>
          <div className="flex gap-1 bg-bg-2 p-0.5 rounded border border-border-2">
            <button
              onClick={() => onChangeDataSource('paid')}
              className={`px-2.5 py-1 text-[11px] font-bold rounded transition-colors cursor-pointer ${
                dataSource === 'paid' ? 'bg-accent text-white shadow-sm' : 'text-text-sub hover:text-text-main'
              }`}
            >
              Paid
            </button>
            <button
              onClick={() => onChangeDataSource('incurred')}
              className={`px-2.5 py-1 text-[11px] font-bold rounded transition-colors cursor-pointer ${
                dataSource === 'incurred' ? 'bg-accent text-white shadow-sm' : 'text-text-sub hover:text-text-main'
              }`}
            >
              Incurred
            </button>
          </div>
        </div>
      </div>

      {/* AI Recommendation Message */}
      {recommendation && (
        <div className="mb-6 p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
          <h3 className="mt-0 text-[#60a5fa] text-[13px] font-bold mb-2">✨ AI Recommendation</h3>
          <div
            className="text-xs leading-relaxed text-text-main"
            dangerouslySetInnerHTML={{ __html: recommendation }}
          />
        </div>
      )}

      {/* Method Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {ranked.map((m) => {
          const isRecommended = m.recommended;

          return (
            <div
              key={m.code}
              onClick={() => onSelectMethod(m.code)}
              className={`border rounded-lg p-4 cursor-pointer transition-all duration-200 hover:border-border-2 hover:bg-bg-2 flex flex-col justify-between relative bg-bg-1 ${
                isRecommended
                  ? 'border-accent/40 bg-accent-dim shadow-[0_2px_12px_rgba(91,124,250,0.05)]'
                  : 'border-border'
              }`}
            >
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="font-mono text-sm font-bold text-accent w-12 flex-shrink-0">
                    {m.code}
                  </div>
                  <div className="text-xs font-semibold text-text-main flex-1">
                    {m.label}
                  </div>
                  {isRecommended && (
                    <span className="text-[9px] font-bold uppercase tracking-wider bg-accent text-white px-2 py-0.5 rounded">
                      Recommended
                    </span>
                  )}
                </div>
                <div className="text-[11.5px] text-text-sub leading-normal mb-3">
                  {m.desc}
                </div>
              </div>

              <div>
                {/* Suitability score bar */}
                <div className="h-1 bg-bg-3 rounded-full mb-1">
                  <div
                    className="h-full bg-accent rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(m.score * 10, 100)}%` }}
                  />
                </div>
                <div className="text-[9.5px] text-text-muted flex justify-between">
                  <span>Suitability Score</span>
                  <span>{m.score.toFixed(1)} / 10</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
