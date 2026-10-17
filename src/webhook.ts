import type { Config } from './config.js';
export async function sendWebhook(config: NonNullable<Config['webhook']>, alerts: string[]): Promise<void> {
  if (!alerts.length) return;
  const url = config.url ?? process.env[config.urlEnv!];
  try { if (!url || new URL(url).protocol !== 'https:') throw new Error(); }
  catch { throw new Error('Webhook requires an HTTPS URL; check its configured environment variable.'); }
  const text = alerts.join('\n');
  // Bound payloads for Discord's 2000-character message limit.
  const chunks = text.match(/[\s\S]{1,1900}/g) ?? [];
  for (const chunk of chunks) {
    let response: Response;
    try {
      response = await fetch(url!, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config.type === 'slack' ? { text: chunk } : { content: chunk, allowed_mentions: { parse: [] } }),
        signal: AbortSignal.timeout(15_000), redirect: 'error',
      });
    } catch { throw new Error('Webhook delivery failed (network or timeout).'); }
    if (!response.ok) throw new Error(`Webhook delivery failed: HTTP ${response.status}.`);
  }
}
