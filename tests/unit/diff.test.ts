import { describe, it, expect } from 'vitest';
import { diffLines } from '../../src/lib/diff';

describe('diffLines', () => {
  it('eq for identical text', () => {
    const out = diffLines('a\nb\nc', 'a\nb\nc');
    expect(out.every((l) => l.op === 'eq')).toBe(true);
  });

  it('marks additions and deletions', () => {
    const out = diffLines('a\nb\nc', 'a\nX\nc');
    const ops = out.map((l) => l.op);
    expect(ops).toContain('del');
    expect(ops).toContain('add');
  });

  it('handles empty inputs', () => {
    expect(diffLines('', '')).toEqual([{ op: 'eq', a: '', b: '' }]);
  });

  it('pure add / pure delete', () => {
    // '' 会被 split 出一行空字符串，所以 '' → 'x' 会产生 del '' + add 'x'
    const addOut = diffLines('', 'x');
    expect(addOut.some((l) => l.op === 'add' && l.b === 'x')).toBe(true);
    const delOut = diffLines('x', '');
    expect(delOut.some((l) => l.op === 'del' && l.a === 'x')).toBe(true);
  });
});
