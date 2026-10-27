import { describe, expect, it } from 'vitest';
import { allCountries, countryName } from './countries';

describe('countries', () => {
  it('names a country from its code', () => {
    expect(countryName('GB')).toBe('United Kingdom');
    expect(countryName('IN')).toBe('India');
  });

  it('lists real countries only, sorted by name', () => {
    const list = allCountries();
    const codes = new Set(list.map((c) => c.code));
    expect(codes.has('DE')).toBe(true);
    expect(codes.has('EU')).toBe(false);
    expect(codes.has('UN')).toBe(false);
    expect(codes.has('ZZ')).toBe(false);
    expect(list.length).toBeGreaterThan(200);
    const names = list.map((c) => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});
