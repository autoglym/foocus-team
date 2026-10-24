import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { ArrowDownRight, ArrowUpRight, Minus, MoreHorizontal, Pencil, Plus, Trash2, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { request } from '@/lib/api';

type Unit = 'count' | 'NOK' | 'percent';

interface Point { id: number; value: number; capturedAt: string }
interface Metric {
  id: number;
  key: string;
  label: string;
  unit: Unit;
  source: 'crm' | 'manual' | 'ga4' | 'linkedin';
  /** Overrides "vs <date>" in the change line, e.g. "vs previous 30 days" */
  compareLabel?: string;
  current: number | null;
  updatedAt: string | null;
  previous: { value: number; capturedAt: string } | null;
  trackingSince: string | null;
  history: Point[];
}
interface StageRow { stage: string; deals: number; total: number; weighted: number }
interface Ga4Metric { key: string; label: string; current: number; previous: number; history: Array<{ date: string; value: number }> }
interface LiTotals { impressions: number; clicks: number; reactions: number; comments: number; reposts: number; engagementRate: number | null }
interface LinkedinProfileSummary {
  name: string; importedAt: string; followers: number | null; followersAt: string | null;
  firstDate: string | null; latestDate: string | null; daysCovered: number;
  last30: { impressions: number; engagements: number; newFollowers: number };
  previous30: { impressions: number; engagements: number; newFollowers: number } | null;
  daily: Array<{ date: string; impressions: number }>;
  topPosts: Array<{ url: string; title: string; publishedAt: string | null; impressions: number | null; engagements: number | null }>;
  demographics: Record<string, Array<{ value: string; percentage: string }>>;
}
type LinkedinSummary = { profiles: LinkedinProfileSummary[] } & (
  | { hasData: false }
  | {
      hasData: true; lastImportAt: string; latestDate: string; firstDate: string;
      last30: LiTotals; previous30: LiTotals;
      daily: Array<{ date: string; impressions: number }>;
      monthly: Array<LiTotals & { month: string }>;
    }
);
interface Dashboard {
  linkedin: LinkedinSummary;
  crm: { configured: boolean; ok: boolean; error?: string; fetchedAt?: string; pipelineByStage?: StageRow[] };
  ga4: {
    configured: boolean; ok: boolean; error?: string; fetchedAt?: string; metrics?: Ga4Metric[];
    channels?: Array<{ name: string; sessions: number }>;
    sources?: Array<{ name: string; sessions: number }>;
    topPages?: Array<{ path: string; title: string; views: number; users: number }>;
  };
  metrics: Metric[];
}

const nok = new Intl.NumberFormat('nb-NO', { style: 'currency', currency: 'NOK', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 1 });

function formatValue(value: number, unit: Unit) {
  if (unit === 'NOK') return nok.format(value);
  if (unit === 'percent') return `${num.format(value)} %`;
  return num.format(value);
}

const STAGE_ORDER = ['lead', 'qualified', 'meeting', 'proposal', 'negotiation', 'near_closing'];
const stageLabel = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await request<Dashboard>('/kpi/dashboard'));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the dashboard');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const crmMetrics = data?.metrics.filter((m) => m.source === 'crm') ?? [];
  const manualMetrics = data?.metrics.filter((m) => m.source === 'manual') ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slack-surface" data-testid="dashboard">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-1 px-6 pb-2 pt-5">
        <h1 className="font-heading text-[22px] font-bold tracking-tight text-slack-primary">Dashboard</h1>
        <p className="pb-0.5 text-[13px] text-slack-hint">
          Commercial KPIs · visible to owners and admins
          {data?.crm.ok && data.crm.fetchedAt && <> · CRM updated {formatDistanceToNow(new Date(data.crm.fetchedAt), { addSuffix: true })}</>}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-10">
        {error && <p className="mb-3 rounded-xl bg-slack-error-bg px-3 py-2 text-[13px] text-slack-error" role="alert">{error}</p>}
        {data && !data.crm.configured && (
          <p className="mb-4 rounded-2xl neu-inset-sm px-4 py-3 text-[13px] text-slack-secondary">
            The CRM isn’t connected on this server (RONJA_KPI_DATABASE_URL is not set), so only manual numbers are shown.
          </p>
        )}
        {data?.crm.error && (
          <p className="mb-4 rounded-2xl neu-inset-sm px-4 py-3 text-[13px] text-slack-secondary" role="status">{data.crm.error}</p>
        )}
        {!data && !error && <p className="py-6 text-[14px] text-slack-hint">Loading…</p>}

        {data && (
          <>
            {crmMetrics.length > 0 && (
              <section aria-labelledby="crm-heading" className="mt-3">
                <h2 id="crm-heading" className="mb-3 text-[13px] font-medium text-slack-secondary">From the CRM</h2>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-5">
                  {crmMetrics.map((m, i) => <MetricTile key={m.id} metric={m} hero={i < 3} onChanged={load} />)}
                </div>
              </section>
            )}

            {data.crm.pipelineByStage && data.crm.pipelineByStage.length > 0 && (
              <PipelineByStage rows={data.crm.pipelineByStage} />
            )}

            {data.ga4.configured && (
              <section aria-labelledby="web-heading" className="mt-8">
                <h2 id="web-heading" className="mb-3 text-[13px] font-medium text-slack-secondary">
                  Website · Google Analytics, last 30 days
                </h2>
                {data.ga4.error && <p className="mb-3 rounded-2xl neu-inset-sm px-4 py-3 text-[13px] text-slack-secondary" role="status">{data.ga4.error}</p>}
                {data.ga4.ok && data.ga4.metrics?.every((m) => m.current === 0) && (
                  <p className="mb-3 rounded-2xl neu-inset-sm px-4 py-3 text-[13px] text-slack-secondary" role="status">
                    Google Analytics has received no visits from the website in the last 30 days. The tracking code on the site may be missing or blocked by a consent banner.
                  </p>
                )}
                <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-5">
                  {data.ga4.metrics?.map((g, i) => (
                    <MetricTile key={g.key} metric={ga4ToMetric(g, i)} onChanged={load} />
                  ))}
                </div>
                {data.ga4.ok && (
                  <div className="mt-5 grid gap-5 lg:grid-cols-2">
                    <TrafficSources channels={data.ga4.channels ?? []} sources={data.ga4.sources ?? []} />
                    <TopPages pages={data.ga4.topPages ?? []} />
                  </div>
                )}
              </section>
            )}

            <LinkedinSection summary={data.linkedin} onImported={load} />

            <section aria-labelledby="manual-heading" className="mt-8">
              <div className="mb-3 flex items-center gap-3">
                <h2 id="manual-heading" className="text-[13px] font-medium text-slack-secondary">Updated by hand</h2>
                {!adding && (
                  <Button variant="ghost" size="sm" onClick={() => setAdding(true)} data-testid="add-metric">
                    <Plus className="mr-1 h-4 w-4" /> Add metric
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-5">
                {manualMetrics.map((m) => <MetricTile key={m.id} metric={m} onChanged={load} />)}
                {adding && <NewMetricTile onDone={async () => { setAdding(false); await load(); }} onCancel={() => setAdding(false)} />}
                {manualMetrics.length === 0 && !adding && (
                  <p className="col-span-full rounded-[24px] neu-inset px-5 py-6 text-[14px] text-slack-secondary">
                    Add numbers that don’t come from the CRM, like LinkedIn followers or website visitors, and update them weekly.
                  </p>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function ga4ToMetric(g: Ga4Metric, i: number): Metric {
  const last = g.history[g.history.length - 1]?.date ?? null;
  return {
    id: -(i + 1),
    key: g.key,
    label: g.label,
    unit: 'count',
    source: 'ga4',
    current: g.current,
    updatedAt: last,
    previous: { value: g.previous, capturedAt: last ?? new Date().toISOString() },
    compareLabel: 'vs previous 30 days',
    trackingSince: g.history[0]?.date ?? null,
    history: g.history.map((h, j) => ({ id: j, value: h.value, capturedAt: h.date })),
  };
}

function Delta({ metric }: { metric: Metric }) {
  if (metric.current === null) return null;
  if (!metric.previous) {
    return (
      <p className="text-[12px] text-slack-hint">
        {metric.trackingSince ? `Tracking since ${format(new Date(metric.trackingSince), 'd MMM yyyy')}` : 'No history yet'}
      </p>
    );
  }
  const diff = metric.current - metric.previous.value;
  const pct = metric.previous.value !== 0 ? (diff / Math.abs(metric.previous.value)) * 100 : null;
  const Icon = diff > 0 ? ArrowUpRight : diff < 0 ? ArrowDownRight : Minus;
  const tone = diff > 0 ? 'text-[#1F8854]' : diff < 0 ? 'text-slack-error' : 'text-slack-hint';
  const sign = diff > 0 ? '+' : diff < 0 ? '−' : '';
  return (
    <p className="flex items-center gap-1 text-[12px] text-slack-secondary">
      <Icon className={cn('h-3.5 w-3.5', tone)} aria-hidden />
      <span className={cn('font-medium', tone)}>
        {sign}{formatValue(Math.abs(diff), metric.unit)}{pct !== null && ` (${sign}${num.format(Math.abs(pct))} %)`}
      </span>
      <span className="text-slack-hint">{metric.compareLabel ?? `vs ${format(new Date(metric.previous.capturedAt), 'd MMM')}`}</span>
    </p>
  );
}

function MetricTile({ metric, hero, onChanged }: { metric: Metric; hero?: boolean; onChanged: () => Promise<void> }) {
  const [updating, setUpdating] = useState(false);
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);

  return (
    <article className="relative flex flex-col rounded-[24px] neu-raised px-5 pb-4 pt-4" data-testid="kpi-tile">
      <div className="flex items-start gap-2">
        {renaming ? (
          <form className="flex-1" onSubmit={async (e) => {
            e.preventDefault();
            const label = String(new FormData(e.currentTarget).get('label') ?? '').trim();
            if (label) await request(`/kpi/metrics/${metric.id}`, { method: 'PATCH', body: JSON.stringify({ label }) });
            setRenaming(false);
            await onChanged();
          }}>
            <input name="label" defaultValue={metric.label} autoFocus aria-label="Metric name" onBlur={(e) => e.currentTarget.form?.requestSubmit()}
              className="w-full rounded-lg neu-inset-sm px-2 py-0.5 text-[13px] outline-none" />
          </form>
        ) : (
          <h3 className="flex-1 text-[13px] font-medium text-slack-secondary">{metric.label}</h3>
        )}
        {metric.source === 'manual' && (
          <Button variant="toolbar" size="icon-xs" aria-label="Metric actions" onClick={() => setMenu(!menu)}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        )}
      </div>
      {menu && (
        <div className="absolute right-4 top-10 z-20 w-[210px] rounded-2xl neu-raised p-1.5" role="menu">
          <button role="menuitem" className="flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-[14px] hover:neu-raised-sm"
            onClick={() => { setMenu(false); setRenaming(true); }}>
            <Pencil className="h-4 w-4" /> Rename
          </button>
          {metric.history.length > 0 && (
            <button role="menuitem" className="flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-[14px] hover:neu-raised-sm"
              onClick={async () => {
                setMenu(false);
                const last = metric.history[metric.history.length - 1];
                if (!window.confirm(`Remove ${formatValue(last.value, metric.unit)} from ${format(new Date(last.capturedAt), 'd MMM yyyy')}?`)) return;
                await request(`/kpi/values/${last.id}`, { method: 'DELETE' });
                await onChanged();
              }}>
              <Undo2 className="h-4 w-4" /> Remove latest value
            </button>
          )}
          <button role="menuitem" className="flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-[14px] text-slack-error hover:neu-raised-sm"
            onClick={async () => {
              setMenu(false);
              if (!window.confirm(`Delete “${metric.label}” and its history?`)) return;
              await request(`/kpi/metrics/${metric.id}`, { method: 'DELETE' });
              await onChanged();
            }}>
            <Trash2 className="h-4 w-4" /> Delete
          </button>
        </div>
      )}

      <p className={cn('mt-1 font-heading font-bold tabular-nums tracking-tight text-slack-primary', hero ? 'text-[30px]' : 'text-[26px]')}>
        {metric.current === null ? '—' : formatValue(metric.current, metric.unit)}
      </p>
      <Delta metric={metric} />

      <div className={cn('mt-auto', (updating || metric.history.length >= 2 || metric.source === 'manual') && 'pt-3')}>
        {updating ? (
          <UpdateValueForm metric={metric} onDone={async () => { setUpdating(false); await onChanged(); }} onCancel={() => setUpdating(false)} />
        ) : (
          <div className="flex items-end gap-3">
            <Sparkline points={metric.history} unit={metric.unit} label={metric.label} />
            {metric.source === 'manual' && (
              <Button size="sm" variant="ghost" onClick={() => setUpdating(true)} className="flex-shrink-0">Update</Button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function UpdateValueForm({ metric, onDone, onCancel }: { metric: Metric; onDone: () => Promise<void>; onCancel: () => void }) {
  // Start empty (previous value as placeholder) so typing never appends to the old number
  const [value, setValue] = useState('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [error, setError] = useState('');
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const parsed = Number(value.replace(/\s/g, '').replace(',', '.'));
        if (!value.trim() || !Number.isFinite(parsed)) return setError('Enter a number');
        try {
          await request(`/kpi/metrics/${metric.id}/values`, { method: 'POST', body: JSON.stringify({ value: parsed, capturedAt: date }) });
          await onDone();
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Could not save');
        }
      }}
    >
      <div className="flex gap-2">
        <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" autoFocus aria-label={`New value for ${metric.label}`}
          placeholder={metric.current !== null ? `Last: ${num.format(metric.current)}` : 'Value'}
          className="min-w-0 flex-1 rounded-xl neu-inset-sm px-3 py-1.5 text-[14px] tabular-nums outline-none focus:ring-2 focus:ring-slack-btn/40" />
        <input type="date" value={date} max={format(new Date(), 'yyyy-MM-dd')} onChange={(e) => setDate(e.target.value)} aria-label="Date"
          className="w-[132px] rounded-xl neu-inset-sm px-2 py-1.5 text-[13px] outline-none" />
      </div>
      {error && <p className="text-[12px] text-slack-error">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" type="button" onClick={onCancel}>Cancel</Button>
        <Button size="sm" type="submit">Save</Button>
      </div>
    </form>
  );
}

function NewMetricTile({ onDone, onCancel }: { onDone: () => Promise<void>; onCancel: () => void }) {
  const [label, setLabel] = useState('');
  const [unit, setUnit] = useState<Unit>('count');
  const [error, setError] = useState('');
  return (
    <form
      className="flex flex-col gap-3 rounded-[24px] neu-inset px-5 py-4"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await request('/kpi/metrics', { method: 'POST', body: JSON.stringify({ label: label.trim(), unit }) });
          await onDone();
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Could not add the metric');
        }
      }}
    >
      <input value={label} onChange={(e) => setLabel(e.target.value.slice(0, 80))} autoFocus placeholder="e.g. LinkedIn followers" aria-label="Metric name"
        className="rounded-xl neu-raised-sm px-3 py-2 text-[14px] outline-none focus:ring-2 focus:ring-slack-btn/40" />
      <div className="flex gap-1 rounded-full neu-inset-sm p-1" role="radiogroup" aria-label="Unit">
        {([['count', 'Number'], ['NOK', 'NOK'], ['percent', '%']] as const).map(([u, l]) => (
          <button key={u} type="button" role="radio" aria-checked={unit === u} onClick={() => setUnit(u)}
            className={cn('flex-1 rounded-full py-1 text-[13px]', unit === u ? 'neu-raised-sm font-medium text-slack-primary' : 'text-slack-secondary')}>
            {l}
          </button>
        ))}
      </div>
      {error && <p className="text-[12px] text-slack-error">{error}</p>}
      <div className="mt-auto flex justify-end gap-2">
        <Button size="sm" variant="ghost" type="button" onClick={onCancel}>Cancel</Button>
        <Button size="sm" type="submit" disabled={!label.trim()}>Add</Button>
      </div>
    </form>
  );
}

/** 2px trend line with a soft area, end marker and a hover crosshair + tooltip. */
function Sparkline({ points, unit, label }: { points: Point[]; unit: Unit; label: string }) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 200, H = 44, PAD = 5;

  const geo = useMemo(() => {
    if (points.length < 2) return null;
    const vals = points.map((p) => p.value);
    const min = Math.min(...vals), max = Math.max(...vals);
    const span = max - min || 1;
    const xy = points.map((p, i) => ({
      x: PAD + (i / (points.length - 1)) * (W - PAD * 2),
      y: PAD + (1 - (p.value - min) / span) * (H - PAD * 2),
    }));
    const line = xy.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    return { xy, line, area: `${line} L${xy[xy.length - 1].x},${H} L${xy[0].x},${H} Z` };
  }, [points]);

  if (!geo) return <div className="flex-1" aria-hidden />;
  const last = geo.xy[geo.xy.length - 1];
  const active = hover !== null ? geo.xy[hover] : null;

  return (
    <div className="relative min-w-0 flex-1">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block h-[44px] w-full overflow-visible"
        role="img"
        aria-label={`${label}: ${points.length} data points from ${format(new Date(points[0].capturedAt), 'd MMM')} to ${format(new Date(points[points.length - 1].capturedAt), 'd MMM')}`}
        onMouseMove={(e) => {
          const rect = ref.current!.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * W;
          let best = 0;
          geo.xy.forEach((p, i) => { if (Math.abs(p.x - x) < Math.abs(geo.xy[best].x - x)) best = i; });
          setHover(best);
        }}
        onMouseLeave={() => setHover(null)}
      >
        <path d={geo.area} fill="var(--color-chart-1)" opacity={0.12} />
        <path d={geo.line} fill="none" stroke="var(--color-chart-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {active && <line x1={active.x} x2={active.x} y1={0} y2={H} stroke="var(--color-slack-border-dark)" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
        <circle cx={(active ?? last).x} cy={(active ?? last).y} r={4} fill="var(--color-chart-1)" stroke="var(--color-slack-surface)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute -top-9 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg bg-slack-primary px-2 py-1 text-[11px] text-white"
          style={{ left: `${(geo.xy[hover].x / W) * 100}%` }}
        >
          {formatValue(points[hover].value, unit)} · {format(new Date(points[hover].capturedAt), 'd MMM yyyy')}
        </div>
      )}
    </div>
  );
}

function PipelineByStage({ rows }: { rows: StageRow[] }) {
  const [hover, setHover] = useState<string | null>(null);
  const sorted = [...rows].sort((a, b) => {
    const ia = STAGE_ORDER.indexOf(a.stage), ib = STAGE_ORDER.indexOf(b.stage);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  const max = Math.max(...sorted.map((r) => r.total), 1);

  return (
    <section aria-labelledby="pipeline-heading" className="mt-8 rounded-[24px] neu-raised px-6 py-5">
      <h2 id="pipeline-heading" className="font-heading text-[16px] font-bold text-slack-primary">Pipeline by stage</h2>
      <p className="mb-4 text-[12px] text-slack-hint">Dark bar = weighted value (deal value × probability) · light bar = unweighted value</p>
      <ul className="space-y-3.5">
        {sorted.map((r) => (
          <li
            key={r.stage}
            className="grid grid-cols-[120px_1fr_auto] items-center gap-4"
            onMouseEnter={() => setHover(r.stage)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="text-[13px] font-medium text-slack-primary">{stageLabel(r.stage)}</span>
            <span className="relative h-[14px] rounded-full neu-inset-sm" aria-hidden>
              <span className="absolute inset-y-[2px] left-[2px] rounded-full bg-[var(--color-chart-1)]/25" style={{ width: `calc(${(r.total / max) * 100}% - 4px)` }} />
              <span className="absolute inset-y-[2px] left-[2px] rounded-full bg-[var(--color-chart-1)]" style={{ width: `calc(${(r.weighted / max) * 100}% - 4px)` }} />
              {hover === r.stage && (
                <span className="absolute -top-9 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg bg-slack-primary px-2 py-1 text-[11px] text-white">
                  {r.deals} {r.deals === 1 ? 'deal' : 'deals'} · {nok.format(r.total)} total · {nok.format(r.weighted)} weighted
                </span>
              )}
            </span>
            <span className="text-right text-[13px] tabular-nums text-slack-primary">
              {nok.format(r.weighted)}
              <span className="ml-1.5 text-[12px] text-slack-hint">of {nok.format(r.total)} · {r.deals}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TrafficSources({ channels, sources }: { channels: Array<{ name: string; sessions: number }>; sources: Array<{ name: string; sessions: number }> }) {
  const [hover, setHover] = useState<string | null>(null);
  const total = channels.reduce((sum, c) => sum + c.sessions, 0) || 1;
  const max = Math.max(...channels.map((c) => c.sessions), 1);
  return (
    <section aria-labelledby="sources-heading" className="rounded-[24px] neu-raised px-6 py-5">
      <h3 id="sources-heading" className="font-heading text-[16px] font-bold text-slack-primary">Traffic sources</h3>
      <p className="mb-4 text-[12px] text-slack-hint">Sessions by channel</p>
      {channels.length === 0 ? (
        <p className="text-[13px] text-slack-hint">No traffic in this period.</p>
      ) : (
        <ul className="space-y-3">
          {channels.map((c) => (
            <li key={c.name} className="grid grid-cols-[120px_1fr_auto] items-center gap-3"
              onMouseEnter={() => setHover(c.name)} onMouseLeave={() => setHover(null)}>
              <span className="truncate text-[13px] font-medium text-slack-primary" title={c.name}>{c.name}</span>
              <span className="relative h-[12px] rounded-full neu-inset-sm" aria-hidden>
                <span className="absolute inset-y-[2px] left-[2px] rounded-full bg-[var(--color-chart-1)]"
                  style={{ width: `max(calc(${(c.sessions / max) * 100}% - 4px), 6px)` }} />
                {hover === c.name && (
                  <span className="absolute -top-9 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg bg-slack-primary px-2 py-1 text-[11px] text-white">
                    {c.name}: {num.format(c.sessions)} sessions ({num.format((c.sessions / total) * 100)} %)
                  </span>
                )}
              </span>
              <span className="text-right text-[13px] tabular-nums text-slack-primary">
                {num.format(c.sessions)}<span className="ml-1.5 text-[12px] text-slack-hint">{num.format((c.sessions / total) * 100)} %</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {sources.length > 0 && (
        <>
          <h4 className="mb-2 mt-5 text-[12px] font-medium text-slack-secondary">Top sources</h4>
          <ol className="space-y-1">
            {sources.map((src) => (
              <li key={src.name} className="flex justify-between gap-3 text-[13px]">
                <span className="truncate text-slack-primary">{src.name}</span>
                <span className="tabular-nums text-slack-secondary">{num.format(src.sessions)}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

function TopPages({ pages }: { pages: Array<{ path: string; title: string; views: number; users: number }> }) {
  return (
    <section aria-labelledby="pages-heading" className="rounded-[24px] neu-raised px-6 py-5">
      <h3 id="pages-heading" className="font-heading text-[16px] font-bold text-slack-primary">Most visited pages</h3>
      <p className="mb-3 text-[12px] text-slack-hint">Page views and users, last 30 days</p>
      {pages.length === 0 ? (
        <p className="text-[13px] text-slack-hint">No page views in this period.</p>
      ) : (
        <table className="w-full table-fixed text-[13px]">
          <thead>
            <tr className="text-left text-[12px] text-slack-hint">
              <th className="pb-2 font-medium">Page</th>
              <th className="w-[70px] pb-2 text-right font-medium">Views</th>
              <th className="w-[60px] pb-2 text-right font-medium">Users</th>
            </tr>
          </thead>
          <tbody>
            {pages.map((p) => (
              <tr key={p.path} className="border-t border-slack-border/60">
                <td className="py-1.5 pr-3">
                  <span className="block truncate text-slack-primary" title={p.title}>{p.title || p.path}</span>
                  <span className="block truncate text-[11px] text-slack-hint">{p.path}</span>
                </td>
                <td className="py-1.5 text-right tabular-nums text-slack-primary">{num.format(p.views)}</td>
                <td className="py-1.5 text-right tabular-nums text-slack-secondary">{num.format(p.users)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function LinkedinSection({ summary, onImported }: { summary: LinkedinSummary; onImported: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    setBusy(true);
    setMessage(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const token = localStorage.getItem('token');
      const res = await fetch('/kpi/linkedin/import', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Import failed');
      const range = body.from && body.to ? ` (${format(new Date(body.from), 'd MMM yyyy')} – ${format(new Date(body.to), 'd MMM yyyy')})` : '';
      setMessage({
        tone: 'ok',
        text: body.kind === 'profile'
          ? `Imported ${body.name}’s profile: ${body.days} days${range}, ${body.posts} posts.`
          : `Imported the company page: ${body.days} days${range}.`,
      });
      await onImported();
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'Import failed' });
    } finally {
      setBusy(false);
    }
  };

  const tiles: Metric[] = [];
  if (summary.hasData) {
    const at = summary.latestDate;
    const tile = (key: string, label: string, unit: Unit, current: number | null, previous: number | null, history: Point[] = []): Metric => ({
      id: -100 - tiles.length, key, label, unit, source: 'linkedin', current, updatedAt: at,
      previous: previous === null ? null : { value: previous, capturedAt: at }, compareLabel: 'vs previous 30 days',
      trackingSince: summary.firstDate, history,
    });
    const { last30: c, previous30: p } = summary;
    tiles.push(
      tile('li_impressions', 'Impressions', 'count', c.impressions, p.impressions,
        summary.daily.map((d, i) => ({ id: i, value: d.impressions, capturedAt: d.date }))),
      // No impressions → no rate (shown as —), rather than a misleading 0 %
      tile('li_engagement', 'Engagement rate', 'percent',
        c.engagementRate === null ? null : c.engagementRate * 100, p.engagementRate === null ? null : p.engagementRate * 100),
      tile('li_clicks', 'Clicks', 'count', c.clicks, p.clicks),
      tile('li_interactions', 'Reactions, comments & reposts', 'count',
        c.reactions + c.comments + c.reposts, p.reactions + p.comments + p.reposts),
    );
  }

  return (
    <section aria-labelledby="linkedin-heading" className="mt-8">
      <h2 id="linkedin-heading" className="mb-3 text-[13px] font-medium text-slack-secondary">
        LinkedIn · company page{summary.hasData && <>, last 30 days to {format(new Date(summary.latestDate), 'd MMM yyyy')}</>}
      </h2>

      {summary.hasData && (
        <>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-5">
            {tiles.map((t) => <MetricTile key={t.key} metric={t} onChanged={onImported} />)}
          </div>
          <MonthlyImpressions months={summary.monthly} />
        </>
      )}

      {summary.profiles.map((p) => <ProfileCard key={p.name} profile={p} onChanged={onImported} />)}

      <div
        className={cn(
          'mt-5 flex flex-wrap items-center gap-4 rounded-[24px] neu-inset px-5 py-4 transition-shadow',
          dragOver && 'ring-2 ring-slack-btn/50',
        )}
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragOver(true); } }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files[0];
          if (file) void upload(file);
        }}
        data-testid="linkedin-import"
      >
        <div className="min-w-0 flex-1 text-[13px] text-slack-secondary">
          <p className="font-medium text-slack-primary">
            {summary.hasData || summary.profiles.length > 0 ? 'Update with a new export' : 'Import LinkedIn analytics'}
          </p>
          <p>
            Company page: <b>Analytics → Content → Export</b>. Personal profile: <b>Analytics → Post impressions → Export</b>
            (keep LinkedIn’s file name). Choose <b>past 365 days</b>, then drop the file here. Re-importing replaces the same days.
            {summary.hasData && <> Last import {formatDistanceToNow(new Date(summary.lastImportAt), { addSuffix: true })}.</>}
          </p>
          {message && (
            <p className={cn('mt-1', message.tone === 'error' ? 'text-slack-error' : 'text-[#1F8854]')} role="status">{message.text}</p>
          )}
        </div>
        <Button onClick={() => input.current?.click()} disabled={busy}>{busy ? 'Importing…' : 'Choose file'}</Button>
        <input
          ref={input}
          type="file"
          accept=".xls,.xlsx,.csv"
          hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }}
        />
      </div>
    </section>
  );
}

/** Vertical bars: impressions per month, with per-bar hover. */
function MonthlyImpressions({ months }: { months: Array<LiTotals & { month: string }> }) {
  const [hover, setHover] = useState<string | null>(null);
  if (months.length === 0) return null;
  const max = Math.max(...months.map((m) => m.impressions), 1);
  return (
    <div className="mt-5 rounded-[24px] neu-raised px-6 py-5">
      <h3 className="font-heading text-[16px] font-bold text-slack-primary">Impressions per month</h3>
      <p className="mb-4 text-[12px] text-slack-hint">Organic and sponsored, from the LinkedIn export</p>
      <div className="flex h-[140px] items-end gap-2" role="img"
        aria-label={`Impressions per month: ${months.map((m) => `${format(new Date(`${m.month}-01`), 'MMM yyyy')} ${m.impressions}`).join(', ')}`}>
        {months.map((m) => (
          <div key={m.month} className="relative flex h-full flex-1 flex-col items-center justify-end gap-1.5"
            onMouseEnter={() => setHover(m.month)} onMouseLeave={() => setHover(null)}>
            {hover === m.month && (
              <span className="absolute -top-8 z-10 whitespace-nowrap rounded-lg bg-slack-primary px-2 py-1 text-[11px] text-white">
                {format(new Date(`${m.month}-01`), 'MMM yyyy')}: {num.format(m.impressions)} impressions · {num.format(m.clicks)} clicks
              </span>
            )}
            <span className="w-full max-w-[28px] rounded-t-[4px] bg-[var(--color-chart-1)]"
              style={{ height: `${Math.max((m.impressions / max) * 100, m.impressions > 0 ? 3 : 0)}%` }} />
            <span className="text-[11px] text-slack-hint">{format(new Date(`${m.month}-01`), 'MMM')}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const DEMOGRAPHIC_ORDER = ['Job title', 'Seniority', 'Industry', 'Company size', 'Location', 'Company'];

function ProfileCard({ profile: p, onChanged }: { profile: LinkedinProfileSummary; onChanged: () => Promise<void> }) {
  // A short export (e.g. LinkedIn's default 7 days) can't fill "last 30 days" honestly
  const fullMonth = p.daysCovered >= 30;
  const period = fullMonth
    ? 'last 30 days'
    : p.firstDate && p.latestDate
      ? `${format(new Date(p.firstDate), 'd MMM')} – ${format(new Date(p.latestDate), 'd MMM yyyy')}`
      : 'imported period';
  const at = p.latestDate ?? p.importedAt;
  const tiles: Metric[] = [
    {
      id: -200, key: `${p.name}-followers`, label: 'Followers', unit: 'count', source: 'linkedin',
      current: p.followers, updatedAt: p.followersAt,
      previous: p.followers !== null ? { value: p.followers - p.last30.newFollowers, capturedAt: at } : null,
      compareLabel: `new, ${period}`, trackingSince: p.firstDate, history: [],
    },
    {
      id: -201, key: `${p.name}-impressions`, label: `Impressions, ${period}`, unit: 'count', source: 'linkedin',
      current: p.last30.impressions, updatedAt: at,
      previous: fullMonth && p.previous30 ? { value: p.previous30.impressions, capturedAt: at } : null,
      compareLabel: 'vs previous 30 days', trackingSince: p.firstDate,
      history: p.daily.map((d, i) => ({ id: i, value: d.impressions, capturedAt: d.date })),
    },
    {
      id: -202, key: `${p.name}-engagements`, label: `Engagements, ${period}`, unit: 'count', source: 'linkedin',
      current: p.last30.engagements, updatedAt: at,
      previous: fullMonth && p.previous30 ? { value: p.previous30.engagements, capturedAt: at } : null,
      compareLabel: 'vs previous 30 days', trackingSince: p.firstDate, history: [],
    },
  ];
  const categories = DEMOGRAPHIC_ORDER.filter((c) => p.demographics[c]?.length).concat(
    Object.keys(p.demographics).filter((c) => !DEMOGRAPHIC_ORDER.includes(c)),
  );

  return (
    <div className="mt-6" data-testid="linkedin-profile">
      <h3 className="mb-3 text-[13px] font-medium text-slack-secondary">
        {p.name} · personal profile{!fullMonth && <> · only {p.daysCovered} days imported — export “past 365 days” for history</>}
      </h3>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-5">
        {tiles.map((t) => <MetricTile key={t.key} metric={t} onChanged={onChanged} />)}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <section className="rounded-[24px] neu-raised px-6 py-5" aria-label={`${p.name}: top posts`}>
          <h4 className="font-heading text-[16px] font-bold text-slack-primary">Top posts</h4>
          <p className="mb-3 text-[12px] text-slack-hint">Impressions and engagements in the imported period</p>
          {p.topPosts.length === 0 ? (
            <p className="text-[13px] text-slack-hint">No posts in this export.</p>
          ) : (
            <ol className="space-y-2.5">
              {p.topPosts.map((post) => (
                <li key={post.url} className="flex items-start justify-between gap-3 text-[13px]">
                  <span className="min-w-0">
                    <a href={post.url} target="_blank" rel="noopener noreferrer" className="block truncate font-medium text-slack-link hover:underline">
                      {post.title}
                    </a>
                    {post.publishedAt && <span className="text-[11px] text-slack-hint">Posted {format(new Date(post.publishedAt), 'd MMM yyyy')}</span>}
                  </span>
                  <span className="flex-shrink-0 text-right tabular-nums text-slack-secondary">
                    {num.format(post.impressions ?? 0)} <span className="text-[11px] text-slack-hint">views</span>
                    {post.engagements ? <> · {num.format(post.engagements)} <span className="text-[11px] text-slack-hint">eng.</span></> : null}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="rounded-[24px] neu-raised px-6 py-5" aria-label={`${p.name}: audience`}>
          <h4 className="font-heading text-[16px] font-bold text-slack-primary">Who you reach</h4>
          <p className="mb-3 text-[12px] text-slack-hint">Top audience by category, as reported by LinkedIn</p>
          {categories.length === 0 ? (
            <p className="text-[13px] text-slack-hint">No audience data in this export.</p>
          ) : (
            <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              {categories.map((c) => (
                <div key={c}>
                  <p className="mb-1 text-[12px] font-medium text-slack-secondary">{c}</p>
                  <ul className="space-y-0.5">
                    {p.demographics[c].slice(0, 5).map((d) => (
                      <li key={d.value} className="flex justify-between gap-2 text-[13px]">
                        <span className="truncate text-slack-primary" title={d.value}>{d.value}</span>
                        <span className="flex-shrink-0 tabular-nums text-slack-hint">{d.percentage}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
