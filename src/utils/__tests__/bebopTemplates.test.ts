import { describe, it, expect } from 'vitest';
import { PHRASE_TEMPLATES, selectTemplate, allocateEighths } from '../bebopTemplates';

describe('PHRASE_TEMPLATES', () => {
  it('has at least 10 templates', () => {
    expect(PHRASE_TEMPLATES.length).toBeGreaterThanOrEqual(10);
  });

  it('all templates have required fields', () => {
    for (const t of PHRASE_TEMPLATES) {
      expect(t.id).toBeTruthy();
      expect(t.label).toBeTruthy();
      expect(t.segments.length).toBeGreaterThan(0);
      expect(t.weight).toBeGreaterThan(0);
      expect(['arch', 'reverse-arch', 'descending', 'wave', 'ascending']).toContain(t.contour);
    }
  });

  it('arp-up-scale-down has highest weight', () => {
    const arp = PHRASE_TEMPLATES.find(t => t.id === 'arp-up-scale-down')!;
    expect(arp).toBeTruthy();
    for (const t of PHRASE_TEMPLATES) {
      expect(arp.weight).toBeGreaterThanOrEqual(t.weight);
    }
  });

  it('dim7-from-3rd is restricted to dom7 qualities', () => {
    const dim7 = PHRASE_TEMPLATES.find(t => t.id === 'dim7-from-3rd')!;
    expect(dim7.qualityFilter).toBeTruthy();
    expect(dim7.qualityFilter!.includes('7')).toBe(true);
    expect(dim7.qualityFilter!.includes('maj7')).toBe(false);
  });
});

describe('selectTemplate', () => {
  it('returns a template for dom7', () => {
    const t = selectTemplate('7', 4);
    expect(t).toBeTruthy();
    expect(t.id).toBeTruthy();
  });

  it('excludes quality-filtered templates for wrong quality', () => {
    // dim7-from-3rd should not be selected for maj7
    let found = false;
    for (let i = 0; i < 50; i++) {
      const t = selectTemplate('maj7', 4);
      if (t.id === 'dim7-from-3rd') found = true;
    }
    expect(found).toBe(false);
  });

  it('can select dim7-from-3rd for dom7', () => {
    let found = false;
    for (let i = 0; i < 100; i++) {
      const t = selectTemplate('7', 4);
      if (t.id === 'dim7-from-3rd') found = true;
    }
    expect(found).toBe(true);
  });

  it('prefers templates matching contour', () => {
    // Run many times and check contour affinity
    const counts = { match: 0, total: 0 };
    for (let i = 0; i < 100; i++) {
      const t = selectTemplate('7', 4, 'arch');
      counts.total++;
      if (t.contour === 'arch') counts.match++;
    }
    // arch templates should appear more often than 25% (random)
    expect(counts.match / counts.total).toBeGreaterThan(0.25);
  });
});

describe('allocateEighths', () => {
  it('allocates eighths correctly for arp-up-scale-down', () => {
    const t = PHRASE_TEMPLATES.find(t => t.id === 'arp-up-scale-down')!;
    const result = allocateEighths(t, 8);
    expect(result).toEqual([4, 4]); // 2 beats arp + 2 beats (remainder) scale
  });

  it('allocates remainder to segment with beats=0', () => {
    const t = PHRASE_TEMPLATES.find(t => t.id === 'scale-down')!;
    const result = allocateEighths(t, 8);
    expect(result).toEqual([8]); // all 8 eighths to the single segment
  });

  it('handles 4-eighth phrases', () => {
    const t = PHRASE_TEMPLATES.find(t => t.id === 'arp-up-scale-down')!;
    const result = allocateEighths(t, 4);
    // 2 beats (4 eighths) fixed for arp, remainder = 0 → minimum 2
    expect(result[0]).toBe(4);
    expect(result[1]).toBe(2); // minimum remainder
  });
});
