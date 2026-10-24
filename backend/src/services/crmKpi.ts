import pg from 'pg';

// Read-only connection to the CRM (Ronja). The database user can only read the
// kpi.crm_summary and kpi.pipeline_by_stage views (totals, never client rows).
const url = process.env.RONJA_KPI_DATABASE_URL;

const pool = url
  ? new pg.Pool({
      connectionString: url,
      // Supabase's pooler presents a certificate from Supabase's own CA, which
      // isn't in Node's trust store; the connection is still encrypted.
      ssl: { rejectUnauthorized: false },
      max: 2,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000,
    })
  : null;

pool?.on('error', () => { /* idle client errors: the next query reconnects */ });

export const isCrmConfigured = pool !== null;

export interface CrmSummary {
  customers: number;
  arr: number;
  openDeals: number;
  pipelineTotal: number;
  weightedPipeline: number;
}

export interface StageRow { stage: string; deals: number; total: number; weighted: number }

export async function fetchCrmSummary(): Promise<CrmSummary> {
  if (!pool) throw new Error('CRM is not configured');
  const { rows } = await pool.query(
    'select customers, arr, open_deals, pipeline_total, weighted_pipeline from kpi.crm_summary',
  );
  const r = rows[0] ?? {};
  return {
    customers: Number(r.customers ?? 0),
    arr: Number(r.arr ?? 0),
    openDeals: Number(r.open_deals ?? 0),
    pipelineTotal: Number(r.pipeline_total ?? 0),
    weightedPipeline: Math.round(Number(r.weighted_pipeline ?? 0)),
  };
}

export async function fetchPipelineByStage(): Promise<StageRow[]> {
  if (!pool) throw new Error('CRM is not configured');
  const { rows } = await pool.query('select stage, deals, total, weighted from kpi.pipeline_by_stage');
  return rows.map((r) => ({
    stage: String(r.stage),
    deals: Number(r.deals),
    total: Number(r.total),
    weighted: Math.round(Number(r.weighted)),
  }));
}
