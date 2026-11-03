import { describe, expect, it } from 'vitest';
import { parseExercise } from './exercise-catalog';
import { parseProgramSummary } from './program-catalog';

// Catalog documents written before publish state existed carry no flag and are
// live in the app, so only an explicit `false` may read as a draft.
describe('publish state', () => {
  it('reads a program summary with no flag as published', () => {
    expect(parseProgramSummary({ id: 'P01', name: 'Strength' }).isPublished).toBe(true);
    expect(parseProgramSummary({ id: 'P01', isPublished: true }).isPublished).toBe(true);
    expect(parseProgramSummary({ id: 'P01', isPublished: false }).isPublished).toBe(false);
  });

  it('reads an exercise with no flag as published', () => {
    expect(parseExercise({ id: 'E01', name: 'Squat' }).isPublished).toBe(true);
    expect(parseExercise({ id: 'E01', isPublished: false }).isPublished).toBe(false);
  });
});
