'use client';
import React, { useState, useRef, useEffect } from 'react';

interface ExportMenuProps {
  onExportCSV: () => void;
  onExportExcel: () => void;
  onExportPDF: () => void;
  label?: string;
  disabled?: boolean;
}

export default function ExportMenu({
  onExportCSV,
  onExportExcel,
  onExportPDF,
  label = 'Export',
  disabled = false,
}: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState<'csv' | 'excel' | 'pdf' | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handle = async (
    key: 'csv' | 'excel' | 'pdf',
    fn: () => void | Promise<void>
  ) => {
    setLoading(key);
    setOpen(false);
    try {
      await fn();
    } finally {
      setLoading(null);
    }
  };

  const isLoading = loading !== null;

  return (
    <div className="relative" ref={ref}>
      <button
        id="export-menu-trigger"
        onClick={() => !disabled && !isLoading && setOpen((o) => !o)}
        disabled={disabled || isLoading}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-2 border border-border rounded text-xs text-text-sub font-medium hover:border-border-2 hover:text-text-main transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed select-none"
        title={disabled ? 'No data to export yet' : 'Export data'}
      >
        {isLoading ? (
          <>
            <span className="animate-spin inline-block">⏳</span>
            <span>Exporting…</span>
          </>
        ) : (
          <>
            <span>↓</span>
            <span>{label}</span>
            <span className="text-[9px] opacity-50">{open ? '▲' : '▼'}</span>
          </>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-bg-1 border border-border rounded-lg shadow-2xl py-1 w-44 overflow-hidden">
          {/* Header */}
          <div className="px-3 py-1.5 border-b border-border/60">
            <span className="text-[9px] font-bold uppercase tracking-wider text-text-muted">
              Download as
            </span>
          </div>

          <button
            id="export-csv-btn"
            onClick={() => handle('csv', onExportCSV)}
            className="w-full text-left px-3 py-2.5 text-xs text-text-sub hover:bg-bg-2 hover:text-text-main transition-colors flex items-center gap-2.5 cursor-pointer"
          >
            <span className="text-base leading-none">📄</span>
            <div>
              <div className="font-medium">CSV</div>
              <div className="text-[10px] text-text-muted">Comma-separated values</div>
            </div>
          </button>

          <button
            id="export-excel-btn"
            onClick={() => handle('excel', onExportExcel)}
            className="w-full text-left px-3 py-2.5 text-xs text-text-sub hover:bg-bg-2 hover:text-text-main transition-colors flex items-center gap-2.5 cursor-pointer"
          >
            <span className="text-base leading-none">📊</span>
            <div>
              <div className="font-medium">Excel</div>
              <div className="text-[10px] text-text-muted">Multi-sheet .xlsx workbook</div>
            </div>
          </button>

          <button
            id="export-pdf-btn"
            onClick={() => handle('pdf', onExportPDF)}
            className="w-full text-left px-3 py-2.5 text-xs text-text-sub hover:bg-bg-2 hover:text-text-main transition-colors flex items-center gap-2.5 cursor-pointer"
          >
            <span className="text-base leading-none">📑</span>
            <div>
              <div className="font-medium">PDF</div>
              <div className="text-[10px] text-text-muted">Landscape A4 report</div>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}
