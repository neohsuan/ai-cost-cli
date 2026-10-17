import { BigQuery } from '@google-cloud/bigquery';
import { tablePattern, type Config } from '../config.js';
import type { Period } from '../period.js';

type VertexConfig = NonNullable<Config['providers']['vertex']>;
export async function vertexCost(config: VertexConfig, period: Period): Promise<number> {
  if (!tablePattern.test(config.table)) throw new Error('Invalid BigQuery table name.');
  const client = new BigQuery({ projectId: config.projectId });
  let rows: Record<string, unknown>[];
  try {
    [rows] = await client.query({
      query: `SELECT currency,
        SUM(cost + IFNULL((SELECT SUM(credit.amount) FROM UNNEST(credits) AS credit), 0)) AS total
        FROM \`${config.table}\`
        WHERE service.description = @service
          AND usage_start_time >= TIMESTAMP(@start)
          AND usage_start_time < TIMESTAMP(@end)
        GROUP BY currency`,
      params: { service: 'Vertex AI', start: period.start.toISOString(), end: period.end.toISOString() },
      useLegacySql: false,
      location: config.location,
      maximumBytesBilled: config.maximumBytesBilled,
      jobTimeoutMs: 60_000,
    });
  } catch { throw new Error('Vertex AI BigQuery query failed. Check ADC credentials, IAM, table, location, and query limits.'); }
  let total = 0;
  for (const row of rows) {
    if (typeof row.currency !== 'string' || row.currency.toUpperCase() !== config.currency) {
      throw new Error(`Vertex AI billing currency does not match configured ${config.currency}. No currency conversion is performed.`);
    }
    if ((typeof row.total !== 'number' && typeof row.total !== 'string') || String(row.total).trim() === '' || !Number.isFinite(Number(row.total))) {
      throw new Error('Vertex AI BigQuery returned an invalid cost.');
    }
    total += Number(row.total);
  }
  if (!Number.isFinite(total)) throw new Error('Vertex AI cost total is not finite.');
  return total;
}
