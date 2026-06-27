// ─── Export Utilities ───────────────────────────────────────────────────────
// Shared helpers for CSV, Excel, and PDF downloads.
// All use dynamic imports to stay SSR-safe in Next.js.

export interface SheetDef {
  name: string;
  headers: string[];
  rows: (string | number | null)[][];
}

export interface TableDef {
  title: string;
  headers: string[];
  rows: (string | number | null)[][];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function escapeCSV(v: string | number | null): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── CSV ───────────────────────────────────────────────────────────────────────
// Single-sheet CSV export (multi-sheet: call multiple times or join with blank line separator).

export function downloadCSV(
  filename: string,
  headers: string[],
  rows: (string | number | null)[][]
): void {
  const lines = [
    headers.map(escapeCSV).join(','),
    ...rows.map((r) => r.map(escapeCSV).join(',')),
  ];
  // BOM prefix for correct UTF-8 handling in Excel
  const blob = new Blob(['\uFEFF' + lines.join('\n')], {
    type: 'text/csv;charset=utf-8;',
  });
  triggerDownload(blob, filename);
}

// ── Excel (.xlsx) ─────────────────────────────────────────────────────────────
// Multi-sheet Excel using SheetJS (xlsx). Loaded dynamically.

export async function downloadExcel(
  filename: string,
  sheets: SheetDef[]
): Promise<void> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();

  for (const sheet of sheets) {
    const wsData = [sheet.headers, ...sheet.rows];
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Auto column widths (approximate)
    const colWidths = sheet.headers.map((h, ci) => {
      const maxLen = Math.max(
        h.length,
        ...sheet.rows.map((r) => String(r[ci] ?? '').length)
      );
      return { wch: Math.min(maxLen + 2, 40) };
    });
    ws['!cols'] = colWidths;

    // Excel sheet names max 31 chars
    XLSX.utils.book_append_sheet(wb, ws, sheet.name.substring(0, 31));
  }

  XLSX.writeFile(wb, filename);
}

// ── PDF ───────────────────────────────────────────────────────────────────────
// Multi-table landscape PDF using jsPDF + jspdf-autotable. Loaded dynamically.

export async function downloadPDF(
  filename: string,
  reportTitle: string,
  tables: TableDef[]
): Promise<void> {
  const { default: jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();

  // ── Cover header ─────────────────────────────────────────────────────────
  doc.setFillColor(20, 24, 50);
  doc.rect(0, 0, pageW, 68, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  doc.text(reportTitle, 36, 32);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(180, 185, 220);
  doc.text(
    `Actuarial Reserving Platform  ·  Generated ${new Date().toLocaleString()}`,
    36,
    50
  );

  doc.setTextColor(0, 0, 0);

  let currentY = 84;

  for (let i = 0; i < tables.length; i++) {
    const table = tables[i];

    // Section label
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(60, 70, 140);
    doc.text(table.title, 36, currentY);
    doc.setTextColor(0, 0, 0);
    currentY += 6;

    autoTable(doc, {
      startY: currentY,
      head: [table.headers],
      body: table.rows.map((r) =>
        r.map((v) => (v === null || v === undefined ? '—' : String(v)))
      ),
      styles: {
        fontSize: 7,
        cellPadding: { top: 3, right: 5, bottom: 3, left: 5 },
        overflow: 'linebreak',
        textColor: [30, 30, 40],
      },
      headStyles: {
        fillColor: [30, 35, 70],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 7,
      },
      alternateRowStyles: { fillColor: [246, 247, 252] },
      theme: 'grid',
      margin: { left: 36, right: 36 },
    });

    currentY = (doc as any).lastAutoTable.finalY + 22;

    // New page if the next table won't fit
    if (
      i < tables.length - 1 &&
      currentY > doc.internal.pageSize.getHeight() - 80
    ) {
      doc.addPage();
      currentY = 40;
    }
  }

  doc.save(filename);
}
