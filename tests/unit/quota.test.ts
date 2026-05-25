import { describe, it, expect } from 'vitest';
import { ratioToLevel } from '../../src/lib/quota';

describe('ratioToLevel', () => {
  it('maps ratio to banner level', () => {
    expect(ratioToLevel(0)).toBe('none');
    expect(ratioToLevel(0.5)).toBe('none');
    expect(ratioToLevel(0.8)).toBe('none');     // strictly > 0.8
    expect(ratioToLevel(0.85)).toBe('warning');
    expect(ratioToLevel(0.95)).toBe('warning'); // strictly > 0.95
    expect(ratioToLevel(0.97)).toBe('critical');
    expect(ratioToLevel(1.0)).toBe('critical');
  });
});
