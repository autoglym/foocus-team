import { TEST_PASSWORD } from './test-constants.js';
import request from 'supertest';
import app from '../app.js';
import prisma from '../db.js';

describe('KPI dashboard', () => {
  let admin: string;
  let member: string;

  beforeAll(async () => {
    await prisma.kpiValue.deleteMany();
    await prisma.kpiMetric.deleteMany();
    await prisma.user.deleteMany({ where: { email: { in: ['kpi-admin@example.com', 'kpi-member@example.com'] } } });
    const a = await request(app).post('/auth/register').send({ email: 'kpi-admin@example.com', password: TEST_PASSWORD, name: 'KPI Admin' });
    await prisma.user.update({ where: { id: a.body.user.id }, data: { role: 'ADMIN' } });
    admin = (await request(app).post('/auth/login').send({ email: 'kpi-admin@example.com', password: TEST_PASSWORD })).body.token;
    member = (await request(app).post('/auth/register').send({ email: 'kpi-member@example.com', password: TEST_PASSWORD, name: 'KPI Member' })).body.token;
  });

  afterAll(async () => {
    await prisma.kpiValue.deleteMany();
    await prisma.kpiMetric.deleteMany();
  });

  it('is only available to owners and admins', async () => {
    expect((await request(app).get('/kpi/dashboard').set('Authorization', `Bearer ${member}`)).status).toBe(403);
    expect((await request(app).post('/kpi/metrics').set('Authorization', `Bearer ${member}`).send({ label: 'X' })).status).toBe(403);
    expect((await request(app).get('/kpi/dashboard')).status).toBe(401);
  });

  it('reports the CRM as not configured when no connection is set', async () => {
    const res = await request(app).get('/kpi/dashboard').set('Authorization', `Bearer ${admin}`);
    expect(res.status).toBe(200);
    expect(res.body.crm).toEqual({ configured: false, ok: false });
  });

  it('tracks manual metrics with history and the previous value', async () => {
    const auth = { Authorization: `Bearer ${admin}` };
    const metric = await request(app).post('/kpi/metrics').set(auth).send({ label: 'LinkedIn followers', unit: 'count' });
    expect(metric.status).toBe(201);

    await request(app).post(`/kpi/metrics/${metric.body.id}/values`).set(auth).send({ value: 1180, capturedAt: '2026-09-01' });
    await request(app).post(`/kpi/metrics/${metric.body.id}/values`).set(auth).send({ value: 1240 });

    const res = await request(app).get('/kpi/dashboard').set(auth);
    const m = res.body.metrics.find((x: any) => x.id === metric.body.id);
    expect(m.current).toBe(1240);
    expect(m.previous.value).toBe(1180);
    expect(m.history.map((h: any) => h.value)).toEqual([1180, 1240]);
  });

  it('rejects future dates and non-numbers', async () => {
    const auth = { Authorization: `Bearer ${admin}` };
    const metric = await request(app).post('/kpi/metrics').set(auth).send({ label: 'Web visitors' });
    expect((await request(app).post(`/kpi/metrics/${metric.body.id}/values`).set(auth).send({ value: 'many' })).status).toBe(400);
    expect((await request(app).post(`/kpi/metrics/${metric.body.id}/values`).set(auth).send({ value: 5, capturedAt: '2999-01-01' })).status).toBe(400);
  });

  it('does not allow editing CRM metrics by hand', async () => {
    const crm = await prisma.kpiMetric.create({ data: { key: 'crm_arr', label: 'ARR', unit: 'NOK', source: 'crm' } });
    const res = await request(app).post(`/kpi/metrics/${crm.id}/values`).set('Authorization', `Bearer ${admin}`).send({ value: 1 });
    expect(res.status).toBe(400);
  });
});
