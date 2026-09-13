/// Browser-download CSV export. Port of lib/utils/csv_export.dart.
export function toCsv(rows: unknown[][]): string {
  return rows.map((row) => row.map(escapeCsvField).join(',')).join('\r\n');
}

export function downloadCsv(filename: string, rows: unknown[][]): void {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function escapeCsvField(field: unknown): string {
  const value = field == null ? '' : String(field);
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}
