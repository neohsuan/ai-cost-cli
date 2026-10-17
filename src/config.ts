import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { z } from 'zod';

const budget = z.object({
  monthlyBudget: z.number().finite().positive(),
  currency: z.string().regex(/^[A-Z]{3}$/).default('USD'),
  thresholds: z.array(z.number().finite().positive()).nonempty().default([0.8, 1]),
}).strict();
export const tablePattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]*\.[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*$/;
const schema = z.object({
  providers: z.object({
    openai: budget.extend({ currency: z.literal('USD').default('USD') }).optional(),
    vertex: budget.extend({
      table: z.string().regex(tablePattern, 'Expected project.dataset.table'),
      projectId: z.string().min(1).optional(),
      location: z.string().min(1).optional(),
      maximumBytesBilled: z.string().regex(/^[1-9][0-9]*$/).optional(),
    }).optional(),
  }).strict().refine(p => p.openai || p.vertex, 'Configure at least one provider'),
  webhook: z.object({
    type: z.enum(['slack', 'discord']),
    url: z.string().url().refine(s => new URL(s).protocol === 'https:', 'HTTPS required').optional(),
    urlEnv: z.string().min(1).optional(),
  }).strict().refine(w => Boolean(w.url) !== Boolean(w.urlEnv), 'Set exactly one of url or urlEnv').optional(),
}).strict();
export type Config = z.infer<typeof schema>;
export type Provider = 'openai' | 'vertex';
export function parseConfig(value: unknown): Config {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(`Invalid configuration: ${result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  return result.data;
}
export async function loadConfig(path?: string, cwd = process.cwd(), home = homedir()): Promise<Config> {
  const paths = path ? [resolve(cwd, path)] : [resolve(cwd, 'ai-cost.config.json'), resolve(home, '.ai-cost.json')];
  for (const file of paths) {
    let raw: string;
    try { raw = await readFile(file, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !path) continue;
      throw new Error(`Cannot read configuration: ${file}`);
    }
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new Error(`Invalid JSON in configuration: ${file}`); }
    return parseConfig(value);
  }
  throw new Error('Configuration not found. Create ./ai-cost.config.json or ~/.ai-cost.json.');
}
