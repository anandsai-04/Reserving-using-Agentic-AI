'use client';
import React, { useState, useEffect } from 'react';
import { ModelParam } from '../types';

interface ParamsViewProps {
  code: string;
  params: ModelParam[];
  dataSource: 'paid' | 'incurred';
  onSubmit: (paramValues: Record<string, any>) => void;
}

export default function ParamsView({ code, params, dataSource, onSubmit }: ParamsViewProps) {
  const [values, setValues] = useState<Record<string, any>>({});

  useEffect(() => {
    const defaultValues: Record<string, any> = {};
    params.forEach((p) => {
      defaultValues[p.key] = p.default;
    });
    setValues(defaultValues);
  }, [params]);

  const handleChange = (key: string, val: string) => {
    const parsed = parseFloat(val);
    setValues({
      ...values,
      [key]: isNaN(parsed) ? '' : parsed,
    });
  };

  const handleSubmit = () => {
    onSubmit(values);
  };

  return (
    <div className="flex flex-col flex-1 max-w-lg animate-slide-in">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-lg font-bold text-text-main">Parameters for {code}</h2>
        <span className="text-[10px] font-bold uppercase tracking-wider bg-bg-1 border border-border text-accent px-2 py-1 rounded">
          Source: {dataSource === 'incurred' ? 'Incurred' : 'Paid'}
        </span>
      </div>

      <div className="bg-bg-1 border border-border rounded-lg p-5 flex flex-col gap-4.5">
        {params.map((p) => (
          <div key={p.key} className="flex flex-col gap-1.5">
            <label className="text-[12.5px] font-semibold text-text-main flex items-center gap-1.5">
              {p.label}
            </label>
            <input
              type="number"
              value={values[p.key] ?? ''}
              onChange={(e) => handleChange(p.key, e.target.value)}
              step="any"
              className="bg-bg-2 border border-border-2 rounded px-3 py-2 text-xs text-text-main outline-none focus:border-accent w-full max-w-[200px]"
            />
          </div>
        ))}

        <button
          onClick={handleSubmit}
          className="mt-2.5 px-5 py-2.5 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded shadow-[0_4px_16px_rgba(91,124,250,0.3)] transition-colors cursor-pointer w-fit"
        >
          Execute Tool →
        </button>
      </div>
    </div>
  );
}
