import { describe, expect, it } from 'vitest';
import { exclusive } from '../../src/ai/client';

describe('AI job queue', () => {
  it('runs jobs one at a time, in call order, even when one fails', async () => {
    const log: string[] = [];
    let running = 0;
    const job = (name: string, ms: number, fail = false) => exclusive(async () => {
      running++;
      expect(running).toBe(1);
      log.push(`start ${name}`);
      await new Promise((r) => setTimeout(r, ms));
      log.push(`end ${name}`);
      running--;
      if (fail) throw new Error(name);
      return name;
    });
    const results = await Promise.allSettled([job('cutout', 20), job('analyse', 5, true), job('search', 1)]);
    expect(log).toEqual(['start cutout', 'end cutout', 'start analyse', 'end analyse', 'start search', 'end search']);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
  });
});
