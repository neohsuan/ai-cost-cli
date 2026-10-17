import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../src/cli.js';
import { parseConfig } from '../src/config.js';
import { sendWebhook } from '../src/webhook.js';
import { createReport } from '../src/report.js';
import { monthPeriod } from '../src/period.js';

vi.mock('@google-cloud/bigquery', () => ({ BigQuery: vi.fn() }));
vi.mock('../src/config.js', async importOriginal => ({ ...await importOriginal<typeof import('../src/config.js')>(), loadConfig: vi.fn() }));
import { loadConfig } from '../src/config.js';
const mockLoad = vi.mocked(loadConfig);
let log: ReturnType<typeof vi.spyOn>, error: ReturnType<typeof vi.spyOn>;
const config = (webhook = false) => parseConfig({ providers: { openai: { monthlyBudget: 100, thresholds: [0.8, 1] } },
  ...(webhook ? { webhook: { type: 'slack', urlEnv: 'TEST_WEBHOOK_URL' } } : {}) });
const response = (cost: number) => Response.json({ data: [{ results: [{ amount: { value: cost, currency: 'usd' } }] }], has_more: false });
async function run(...args: string[]) { await createProgram().parseAsync(['node', 'ai-cost-cli', ...args]); }
beforeEach(() => {
  vi.stubEnv('OPENAI_ADMIN_KEY', 'test-key');
  vi.stubEnv('TEST_WEBHOOK_URL', 'https://hooks.example.test/test');
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
  process.exitCode = 0;
  mockLoad.mockResolvedValue(config());
});
afterEach(() => { process.exitCode = 0; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe('CLI commands', () => {
  it('prints table usage and exits successfully even above budget', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(110)));
    await run('usage', '--month', '2026-09');
    expect(log.mock.calls[0][0]).toContain('110.00');
    expect(log.mock.calls[0][0]).toContain('Provider');
    expect(process.exitCode).toBe(0);
  });
  it.each([['79.99', 0, 0], ['80', 1, 1], ['100', 1, 2], ['125', 1, 2]])('checks cost %s with inclusive thresholds', async (cost, code, alerts) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(Number(cost))));
    await run('check', '--json', '--month', '2026-09');
    const output = JSON.parse(log.mock.calls[0][0]);
    expect(output.alerts).toHaveLength(alerts);
    expect(output.providers[0].cost).toBe(Number(cost));
    expect(process.exitCode).toBe(code);
  });
  it('prints alerts in table mode and delivers one webhook', async () => {
    mockLoad.mockResolvedValue(config(true));
    const fetchMock = vi.fn().mockResolvedValueOnce(response(90)).mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await run('check', '--month', '2026-09');
    expect(log.mock.calls[1][0]).toContain('ALERT openai');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(process.exitCode).toBe(1);
  });
  it.each(['usage', 'check'])('does not send webhook below threshold for %s', async command => {
    mockLoad.mockResolvedValue(config(true));
    const fetchMock = vi.fn().mockResolvedValue(response(10)); vi.stubGlobal('fetch', fetchMock);
    await run(command, '--month', '2026-09');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('supports --no-webhook and format json', async () => {
    mockLoad.mockResolvedValue(config(true));
    const fetchMock = vi.fn().mockResolvedValue(response(120)); vi.stubGlobal('fetch', fetchMock);
    await run('check', '--no-webhook', '--format', 'json', '--config', '/tmp/custom.json', '--provider', 'openai', '--month', '2026-09');
    expect(mockLoad).toHaveBeenCalledWith('/tmp/custom.json');
    expect(JSON.parse(log.mock.calls[0][0]).alerts).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('exits 2 on API failure and never reports false success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    await run('check', '--json', '--month', '2026-09');
    expect(process.exitCode).toBe(2);
    expect(log).not.toHaveBeenCalled();
    expect(error.mock.calls[0][0]).toContain('HTTP 401');
  });
  it('preserves printed alerts and exits 2 when webhook delivery fails', async () => {
    mockLoad.mockResolvedValue(config(true));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(120)).mockResolvedValueOnce(new Response(null, { status: 500 })));
    await run('check', '--json', '--month', '2026-09');
    expect(JSON.parse(log.mock.calls[0][0]).alerts).toHaveLength(2);
    expect(error.mock.calls[0][0]).toContain('Webhook');
    expect(process.exitCode).toBe(2);
  });
  it('rejects a selected provider with no config', async () => {
    await expect(createReport(config(), monthPeriod('2026-09'), 'vertex')).rejects.toThrow('not configured');
  });
});
describe('webhook HTTP', () => {
  it.each(['slack', 'discord'] as const)('uses a %s compatible payload', async type => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 })); vi.stubGlobal('fetch', fetchMock);
    await sendWebhook({ type, urlEnv: 'TEST_WEBHOOK_URL' }, ['alert one', 'alert two']);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://hooks.example.test/test');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual(type === 'slack' ? { text: 'alert one\nalert two' } : { content: 'alert one\nalert two', allowed_mentions: { parse: [] } });
  });
  it('skips empty alerts', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    await sendWebhook({ type: 'slack', urlEnv: 'MISSING' }, []);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rejects missing or insecure URLs', async () => {
    vi.stubEnv('TEST_WEBHOOK_URL', 'http://example.test');
    await expect(sendWebhook({ type: 'slack', urlEnv: 'TEST_WEBHOOK_URL' }, ['alert'])).rejects.toThrow('HTTPS');
    await expect(sendWebhook({ type: 'slack', urlEnv: 'MISSING' }, ['alert'])).rejects.toThrow('HTTPS');
  });
  it('sanitizes webhook transport errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('secret-url')));
    await expect(sendWebhook({ type: 'slack', urlEnv: 'TEST_WEBHOOK_URL' }, ['alert'])).rejects.toThrow('network or timeout');
  });
});
