import { describe, it, expect } from '@jest/globals';

describe('Example Test Suite', () => {
  it('should pass a basic test', () => {
    expect(true).toBe(true);
  });

  it('should perform a simple calculation', () => {
    const result: number = 2 + 2;
    expect(result).toBe(4);
  });

  describe('Nested Test Suite', () => {
    it('should handle async code', async () => {
      const asyncFunc = (): Promise<string> => Promise.resolve('async result');
      const result: string = await asyncFunc();
      expect(result).toBe('async result');
    });
  });
});
