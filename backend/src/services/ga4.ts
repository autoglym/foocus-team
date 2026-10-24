import fs from 'fs';
import { GoogleAuth } from 'google-auth-library';

// Google Analytics 4 (Data API) for the dashboard: website users, sessions and
// page views for the last 30 days vs the 30 days before, plus a daily series.
// Credentials: a service account with Viewer access on the GA4 property, given as
// GA4_CREDENTIALS_JSON (the key file's JSON, e.g. on Render) or GA4_CREDENTIALS_FILE.

const PROPERTY_ID = process.env.GA4_PROPERTY_ID?.trim();

function loadCredentials(): Record<string, unknown> | null {
  try {
    if (process.env.GA4_CREDENTIALS_JSON) return JSON.parse(process.env.GA4_CREDENTIALS_JSON);
    const file = process.env.GA4_CREDENTIALS_FILE;
    if (file && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // Invalid JSON: treated as not configured
  }
  return null;
}

const credentials = PROPERTY_ID ? loadCredentials() : null;
const auth = credentials
  ? new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/analytics.readonly'] })
  : null;

export const isGa4Configured = Boolean(PROPERTY_ID && auth);

const METRICS = [
  { name: 'activeUsers', key: 'ga4_users', label: 'Website users' },
  { name: 'sessions', key: 'ga4_sessions', label: 'Sessions' },
  { name: 'screenPageViews', key: 'ga4_pageviews', label: 'Page views' },
] as const;

export interface Ga4Metric {
  key: string;
  label: string;
  current: number;
  previous: number;
  history: Array<{ date: string; value: number }>;
}

export interface Ga4Breakdown {
  /** Sessions per default channel group (Organic Search, Direct, Organic Social, …) */
  channels: Array<{ name: string; sessions: number }>;
  /** Top source / medium pairs (google / organic, linkedin.com / referral, …) */
  sources: Array<{ name: string; sessions: number }>;
  /** Most viewed pages */
  topPages: Array<{ path: string; title: string; views: number; users: number }>;
}

export interface Ga4Result extends Ga4Breakdown {
  metrics: Ga4Metric[];
  fetchedAt: Date;
}

const CACHE_MS = 60 * 60 * 1000;
let cache: { at: number; result: Omit<Ga4Result, 'fetchedAt'> } | null = null;

async function runReport(body: Record<string, unknown>) {
  const client = await auth!.getClient();
  const res = await client.request<{ rows?: Array<{ dimensionValues?: Array<{ value: string }>; metricValues: Array<{ value: string }> }> }>({
    url: `https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY_ID}:runReport`,
    method: 'POST',
    data: body,
    timeout: 10_000,
  });
  return res.data.rows ?? [];
}

/** Last 30 days vs the 30 days before (excluding today, which is incomplete). */
export async function fetchGa4(): Promise<Ga4Result> {
  if (!isGa4Configured) throw new Error('Google Analytics is not configured');
  if (cache && Date.now() - cache.at < CACHE_MS) return { ...cache.result, fetchedAt: new Date(cache.at) };

  const metricList = METRICS.map((m) => ({ name: m.name }));
  const last30 = [{ startDate: '30daysAgo', endDate: 'yesterday' }];
  const [totals, daily, channelRows, sourceRows, pageRows] = await Promise.all([
    runReport({
      dateRanges: [
        { startDate: '30daysAgo', endDate: 'yesterday', name: 'current' },
        { startDate: '60daysAgo', endDate: '31daysAgo', name: 'previous' },
      ],
      metrics: metricList,
    }),
    runReport({
      dateRanges: [{ startDate: '90daysAgo', endDate: 'yesterday' }],
      dimensions: [{ name: 'date' }],
      metrics: metricList,
      orderBys: [{ dimension: { dimensionName: 'date' } }],
      limit: 100,
    }),
    runReport({
      dateRanges: last30,
      dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      metrics: [{ name: 'sessions' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 10,
    }),
    runReport({
      dateRanges: last30,
      dimensions: [{ name: 'sessionSourceMedium' }],
      metrics: [{ name: 'sessions' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 8,
    }),
    runReport({
      dateRanges: last30,
      dimensions: [{ name: 'pagePath' }, { name: 'pageTitle' }],
      metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }],
      orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
      limit: 10,
    }),
  ]);

  const dim = (r: (typeof channelRows)[number], i = 0) => r.dimensionValues?.[i]?.value ?? '';
  const met = (r: (typeof channelRows)[number], i = 0) => Number(r.metricValues[i]?.value ?? 0);
  const breakdown: Ga4Breakdown = {
    channels: channelRows.map((r) => ({ name: dim(r) || '(other)', sessions: met(r) })),
    sources: sourceRows.map((r) => ({ name: dim(r) || '(not set)', sessions: met(r) })),
    topPages: pageRows.map((r) => ({ path: dim(r, 0), title: dim(r, 1), views: met(r, 0), users: met(r, 1) })),
  };

  // With two date ranges, each row carries a dateRange dimension value
  const rangeValue = (range: string, i: number) => {
    const row = totals.find((r) => r.dimensionValues?.some((d) => d.value === range)) ?? (range === 'current' ? totals[0] : undefined);
    return Number(row?.metricValues[i]?.value ?? 0);
  };

  const metrics = METRICS.map((m, i) => ({
    key: m.key,
    label: m.label,
    current: rangeValue('current', i),
    previous: rangeValue('previous', i),
    history: daily.map((r) => {
      const d = r.dimensionValues?.[0]?.value ?? '';
      return { date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, value: Number(r.metricValues[i]?.value ?? 0) };
    }),
  }));

  cache = { at: Date.now(), result: { metrics, ...breakdown } };
  return { metrics, ...breakdown, fetchedAt: new Date(cache.at) };
}
