import { Router, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import prisma from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/adminAuth.js';
import { AuthRequest } from '../types.js';
import { parseIntParam } from '../utils/params.js';
import { logError } from '../utils/logger.js';
import {
  isCrmConfigured, fetchCrmSummary, fetchPipelineByStage,
  type CrmSummary, type StageRow,
} from '../services/crmKpi.js';
import { isGa4Configured, fetchGa4, type Ga4Result } from '../services/ga4.js';
import multer from 'multer';
import { importLinkedinContent, linkedinSummary, LinkedinImportError } from '../services/linkedinImport.js';

// Commercial dashboard — owners and admins only.
const router = Router();
router.use(authMiddleware, requireAdmin);

const CRM_METRICS: Array<{ key: keyof CrmSummary; label: string; unit: string; sortOrder: number }> = [
  { key: 'customers', label: 'Customers', unit: 'count', sortOrder: 1 },
  { key: 'arr', label: 'ARR', unit: 'NOK', sortOrder: 2 },
  { key: 'weightedPipeline', label: 'Weighted pipeline', unit: 'NOK', sortOrder: 3 },
  { key: 'pipelineTotal', label: 'Pipeline (unweighted)', unit: 'NOK', sortOrder: 4 },
  { key: 'openDeals', label: 'Open deals', unit: 'count', sortOrder: 5 },
];
const crmKey = (key: string) => `crm_${key}`;

const LIVE_CACHE_MS = 60_000;
const SNAPSHOT_EVERY_MS = 6 * 60 * 60 * 1000;
const COMPARE_DAYS = 30;

let liveCache: { at: number; summary: CrmSummary; stages: StageRow[] } | null = null;

/** Live CRM totals (cached briefly); stores a snapshot for trends at most every 6 hours. */
async function loadCrm(): Promise<{ summary: CrmSummary; stages: StageRow[]; fetchedAt: Date }> {
  if (liveCache && Date.now() - liveCache.at < LIVE_CACHE_MS) {
    return { summary: liveCache.summary, stages: liveCache.stages, fetchedAt: new Date(liveCache.at) };
  }
  const [summary, stages] = await Promise.all([fetchCrmSummary(), fetchPipelineByStage()]);
  liveCache = { at: Date.now(), summary, stages };

  for (const m of CRM_METRICS) {
    const metric = await prisma.kpiMetric.upsert({
      where: { key: crmKey(m.key) },
      update: {},
      create: { key: crmKey(m.key), label: m.label, unit: m.unit, source: 'crm', sortOrder: m.sortOrder },
    });
    const last = await prisma.kpiValue.findFirst({ where: { metricId: metric.id }, orderBy: { capturedAt: 'desc' } });
    if (!last || Date.now() - last.capturedAt.getTime() >= SNAPSHOT_EVERY_MS) {
      await prisma.kpiValue.create({ data: { metricId: metric.id, value: summary[m.key] } });
    }
  }
  return { summary, stages, fetchedAt: new Date(liveCache.at) };
}

// GET /kpi/dashboard
router.get('/dashboard', async (_req: AuthRequest, res: Response) => {
  try {
    let crm: { configured: boolean; ok: boolean; error?: string; fetchedAt?: Date; pipelineByStage?: StageRow[] } = {
      configured: isCrmConfigured,
      ok: false,
    };
    let live: CrmSummary | null = null;
    if (isCrmConfigured) {
      try {
        const loaded = await loadCrm();
        live = loaded.summary;
        crm = { configured: true, ok: true, fetchedAt: loaded.fetchedAt, pipelineByStage: loaded.stages };
      } catch (err) {
        logError('CRM KPI fetch failed', err);
        crm = { configured: true, ok: false, error: 'Could not reach the CRM. Showing the last saved numbers.' };
      }
    }

    const since = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const compareBefore = new Date(Date.now() - COMPARE_DAYS * 24 * 60 * 60 * 1000);
    const metrics = await prisma.kpiMetric.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { values: { where: { capturedAt: { gte: since } }, orderBy: { capturedAt: 'asc' } } },
    });

    const result = metrics.map((m) => {
      const history = m.values.map((v) => ({ id: v.id, value: v.value, capturedAt: v.capturedAt }));
      const latest = history[history.length - 1] ?? null;
      const liveKey = CRM_METRICS.find((c) => crmKey(c.key) === m.key)?.key;
      const current = m.source === 'crm' && live && liveKey ? live[liveKey] : latest?.value ?? null;

      // CRM: compare with ~30 days ago. Manual: compare with the previous entry.
      let previous: { value: number; capturedAt: Date } | null = null;
      if (m.source === 'crm') {
        const older = history.filter((h) => h.capturedAt <= compareBefore);
        previous = older[older.length - 1] ?? null;
      } else if (history.length >= 2) {
        previous = history[history.length - 2];
      }

      return {
        id: m.id,
        key: m.key,
        label: m.label,
        unit: m.unit,
        source: m.source,
        current,
        updatedAt: m.source === 'crm' && live ? crm.fetchedAt : latest?.capturedAt ?? null,
        previous,
        trackingSince: history[0]?.capturedAt ?? null,
        // Thin the series for the sparkline: at most one point per day, max 90 points
        history: thinDaily(history).slice(-90),
      };
    });

    let ga4: { configured: boolean; ok: boolean; error?: string } & Partial<Ga4Result> = {
      configured: isGa4Configured,
      ok: false,
    };
    if (isGa4Configured) {
      try {
        const loaded = await fetchGa4();
        ga4 = { configured: true, ok: true, ...loaded };
      } catch (err) {
        logError('GA4 fetch failed', err);
        ga4 = { configured: true, ok: false, error: 'Could not reach Google Analytics.' };
      }
    }

    const linkedin = await linkedinSummary();

    res.json({ crm, ga4, linkedin, metrics: result });
  } catch (error) {
    logError('KPI dashboard error', error);
    res.status(500).json({ error: 'Failed to load the dashboard' });
  }
});

function thinDaily<T extends { capturedAt: Date }>(points: T[]): T[] {
  const byDay = new Map<string, T>();
  for (const p of points) byDay.set(p.capturedAt.toISOString().slice(0, 10), p);
  return [...byDay.values()];
}

// ── LinkedIn import ──────────────────────────────────────────────────

// Kept in memory only; LinkedIn exports are small spreadsheets
const linkedinUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

// POST /kpi/linkedin/import - LinkedIn page Analytics → Content export (.xls/.xlsx/.csv)
router.post('/linkedin/import', (req, res, next) => {
  linkedinUpload.single('file')(req, res, (err: unknown) => {
    if (err) return void res.status(400).json({ error: 'The file is too large or could not be uploaded' });
    next();
  });
}, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) return void res.status(400).json({ error: 'Choose a LinkedIn export file' });
    const result = await importLinkedinContent(req.file.buffer);
    res.json(result);
  } catch (error) {
    if (error instanceof LinkedinImportError) return void res.status(400).json({ error: error.message });
    logError('LinkedIn import error', error);
    res.status(500).json({ error: 'Failed to import the LinkedIn file' });
  }
});

// ── Manual metrics ───────────────────────────────────────────────────

const unitSchema = z.enum(['count', 'NOK', 'percent']);
const metricSchema = z.object({
  label: z.string().trim().min(1, 'Name is required').max(80),
  unit: unitSchema.default('count'),
});

// POST /kpi/metrics
router.post('/metrics', async (req: AuthRequest, res: Response) => {
  try {
    const parsed = metricSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0]?.message });
    const metric = await prisma.kpiMetric.create({
      data: {
        key: `manual_${crypto.randomUUID().slice(0, 8)}`,
        label: parsed.data.label,
        unit: parsed.data.unit,
        source: 'manual',
        sortOrder: 100,
      },
    });
    res.status(201).json(metric);
  } catch (error) {
    logError('Create KPI metric error', error);
    res.status(500).json({ error: 'Failed to create metric' });
  }
});

async function manualMetric(req: AuthRequest, res: Response) {
  const id = parseIntParam(req.params.id);
  const metric = id ? await prisma.kpiMetric.findUnique({ where: { id } }) : null;
  if (!metric) {
    res.status(404).json({ error: 'Metric not found' });
    return null;
  }
  if (metric.source !== 'manual') {
    res.status(400).json({ error: 'CRM numbers are updated automatically' });
    return null;
  }
  return metric;
}

// PATCH /kpi/metrics/:id
router.patch('/metrics/:id', async (req: AuthRequest, res: Response) => {
  try {
    const metric = await manualMetric(req, res);
    if (!metric) return;
    const parsed = metricSchema.partial().safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0]?.message });
    res.json(await prisma.kpiMetric.update({ where: { id: metric.id }, data: parsed.data }));
  } catch (error) {
    logError('Update KPI metric error', error);
    res.status(500).json({ error: 'Failed to update metric' });
  }
});

// DELETE /kpi/metrics/:id
router.delete('/metrics/:id', async (req: AuthRequest, res: Response) => {
  try {
    const metric = await manualMetric(req, res);
    if (!metric) return;
    await prisma.kpiMetric.delete({ where: { id: metric.id } });
    res.json({ message: 'Metric deleted' });
  } catch (error) {
    logError('Delete KPI metric error', error);
    res.status(500).json({ error: 'Failed to delete metric' });
  }
});

// POST /kpi/metrics/:id/values - record a value (defaults to now)
router.post('/metrics/:id/values', async (req: AuthRequest, res: Response) => {
  try {
    const metric = await manualMetric(req, res);
    if (!metric) return;
    const parsed = z.object({
      value: z.number().finite(),
      capturedAt: z.coerce.date().max(new Date(Date.now() + 60_000), 'Date cannot be in the future').optional(),
    }).safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0]?.message });
    const value = await prisma.kpiValue.create({
      data: {
        metricId: metric.id,
        value: parsed.data.value,
        capturedAt: parsed.data.capturedAt ?? new Date(),
        createdBy: req.user!.userId,
      },
    });
    res.status(201).json(value);
  } catch (error) {
    logError('Add KPI value error', error);
    res.status(500).json({ error: 'Failed to save value' });
  }
});

// DELETE /kpi/values/:id - remove a mistyped manual value
router.delete('/values/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = parseIntParam(req.params.id);
    const value = id ? await prisma.kpiValue.findUnique({ where: { id }, include: { metric: true } }) : null;
    if (!value) return void res.status(404).json({ error: 'Value not found' });
    if (value.metric.source !== 'manual') return void res.status(400).json({ error: 'CRM numbers are updated automatically' });
    await prisma.kpiValue.delete({ where: { id: value.id } });
    res.json({ message: 'Value deleted' });
  } catch (error) {
    logError('Delete KPI value error', error);
    res.status(500).json({ error: 'Failed to delete value' });
  }
});

export default router;
