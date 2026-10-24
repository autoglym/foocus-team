import * as XLSX from 'xlsx';
import prisma from '../db.js';

// Imports LinkedIn company page exports (Page → Analytics → Export).
// Supported today: the Content export ("Metrics" sheet: one row per day with
// impressions, clicks, reactions, comments, reposts). The file type is detected
// from its column headers, not its name.

export class LinkedinImportError extends Error {}

interface DailyRow {
  date: Date;
  impressions: number;
  impressionsSponsored: number;
  uniqueImpressions: number;
  clicks: number;
  reactions: number;
  comments: number;
  reposts: number;
}

const COLUMNS: Record<keyof Omit<DailyRow, 'date'>, string> = {
  impressions: 'impressions (total)',
  impressionsSponsored: 'impressions (sponsored)',
  uniqueImpressions: 'unique impressions (organic)',
  clicks: 'clicks (total)',
  reactions: 'reactions (total)',
  comments: 'comments (total)',
  reposts: 'reposts (total)',
};

/** LinkedIn writes dates as M/D/YYYY (UTC); also accept ISO YYYY-MM-DD. */
function parseDate(value: unknown): Date | null {
  if (value instanceof Date) return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  const text = String(value ?? '').trim();
  let m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2])));
  m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return null;
}

const toInt = (v: unknown) => {
  const n = Number(String(v ?? '0').replace(/[\s,]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : 0;
};

export function parseLinkedinContentExport(buffer: Buffer): DailyRow[] {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', dense: true });
  } catch {
    throw new LinkedinImportError('The file could not be read as an Excel or CSV file.');
  }

  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, raw: false, blankrows: false });
    // The header row is the first row whose first cell is "Date" (LinkedIn puts a description above it)
    const headerIndex = rows.findIndex((r) => String(r?.[0] ?? '').trim().toLowerCase() === 'date');
    if (headerIndex === -1) continue;
    const header = rows[headerIndex].map((h) => String(h ?? '').trim().toLowerCase());
    const col = Object.fromEntries(
      Object.entries(COLUMNS).map(([key, name]) => [key, header.indexOf(name)]),
    ) as Record<keyof typeof COLUMNS, number>;
    if (col.impressions === -1 || col.clicks === -1) continue;

    const out: DailyRow[] = [];
    for (const r of rows.slice(headerIndex + 1)) {
      const date = parseDate(r[0]);
      if (!date) continue;
      out.push({
        date,
        impressions: toInt(r[col.impressions]),
        impressionsSponsored: col.impressionsSponsored >= 0 ? toInt(r[col.impressionsSponsored]) : 0,
        uniqueImpressions: col.uniqueImpressions >= 0 ? toInt(r[col.uniqueImpressions]) : 0,
        clicks: toInt(r[col.clicks]),
        reactions: col.reactions >= 0 ? toInt(r[col.reactions]) : 0,
        comments: col.comments >= 0 ? toInt(r[col.comments]) : 0,
        reposts: col.reposts >= 0 ? toInt(r[col.reposts]) : 0,
      });
    }
    if (out.length > 0) return out;
  }

  throw new LinkedinImportError(
    'This doesn’t look like a LinkedIn Content export. In LinkedIn, open the page’s Analytics → Content and choose Export.',
  );
}

export async function importLinkedinContent(buffer: Buffer) {
  const rows = parseLinkedinContentExport(buffer);
  const importedAt = new Date();
  await prisma.$transaction(
    rows.map((r) =>
      prisma.linkedinDailyMetric.upsert({
        where: { date: r.date },
        create: { ...r, importedAt },
        update: { ...r, importedAt },
      }),
    ),
  );
  const dates = rows.map((r) => r.date.getTime());
  return {
    days: rows.length,
    from: new Date(Math.min(...dates)),
    to: new Date(Math.max(...dates)),
  };
}

type Totals = { impressions: number; clicks: number; reactions: number; comments: number; reposts: number; engagementRate: number | null };

function totals(rows: Array<Omit<DailyRow, 'date'>>): Totals {
  const t = rows.reduce(
    (acc, r) => ({
      impressions: acc.impressions + r.impressions,
      clicks: acc.clicks + r.clicks,
      reactions: acc.reactions + r.reactions,
      comments: acc.comments + r.comments,
      reposts: acc.reposts + r.reposts,
    }),
    { impressions: 0, clicks: 0, reactions: 0, comments: 0, reposts: 0 },
  );
  const engagements = t.clicks + t.reactions + t.comments + t.reposts;
  return { ...t, engagementRate: t.impressions > 0 ? engagements / t.impressions : null };
}

/** Summary for the dashboard, anchored on the latest imported day (LinkedIn data lags ~2 days). */
export async function linkedinSummary() {
  const latest = await prisma.linkedinDailyMetric.findFirst({ orderBy: { date: 'desc' } });
  if (!latest) return { hasData: false as const };

  const day = 24 * 60 * 60 * 1000;
  const end = latest.date.getTime();
  const since = new Date(end - 365 * day);
  const rows = await prisma.linkedinDailyMetric.findMany({ where: { date: { gt: since } }, orderBy: { date: 'asc' } });

  const inWindow = (fromDaysAgo: number, toDaysAgo: number) =>
    rows.filter((r) => {
      const t = r.date.getTime();
      return t > end - fromDaysAgo * day && t <= end - toDaysAgo * day;
    });

  const byMonth = new Map<string, Omit<DailyRow, 'date'>[]>();
  for (const r of rows) {
    const key = r.date.toISOString().slice(0, 7);
    byMonth.set(key, [...(byMonth.get(key) ?? []), r]);
  }

  return {
    hasData: true as const,
    lastImportAt: latest.importedAt,
    latestDate: latest.date,
    firstDate: rows[0]?.date ?? latest.date,
    last30: totals(inWindow(30, 0)),
    previous30: totals(inWindow(60, 30)),
    daily: rows.slice(-90).map((r) => ({ date: r.date.toISOString().slice(0, 10), impressions: r.impressions })),
    monthly: [...byMonth.entries()].slice(-12).map(([month, list]) => ({ month, ...totals(list) })),
  };
}
