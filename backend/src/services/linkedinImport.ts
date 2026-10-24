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

// ── Personal profiles (creator analytics export) ─────────────────────

const sheetRows = (workbook: XLSX.WorkBook, name: string) => {
  const sheetName = workbook.SheetNames.find((n) => n.trim().toUpperCase() === name);
  return sheetName
    ? XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, raw: false, blankrows: false })
    : null;
};

const cell = (row: unknown[] | undefined, i: number) => String(row?.[i] ?? '').trim();

/** "AggregateAnalytics_Glenn Myklebust_2026-10-18_2026-10-24 (1).xlsx" → "Glenn Myklebust" */
export function profileNameFromFilename(filename: string): string | null {
  const m = filename.match(/^AggregateAnalytics_(.+?)_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}/);
  return m ? m[1].trim().slice(0, 120) : null;
}

export interface ProfileExport {
  daily: Map<string, { date: Date; impressions?: number; engagements?: number; newFollowers?: number }>;
  followers: { total: number; date: Date } | null;
  posts: Map<string, { url: string; publishedAt: Date | null; impressions?: number; engagements?: number }>;
  demographics: Array<{ category: string; value: string; percentage: string }>;
}

export function isProfileExport(workbook: XLSX.WorkBook) {
  const names = workbook.SheetNames.map((n) => n.trim().toUpperCase());
  return names.includes('ENGAGEMENT') && names.includes('FOLLOWERS');
}

export function parseLinkedinProfileExport(workbook: XLSX.WorkBook): ProfileExport {
  const out: ProfileExport = { daily: new Map(), followers: null, posts: new Map(), demographics: [] };
  const day = (date: Date) => date.toISOString().slice(0, 10);
  const upsertDay = (date: Date, patch: { impressions?: number; engagements?: number; newFollowers?: number }) => {
    const key = day(date);
    out.daily.set(key, { ...(out.daily.get(key) ?? { date }), ...patch });
  };

  // ENGAGEMENT: Date | Impressions | Engagements
  const engagement = sheetRows(workbook, 'ENGAGEMENT') ?? [];
  const eHeader = engagement.findIndex((r) => cell(r, 0).toLowerCase() === 'date');
  for (const r of engagement.slice(eHeader + 1)) {
    const date = parseDate(r[0]);
    if (date) upsertDay(date, { impressions: toInt(r[1]), engagements: toInt(r[2]) });
  }

  // FOLLOWERS: "Total followers on M/D/YYYY" | total, then Date | New followers
  const followers = sheetRows(workbook, 'FOLLOWERS') ?? [];
  const totalMatch = cell(followers[0], 0).match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
  const totalDate = totalMatch ? parseDate(totalMatch[1]) : null;
  if (totalDate) out.followers = { total: toInt(followers[0]?.[1]), date: totalDate };
  const fHeader = followers.findIndex((r) => cell(r, 0).toLowerCase() === 'date');
  if (fHeader >= 0) {
    for (const r of followers.slice(fHeader + 1)) {
      const date = parseDate(r[0]);
      if (date) upsertDay(date, { newFollowers: toInt(r[1]) });
    }
  }

  // TOP POSTS: two side-by-side tables, by engagements (cols 0–2) and by impressions (cols 4–6)
  const posts = sheetRows(workbook, 'TOP POSTS') ?? [];
  const pHeader = posts.findIndex((r) => cell(r, 0).toLowerCase() === 'post url' || cell(r, 4).toLowerCase() === 'post url');
  if (pHeader >= 0) {
    const addPost = (url: string, date: unknown, patch: { impressions?: number; engagements?: number }) => {
      if (!/^https:\/\/(www\.)?linkedin\.com\//.test(url)) return;
      const existing = out.posts.get(url) ?? { url: url.slice(0, 500), publishedAt: parseDate(date) };
      out.posts.set(url, { ...existing, ...patch });
    };
    for (const r of posts.slice(pHeader + 1)) {
      if (cell(r, 0)) addPost(cell(r, 0), r[1], { engagements: toInt(r[2]) });
      if (cell(r, 4)) addPost(cell(r, 4), r[5], { impressions: toInt(r[6]) });
    }
  }

  // AUDIENCE DEMOGRAPHICS: Category | Value | Percentage
  const demo = sheetRows(workbook, 'AUDIENCE DEMOGRAPHICS') ?? [];
  for (const r of demo.slice(1)) {
    const category = cell(r, 0), value = cell(r, 1), percentage = cell(r, 2);
    if (category && value) out.demographics.push({ category: category.slice(0, 40), value: value.slice(0, 200), percentage: percentage.slice(0, 10) });
  }

  if (out.daily.size === 0 && !out.followers) {
    throw new LinkedinImportError('The profile export contained no daily numbers.');
  }
  return out;
}

async function importProfile(workbook: XLSX.WorkBook, filename: string) {
  const name = profileNameFromFilename(filename);
  if (!name) {
    throw new LinkedinImportError('Keep LinkedIn’s file name (AggregateAnalytics_<name>_…) so we know whose profile it is.');
  }
  const data = parseLinkedinProfileExport(workbook);

  const existing = await prisma.linkedinProfile.findUnique({ where: { name } });
  const newerFollowers = data.followers && (!existing?.followersAt || data.followers.date >= existing.followersAt);
  const profile = await prisma.linkedinProfile.upsert({
    where: { name },
    create: { name, followers: data.followers?.total ?? null, followersAt: data.followers?.date ?? null },
    update: {
      importedAt: new Date(),
      ...(newerFollowers ? { followers: data.followers!.total, followersAt: data.followers!.date } : {}),
    },
  });

  await prisma.$transaction([
    ...[...data.daily.values()].map((d) =>
      prisma.linkedinProfileDaily.upsert({
        where: { profileId_date: { profileId: profile.id, date: d.date } },
        create: { profileId: profile.id, ...d },
        update: { impressions: d.impressions, engagements: d.engagements, newFollowers: d.newFollowers },
      }),
    ),
    ...[...data.posts.values()].map((p) =>
      prisma.linkedinProfilePost.upsert({
        where: { profileId_url: { profileId: profile.id, url: p.url } },
        create: { profileId: profile.id, ...p },
        update: {
          publishedAt: p.publishedAt,
          ...(p.impressions !== undefined ? { impressions: p.impressions } : {}),
          ...(p.engagements !== undefined ? { engagements: p.engagements } : {}),
        },
      }),
    ),
    ...(data.demographics.length > 0
      ? [
          prisma.linkedinProfileDemographic.deleteMany({ where: { profileId: profile.id } }),
          prisma.linkedinProfileDemographic.createMany({
            data: data.demographics.map((d, i) => ({ profileId: profile.id, ...d, sortOrder: i })),
          }),
        ]
      : []),
  ]);

  const dates = [...data.daily.values()].map((d) => d.date.getTime());
  return {
    kind: 'profile' as const,
    name,
    days: dates.length,
    from: dates.length ? new Date(Math.min(...dates)) : null,
    to: dates.length ? new Date(Math.max(...dates)) : null,
    posts: data.posts.size,
  };
}

/** Detects the export type (company page Content export or personal profile) and imports it. */
export async function importLinkedinFile(buffer: Buffer, filename: string) {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', dense: true });
  } catch {
    throw new LinkedinImportError('The file could not be read as an Excel or CSV file.');
  }
  if (isProfileExport(workbook)) return importProfile(workbook, filename);
  return { kind: 'company' as const, ...(await importLinkedinContent(buffer)) };
}

/** "…/posts/glennmyklebust_my-phone-was-dead-this-morning-so-i-ended-share-74968…" → "My phone was dead this morning so I ended…" */
export function postTitleFromUrl(url: string): string {
  const slug = url.match(/\/posts\/[^_]+_(.+?)-(?:share|ugcPost|activity)-\d+/)?.[1];
  if (!slug) return 'LinkedIn post';
  const words = slug.replace(/-/g, ' ').replace(/\bi\b/g, 'I');
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}…`;
}

export async function linkedinProfilesSummary() {
  const profiles = await prisma.linkedinProfile.findMany({
    orderBy: { name: 'asc' },
    include: {
      days: { orderBy: { date: 'asc' } },
      posts: true,
      demographics: { orderBy: { sortOrder: 'asc' } },
    },
  });
  const dayMs = 24 * 60 * 60 * 1000;
  return profiles.map((p) => {
    const latest = p.days[p.days.length - 1]?.date.getTime() ?? Date.now();
    const sum = (fromDaysAgo: number, toDaysAgo: number, key: 'impressions' | 'engagements' | 'newFollowers') =>
      p.days
        .filter((d) => d.date.getTime() > latest - fromDaysAgo * dayMs && d.date.getTime() <= latest - toDaysAgo * dayMs)
        .reduce((s, d) => s + (d[key] ?? 0), 0);
    const covered = (fromDaysAgo: number, toDaysAgo: number) =>
      p.days.some((d) => d.date.getTime() > latest - fromDaysAgo * dayMs && d.date.getTime() <= latest - toDaysAgo * dayMs);

    const demographics: Record<string, Array<{ value: string; percentage: string }>> = {};
    for (const d of p.demographics) (demographics[d.category] ??= []).push({ value: d.value, percentage: d.percentage });

    return {
      name: p.name,
      importedAt: p.importedAt,
      followers: p.followers,
      followersAt: p.followersAt,
      firstDate: p.days[0]?.date ?? null,
      latestDate: p.days[p.days.length - 1]?.date ?? null,
      daysCovered: p.days.length,
      last30: { impressions: sum(30, 0, 'impressions'), engagements: sum(30, 0, 'engagements'), newFollowers: sum(30, 0, 'newFollowers') },
      previous30: covered(60, 30)
        ? { impressions: sum(60, 30, 'impressions'), engagements: sum(60, 30, 'engagements'), newFollowers: sum(60, 30, 'newFollowers') }
        : null,
      daily: p.days.slice(-90).map((d) => ({ date: d.date.toISOString().slice(0, 10), impressions: d.impressions ?? 0 })),
      topPosts: [...p.posts]
        .sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0) || (b.engagements ?? 0) - (a.engagements ?? 0))
        .slice(0, 5)
        .map((post) => ({ url: post.url, title: postTitleFromUrl(post.url), publishedAt: post.publishedAt, impressions: post.impressions, engagements: post.engagements })),
      demographics,
    };
  });
}
