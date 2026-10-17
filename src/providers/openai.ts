import { z } from 'zod';
import type { Period } from '../period.js';

const pageSchema = z.object({
  data: z.array(z.object({ results: z.array(z.object({
    amount: z.object({ value: z.number().finite(), currency: z.string() }),
  })) })),
  has_more: z.boolean(),
  next_page: z.string().nullable().optional(),
});
export async function openaiCost(period: Period): Promise<number> {
  const key = process.env.OPENAI_ADMIN_KEY?.trim();
  if (!key) throw new Error('OPENAI_ADMIN_KEY is required for OpenAI Costs API (organization admin key).');
  if (period.start.getTime() === period.end.getTime()) return 0;
  let total = 0;
  let page: string | undefined;
  const seen = new Set<string>();
  do {
    const url = new URL('https://api.openai.com/v1/organization/costs');
    url.searchParams.set('start_time', String(Math.floor(period.start.getTime() / 1000)));
    url.searchParams.set('end_time', String(Math.floor(period.end.getTime() / 1000)));
    url.searchParams.set('bucket_width', '1d');
    url.searchParams.set('limit', '31');
    if (page) url.searchParams.set('page', page);
    let response: Response;
    try {
      response = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30_000), redirect: 'error' });
    } catch { throw new Error('OpenAI Costs API request failed (network or timeout).'); }
    if (!response.ok) throw new Error(`OpenAI Costs API returned HTTP ${response.status}. Check admin key and organization permissions.`);
    let parsed;
    try { parsed = pageSchema.parse(await response.json()); }
    catch { throw new Error('OpenAI Costs API returned an invalid response.'); }
    for (const bucket of parsed.data) {
      for (const result of bucket.results) {
        if (result.amount.currency.toUpperCase() !== 'USD') throw new Error('OpenAI returned a non-USD cost.');
        total += result.amount.value;
      }
    }
    if (!Number.isFinite(total)) throw new Error('OpenAI cost total is not finite.');
    if (!parsed.has_more) break;
    if (!parsed.next_page || seen.has(parsed.next_page)) throw new Error('OpenAI Costs API returned invalid pagination.');
    page = parsed.next_page;
    seen.add(page);
  } while (true);
  return total;
}
