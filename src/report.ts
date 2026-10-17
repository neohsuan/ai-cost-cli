import type { Config, Provider } from './config.js';
import type { Period } from './period.js';
import { openaiCost } from './providers/openai.js';
import { vertexCost } from './providers/vertex.js';

export interface UsageRow {
  provider: Provider; currency: string; cost: number; monthlyBudget: number;
  utilization: number; thresholds: number[]; exceededThresholds: number[];
}
export interface Report { month: string; start: string; end: string; providers: UsageRow[]; alerts: string[] }
export async function createReport(config: Config, period: Period, provider?: Provider): Promise<Report> {
  const names: Provider[] = provider ? [provider] : (['openai', 'vertex'] as const).filter(p => config.providers[p]);
  const providers = await Promise.all(names.map(async name => {
    const settings = config.providers[name];
    if (!settings) throw new Error(`Provider ${name} is not configured.`);
    const cost = name === 'openai' ? await openaiCost(period) : await vertexCost(config.providers.vertex!, period);
    const utilization = cost / settings.monthlyBudget;
    const thresholds = [...new Set(settings.thresholds)].sort((a, b) => a - b);
    return { provider: name, currency: settings.currency, cost, monthlyBudget: settings.monthlyBudget,
      utilization, thresholds, exceededThresholds: thresholds.filter(t => cost >= settings.monthlyBudget * t) };
  }));
  const alerts = providers.flatMap(p => p.exceededThresholds.map(t =>
    `ALERT ${p.provider}: ${p.currency} ${p.cost.toFixed(2)} / ${p.monthlyBudget.toFixed(2)} (${(p.utilization * 100).toFixed(1)}%), reached ${(t * 100).toFixed(1)}% threshold [${period.month}]`));
  return { month: period.month, start: period.start.toISOString(), end: period.end.toISOString(), providers, alerts };
}
export function formatTable(report: Report): string {
  const rows = [['Provider', 'Currency', 'Cost', 'Budget', 'Used', 'Reached thresholds'],
    ...report.providers.map(p => [p.provider, p.currency, p.cost.toFixed(2), p.monthlyBudget.toFixed(2),
      `${(p.utilization * 100).toFixed(1)}%`, p.exceededThresholds.map(t => `${t * 100}%`).join(', ') || '-'])];
  const widths = rows[0].map((_, i) => Math.max(...rows.map(r => r[i].length)));
  return `Month: ${report.month} (UTC, end exclusive: ${report.end})\n` + rows.map(r => r.map((v, i) => v.padEnd(widths[i])).join('  ').trimEnd()).join('\n');
}
