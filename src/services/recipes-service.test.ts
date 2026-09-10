import { describe, expect, it, vi } from 'vitest';

// The service reaches the API client, which reads the Firebase Auth instance at
// import time. Nothing here makes a request, so the module is stubbed rather
// than initialising Firebase in a node test run.
vi.mock('@/lib/firebase', () => ({ auth: {}, db: {}, storage: {} }));

const { parseRecipeFilters, parseRecipeStats, toRecipePayload } = await import('./recipes-service');

describe('parseRecipeFilters', () => {
  it('keeps only non-blank strings', () => {
    expect(
      parseRecipeFilters({
        tags: ['High protein', '', '  ', 7, null, 'Vegan'],
        difficulties: ['Easy', 'Hard'],
      }),
    ).toEqual({ tags: ['High protein', 'Vegan'], difficulties: ['Easy', 'Hard'] });
  });

  it('is empty for a payload that carries no catalogue', () => {
    expect(parseRecipeFilters(null)).toEqual({ tags: [], difficulties: [] });
    expect(parseRecipeFilters({ tags: 'High protein' })).toEqual({ tags: [], difficulties: [] });
  });
});

describe('parseRecipeStats', () => {
  it("reads the API's `drafts` as the panel's `unpublished`", () => {
    expect(
      parseRecipeStats({
        total: 12,
        published: 9,
        drafts: 3,
        totalViews: 431,
        byDifficulty: { Easy: 7 },
        byTag: { Vegan: 2 },
      }),
    ).toEqual({ total: 12, published: 9, unpublished: 3, totalViews: 431 });
  });

  it('counts a missing or non-numeric figure as zero rather than NaN', () => {
    expect(parseRecipeStats({ total: '12', published: null })).toEqual({
      total: 0,
      published: 0,
      unpublished: 0,
      totalViews: 0,
    });
  });
});

describe('toRecipePayload', () => {
  const input = {
    name: 'Paneer bhurji',
    description: 'Ten minutes, one pan.',
    ingredients: ['200 g paneer'],
    instructions: ['Crumble and fry.'],
    nutrition: { calories: 420, protein: 28 },
    servings: 2,
    totalTime: 10,
    difficulty: 'Easy',
    tags: ['High protein'],
  };

  it('sends the form fields flat, as the API speaks them', () => {
    expect(toRecipePayload(input)).toEqual({
      name: 'Paneer bhurji',
      description: 'Ten minutes, one pan.',
      ingredients: ['200 g paneer'],
      instructions: ['Crumble and fry.'],
      nutrition: { calories: 420, protein: 28 },
      servings: 2,
      totalTime: 10,
      difficulty: 'Easy',
      tags: ['High protein'],
    });
  });

  it('turns an unselected difficulty into null, which the API takes as "clear it"', () => {
    // An empty string is rejected server-side: `difficulty` is bounded free
    // text, not an enum, so it has a minimum length.
    expect(toRecipePayload({ ...input, difficulty: '' }).difficulty).toBeNull();
    expect(toRecipePayload({ ...input, difficulty: '   ' }).difficulty).toBeNull();
  });

  it('never sends an author — the server stamps it from the verified token', () => {
    const payload = toRecipePayload(input);
    expect(payload).not.toHaveProperty('authorId');
    expect(payload).not.toHaveProperty('authorEmail');
    expect(payload).not.toHaveProperty('authorName');
  });

  it('leaves the publish flag out, so create defaults to a draft and an edit does not republish', () => {
    expect(toRecipePayload(input)).not.toHaveProperty('isPublished');
  });
});
