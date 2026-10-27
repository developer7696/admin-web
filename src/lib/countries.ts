/// Every ISO 3166-1 alpha-2 country, named by the browser's `Intl` data, so the
/// panel carries no country list of its own. `Intl` also names a few codes that
/// are not countries (the EU, the UN, ICU's pseudo-regions); those are dropped.

const NOT_COUNTRIES = new Set(['AC', 'CP', 'CQ', 'DG', 'EA', 'EU', 'EZ', 'IC', 'QO', 'TA', 'UN', 'XA', 'XB', 'ZZ']);

let names: Intl.DisplayNames | undefined;
const regionNames = (): Intl.DisplayNames =>
  (names ??= new Intl.DisplayNames(['en'], { type: 'region' }));

/// "United Kingdom" for "GB"; the code itself when the browser cannot name it.
export function countryName(code: string): string {
  try {
    return regionNames().of(code) ?? code;
  } catch {
    return code;
  }
}

let all: { code: string; name: string }[] | undefined;

/// Every country, sorted by name. Built once.
export function allCountries(): { code: string; name: string }[] {
  if (all) return all;
  const out: { code: string; name: string }[] = [];
  const A = 'A'.charCodeAt(0);
  for (let i = 0; i < 26; i++) {
    for (let j = 0; j < 26; j++) {
      const code = String.fromCharCode(A + i, A + j);
      if (NOT_COUNTRIES.has(code)) continue;
      const name = countryName(code);
      if (name !== code && name !== 'Unknown Region') out.push({ code, name });
    }
  }
  all = out.sort((a, b) => a.name.localeCompare(b.name));
  return all;
}
