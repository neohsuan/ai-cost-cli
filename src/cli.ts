#!/usr/bin/env node
import { Command, InvalidArgumentError } from 'commander';
import { loadConfig, type Provider } from './config.js';
import { monthPeriod } from './period.js';
import { createReport, formatTable } from './report.js';
import { sendWebhook } from './webhook.js';

function choice<T extends string>(values: readonly T[]) {
  return (value: string): T => {
    if (!values.includes(value as T)) throw new InvalidArgumentError(`Expected ${values.join(' or ')}.`);
    return value as T;
  };
}
export function createProgram(): Command {
  const program = new Command().name('ai-cost-cli').description('Monthly OpenAI and Vertex AI costs and budget checks').version('1.0.0');
  for (const name of ['usage', 'check'] as const) {
    program.command(name)
      .description(name === 'usage' ? 'Show monthly costs' : 'Check budgets and send configured webhook alerts')
      .option('-c, --config <path>', 'Configuration file (overrides automatic discovery)')
      .option('-m, --month <YYYY-MM>', 'UTC usage month (default: current month to now)')
      .option('-p, --provider <provider>', 'Only one provider', choice(['openai', 'vertex'] as const))
      .option('-f, --format <format>', 'Output format', choice(['table', 'json'] as const), 'table')
      .option('--json', 'Output JSON (overrides --format)')
      .option('--no-webhook', 'Skip webhook delivery for check')
      .action(async (options: { config?: string; month?: string; provider?: Provider; format: string; json?: boolean; webhook: boolean }) => {
        try {
          const config = await loadConfig(options.config);
          const report = await createReport(config, monthPeriod(options.month), options.provider);
          const json = options.json || options.format === 'json';
          console.log(json ? JSON.stringify(report, null, 2) : formatTable(report));
          if (name === 'check' && report.alerts.length) {
            process.exitCode = 1;
            if (!json) console.log(report.alerts.join('\n'));
            if (config.webhook && options.webhook) await sendWebhook(config.webhook, report.alerts);
          }
        } catch (error) {
          console.error(`Error: ${error instanceof Error ? error.message : 'Unknown failure'}`);
          process.exitCode = 2;
        }
      });
  }
  return program;
}
