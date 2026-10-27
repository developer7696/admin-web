/// Reads a contact list out of an Excel (.xlsx) or CSV file.
///
/// Columns are found by their header, in any order and any case: an Email
/// column (required), and Name and Phone when present. Every other column is
/// ignored. A sheet with no header row still works when one column is plainly
/// email addresses.

export type SheetContact = { email: string; name: string | null; phone: string | null };

export type SheetReadout = {
  contacts: SheetContact[];
  /// Rows whose email is missing or not an email.
  invalid: number;
  /// Rows repeating an email already seen (the last one wins).
  duplicates: number;
  /// Whether Name / Phone columns were found - shown in the preview.
  columns: { name: boolean; phone: boolean };
};

type Cell = string | number | boolean | Date | null | undefined;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const text = (cell: Cell): string => {
  if (cell == null) return '';
  if (cell instanceof Date) return '';
  // Phone numbers typed into Excel come back as numbers - keep every digit.
  if (typeof cell === 'number') return Number.isInteger(cell) ? cell.toFixed(0) : String(cell);
  return String(cell).trim();
};

const isHeader = {
  email: (h: string) => /^e-?mail(\s*(address|id))?$/i.test(h),
  name: (h: string) => /^(full\s*)?name$|^first\s*name$|^contact\s*name$/i.test(h),
  phone: (h: string) => /phone|mobile|whatsapp|contact\s*(no|number)|^cell/i.test(h),
};

/// Pure: the table → contacts. Exported for tests.
export function contactsFromTable(table: Cell[][]): SheetReadout {
  const rows = table.map((r) => r.map(text));
  let headerIndex = rows.findIndex((r) => r.some((h) => isHeader.email(h)));
  let emailCol: number;
  let nameCol = -1;
  let phoneCol = -1;
  if (headerIndex >= 0) {
    const header = rows[headerIndex] ?? [];
    emailCol = header.findIndex((h) => isHeader.email(h));
    nameCol = header.findIndex((h) => isHeader.name(h));
    phoneCol = header.findIndex((h) => isHeader.phone(h));
  } else {
    // No header: the column where most cells are emails.
    headerIndex = -1;
    const width = Math.max(0, ...rows.map((r) => r.length));
    let best = -1;
    let bestCount = 0;
    for (let c = 0; c < width; c++) {
      const count = rows.filter((r) => EMAIL.test(r[c] ?? '')).length;
      if (count > bestCount) {
        best = c;
        bestCount = count;
      }
    }
    emailCol = best;
  }

  const byEmail = new Map<string, SheetContact>();
  let invalid = 0;
  let duplicates = 0;
  if (emailCol >= 0) {
    for (const row of rows.slice(headerIndex + 1)) {
      if (row.every((cell) => cell === '')) continue;
      const email = (row[emailCol] ?? '').toLowerCase();
      if (!EMAIL.test(email)) {
        invalid++;
        continue;
      }
      if (byEmail.has(email)) duplicates++;
      byEmail.set(email, {
        email,
        name: nameCol >= 0 && row[nameCol] ? (row[nameCol] ?? null) : null,
        phone: phoneCol >= 0 && row[phoneCol] ? (row[phoneCol] ?? null) : null,
      });
    }
  }
  return {
    contacts: [...byEmail.values()],
    invalid,
    duplicates,
    columns: { name: nameCol >= 0, phone: phoneCol >= 0 },
  };
}

/// RFC 4180-ish CSV: quoted fields, doubled quotes, commas and newlines inside quotes.
export function parseCsv(input: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = input.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      out.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    out.push(row);
  }
  return out;
}

/// Read the first sheet of [file]. Throws an Error with a readable message.
export async function readContactSheet(file: File): Promise<SheetReadout> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv')) return contactsFromTable(parseCsv(await file.text()));
  if (!name.endsWith('.xlsx')) {
    throw new Error('Upload an Excel .xlsx or a .csv file. (Older .xls files: open in Excel and "Save as" .xlsx.)');
  }
  const { readSheet } = await import('read-excel-file/browser');
  try {
    return contactsFromTable((await readSheet(file)) as Cell[][]);
  } catch {
    throw new Error('Could not read this Excel file. Check it opens in Excel and is saved as .xlsx.');
  }
}
