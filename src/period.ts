export interface Period { month: string; start: Date; end: Date }
export function monthPeriod(month?: string, now = new Date()): Period {
  const selected = month ?? now.toISOString().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(selected) || Number(selected.slice(0, 4)) < 1970) {
    throw new Error('Month must be YYYY-MM, year 1970 or later.');
  }
  const start = new Date(`${selected}-01T00:00:00.000Z`);
  if (start > now) throw new Error('Future months are not supported.');
  const next = new Date(start);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return { month: selected, start, end: new Date(Math.min(next.getTime(), Math.floor(now.getTime() / 1000) * 1000)) };
}
