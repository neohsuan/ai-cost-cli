import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openaiCost } from '../src/providers/openai.js';
import { vertexCost } from '../src/providers/vertex.js';
import { monthPeriod } from '../src/period.js';

const { query, constructor } = vi.hoisted(() => ({ query: vi.fn(), constructor: vi.fn() }));
vi.mock('@google-cloud/bigquery', () => ({ BigQuery: class {
  constructor(options: unknown) { constructor(options); }
  query = query;
} }));
const period = monthPeriod('2026-09', new Date('2026-10-17T12:00:00Z'));
const vertex = { table: 'my-project.billing.costs', monthlyBudget: 100, currency: 'USD', thresholds: [0.8, 1], location: 'US', maximumBytesBilled: '1000000' };
const page = (values: number[], more = false, next: string | null = null) => ({
  data: [{ results: values.map(value => ({ amount: { value, currency: 'usd' } })) }], has_more: more, next_page: next,
});
beforeEach(() => { vi.stubEnv('OPENAI_ADMIN_KEY', 'test-admin-key'); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe('OpenAI Costs API', () => {
  it('authenticates, requests the UTC range and totals all pages including credits', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(page([30, 20], true, 'next-token')))
      .mockResolvedValueOnce(Response.json(page([40, -5])));
    vi.stubGlobal('fetch', fetchMock);
    expect(await openaiCost(period)).toBe(85);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url.origin + url.pathname).toBe('https://api.openai.com/v1/organization/costs');
    expect(url.searchParams.get('start_time')).toBe(String(period.start.getTime() / 1000));
    expect(url.searchParams.get('end_time')).toBe(String(period.end.getTime() / 1000));
    expect(url.searchParams.get('bucket_width')).toBe('1d');
    expect(options.headers.Authorization).toBe('Bearer test-admin-key');
    expect(fetchMock.mock.calls[1][0].searchParams.get('page')).toBe('next-token');
  });
  it('returns zero for empty results', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(page([]))));
    expect(await openaiCost(period)).toBe(0);
  });
  it('requires an admin key before fetching', async () => {
    vi.stubEnv('OPENAI_ADMIN_KEY', '');
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    await expect(openaiCost(period)).rejects.toThrow('OPENAI_ADMIN_KEY');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([401, 403, 429, 500])('reports HTTP %s without exposing response secrets', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('secret-body', { status })));
    await expect(openaiCost(period)).rejects.toThrow(`HTTP ${status}`);
  });
  it('sanitizes network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('test-admin-key')));
    await expect(openaiCost(period)).rejects.toThrow('network or timeout');
  });
  it.each([{}, { data: [], has_more: true }, page([1], true, 'repeat')])('rejects malformed responses or pagination', async body => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => Response.json(body)));
    await expect(openaiCost(period)).rejects.toThrow(/invalid/);
  });
  it('rejects unexpected currency', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ data: [{ results: [{ amount: { value: 1, currency: 'eur' } }] }], has_more: false })));
    await expect(openaiCost(period)).rejects.toThrow('non-USD');
  });
});

describe('Vertex billing export', () => {
  it('queries service and UTC usage range with net credits and query limits', async () => {
    query.mockResolvedValueOnce([[{ currency: 'USD', total: '42.25' }]]);
    expect(await vertexCost(vertex, period)).toBe(42.25);
    const options = query.mock.calls[0][0];
    expect(options.query).toContain('FROM `my-project.billing.costs`');
    expect(options.query).toContain('SUM(cost + IFNULL');
    expect(options.query).toContain('UNNEST(credits)');
    expect(options.query).toContain('usage_start_time < TIMESTAMP(@end)');
    expect(options.params).toEqual({ service: 'Vertex AI', start: period.start.toISOString(), end: period.end.toISOString() });
    expect(options).toMatchObject({ useLegacySql: false, location: 'US', maximumBytesBilled: '1000000' });
  });
  it('returns zero when no billing rows exist', async () => {
    query.mockResolvedValueOnce([[]]);
    expect(await vertexCost(vertex, period)).toBe(0);
  });
  it('rejects a table identifier containing SQL', async () => {
    await expect(vertexCost({ ...vertex, table: 'p.d.t` WHERE true --' }, period)).rejects.toThrow('table name');
    expect(query).not.toHaveBeenCalled();
  });
  it('refuses mixed or mismatched currencies', async () => {
    query.mockResolvedValueOnce([[{ currency: 'USD', total: 1 }, { currency: 'TWD', total: 30 }]]);
    await expect(vertexCost(vertex, period)).rejects.toThrow('currency');
  });
  it.each([null, '', 'bad', Infinity])('rejects invalid cost %s', async total => {
    query.mockResolvedValueOnce([[{ currency: 'USD', total }]]);
    await expect(vertexCost(vertex, period)).rejects.toThrow('invalid cost');
  });
  it('reports query errors without leaking credentials', async () => {
    query.mockRejectedValueOnce(new Error('secret-credential'));
    await expect(vertexCost(vertex, period)).rejects.toThrow('ADC credentials');
  });
});
