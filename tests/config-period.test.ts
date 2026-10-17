import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig, parseConfig } from '../src/config.js';
import { monthPeriod } from '../src/period.js';

const valid = { providers: { openai: { monthlyBudget: 100 } } };
describe('config', () => {
  it('defaults currency and thresholds', () => {
    expect(parseConfig(valid).providers.openai).toEqual({ monthlyBudget: 100, currency: 'USD', thresholds: [0.8, 1] });
  });
  it.each([
    {}, { providers: {} }, { providers: { other: {} } },
    { providers: { openai: { monthlyBudget: 0 } } },
    { providers: { openai: { monthlyBudget: -1 } } },
    { providers: { openai: { monthlyBudget: 100, thresholds: [] } } },
    { providers: { openai: { monthlyBudget: 100, thresholds: [0] } } },
    { providers: { openai: { monthlyBudget: 100, currency: 'EUR' } } },
    { providers: { vertex: { monthlyBudget: 100, table: 'p.d.t;SELECT' } } },
    { ...valid, webhook: { type: 'slack' } },
    { ...valid, webhook: { type: 'slack', url: 'http://example.com' } },
    { ...valid, webhook: { type: 'slack', url: 'https://example.com', urlEnv: 'HOOK' } },
  ])('rejects invalid configuration %#', value => { expect(() => parseConfig(value)).toThrow('Invalid configuration'); });
  it('uses local before home, supports explicit paths, and never falls back on invalid local files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ai-cost-test-'));
    try {
      const cwd = join(root, 'cwd'), home = join(root, 'home');
      await mkdir(cwd); await mkdir(home);
      await expect(loadConfig(undefined, cwd, home)).rejects.toThrow('not found');
      await writeFile(join(home, '.ai-cost.json'), JSON.stringify(valid));
      expect((await loadConfig(undefined, cwd, home)).providers.openai?.monthlyBudget).toBe(100);
      await writeFile(join(cwd, 'ai-cost.config.json'), JSON.stringify({ providers: { openai: { monthlyBudget: 200 } } }));
      expect((await loadConfig(undefined, cwd, home)).providers.openai?.monthlyBudget).toBe(200);
      await writeFile(join(cwd, 'ai-cost.config.json'), '{broken');
      await expect(loadConfig(undefined, cwd, home)).rejects.toThrow('Invalid JSON');
      expect((await loadConfig(join(home, '.ai-cost.json'), cwd, home)).providers.openai?.monthlyBudget).toBe(100);
      await expect(loadConfig('missing.json', cwd, home)).rejects.toThrow('Cannot read');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
describe('UTC periods', () => {
  const now = new Date('2026-10-17T12:34:56.789Z');
  it('caps current month at now to whole seconds', () => {
    const p = monthPeriod(undefined, now);
    expect(p.start.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(p.end.toISOString()).toBe('2026-10-17T12:34:56.000Z');
  });
  it('handles leap years and December rollover', () => {
    expect(monthPeriod('2024-02', now).end.toISOString()).toBe('2024-03-01T00:00:00.000Z');
    expect(monthPeriod('2025-12', now).end.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
  it.each(['2026-13', '2026-00', '26-01', '1969-12', '2026-11'])('rejects invalid or future month %s', month => {
    expect(() => monthPeriod(month, now)).toThrow();
  });
});
