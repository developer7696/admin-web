import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';

describe('toCsv', () => {
  it('joins fields with commas and rows with CRLF', () => {
    expect(toCsv([['a', 'b'], ['c', 'd']])).toBe('a,b\r\nc,d');
  });

  it('stringifies non-string fields and blanks out null/undefined', () => {
    expect(toCsv([[1, true, null, undefined]])).toBe('1,true,,');
  });

  it('quotes fields containing commas', () => {
    expect(toCsv([['Push, Pull & Legs', 'x']])).toBe('"Push, Pull & Legs",x');
  });

  it('doubles embedded quotes and wraps the field', () => {
    expect(toCsv([['the "big" one']])).toBe('"the ""big"" one"');
  });

  it('quotes fields containing newlines', () => {
    expect(toCsv([['line1\nline2']])).toBe('"line1\nline2"');
  });

  it('leaves plain fields unquoted', () => {
    expect(toCsv([['plain']])).toBe('plain');
  });
});
