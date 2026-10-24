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
  source: 'crm' | 'manual' | 'ga4';
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
interface Dashboard {
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
