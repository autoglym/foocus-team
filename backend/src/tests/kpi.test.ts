import { TEST_PASSWORD } from './test-constants.js';
import request from 'supertest';
import app from '../app.js';
import prisma from '../db.js';
import * as XLSX from 'xlsx';
import { postTitleFromUrl, profileNameFromFilename } from '../services/linkedinImport.js';

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
    expect(res.body.ga4).toEqual({ configured: false, ok: false });
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

  describe('LinkedIn import', () => {
    const exportFile = (rows: Array<[string, number, number, number]>) => {
      // Same shape as LinkedIn's export: a description line, then the header row
      const sheet = XLSX.utils.aoa_to_sheet([
        ['Aggregated engagement metrics for your organic and sponsored posts over time.'],
        ['Date', 'Impressions (organic)', 'Impressions (sponsored)', 'Impressions (total)', 'Unique impressions (organic)',
          'Clicks (organic)', 'Clicks (sponsored)', 'Clicks (total)', 'Reactions (organic)', 'Reactions (sponsored)',
          'Reactions (total)', 'Comments (organic)', 'Comments (sponsored)', 'Comments (total)', 'Reposts (organic)',
          'Reposts (sponsored)', 'Reposts (total)', 'Engagement rate (organic)', 'Engagement rate (sponsored)', 'Engagement rate (total)'],
        ...rows.map(([date, impressions, clicks, reactions]) => [
          date, impressions, 0, impressions, impressions, clicks, 0, clicks, reactions, 0, reactions, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ]),
      ]);
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, 'Metrics');
      return XLSX.write(book, { type: 'buffer', bookType: 'xls' }) as Buffer;
    };

    it('imports the Content export, overwrites re-imported days and summarises the last 30 days', async () => {
      const auth = { Authorization: `Bearer ${admin}` };
      const first = await request(app).post('/kpi/linkedin/import').set(auth)
        .attach('file', exportFile([['9/1/2026', 100, 5, 1], ['10/20/2026', 40, 2, 0], ['10/21/2026', 60, 3, 1]]), 'content.xls');
      expect(first.status).toBe(200);
      expect(first.body.days).toBe(3);

      // Re-import with a corrected day
      await request(app).post('/kpi/linkedin/import').set(auth)
        .attach('file', exportFile([['10/21/2026', 80, 4, 2]]), 'content.xls');

      const res = await request(app).get('/kpi/dashboard').set(auth);
      const li = res.body.linkedin;
      expect(li.hasData).toBe(true);
      expect(li.latestDate.slice(0, 10)).toBe('2026-10-21');
      expect(li.last30.impressions).toBe(120);
      expect(li.last30.clicks).toBe(6);
      expect(li.previous30.impressions).toBe(100);
      expect(li.last30.engagementRate).toBeCloseTo((6 + 2) / 120);
    });

    it('rejects files that are not a LinkedIn Content export', async () => {
      const res = await request(app).post('/kpi/linkedin/import').set('Authorization', `Bearer ${admin}`)
        .attach('file', Buffer.from('name,value\nfoo,1'), 'other.csv');
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/LinkedIn Content export/);
    });

    it('is admin-only', async () => {
      const res = await request(app).post('/kpi/linkedin/import').set('Authorization', `Bearer ${member}`)
        .attach('file', Buffer.from('x'), 'x.csv');
      expect(res.status).toBe(403);
    });
  });

  describe('LinkedIn personal profile import', () => {
    const profileFile = () => {
      const book = XLSX.utils.book_new();
      const add = (name: string, rows: unknown[][]) => XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
      add('DISCOVERY', [['Overall Performance', '10/18/2026 - 10/24/2026'], ['Impressions', '18']]);
      add('ENGAGEMENT', [['Date', 'Impressions', 'Engagements'], ['10/23/2026', '2', '1'], ['10/24/2026', '4', '0']]);
      add('TOP POSTS', [
        ['Maximum of 50 posts available to include in this list'],
        ['Post URL', 'Post Publish Date', 'Engagements', '', 'Post URL', 'Post Publish Date', 'Impressions'],
        ['https://www.linkedin.com/posts/glenn_sport-is-having-a-moment-share-7435203482661486594-iJRO', '3/5/2026', '3', '',
          'https://www.linkedin.com/posts/glenn_sport-is-having-a-moment-share-7435203482661486594-iJRO', '3/5/2026', '40'],
      ]);
      add('FOLLOWERS', [['Total followers on 10/24/2026', '3457'], ['Date', 'New followers'], ['10/23/2026', '2'], ['10/24/2026', '1']]);
      add('AUDIENCE DEMOGRAPHICS', [['Top Demographics', 'Value', 'Percentage'], ['Company', 'Norsk Tipping', '< 1%'], ['Location', 'Greater Oslo Region', '47%']]);
      return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    };

    it('derives names and post titles from LinkedIn’s file names and URLs', () => {
      expect(profileNameFromFilename('AggregateAnalytics_Glenn Myklebust_2026-10-18_2026-10-24 (1).xlsx')).toBe('Glenn Myklebust');
      expect(profileNameFromFilename('report.xlsx')).toBeNull();
      expect(postTitleFromUrl('https://www.linkedin.com/posts/glennmyklebust_my-phone-was-dead-this-morning-so-i-ended-share-7496850352709869568-3iXC'))
        .toBe('My phone was dead this morning so I ended…');
    });

    it('imports daily numbers, followers, top posts and audience for a profile', async () => {
      const auth = { Authorization: `Bearer ${admin}` };
      const res = await request(app).post('/kpi/linkedin/import').set(auth)
        .attach('file', profileFile(), 'AggregateAnalytics_Glenn Myklebust_2026-10-18_2026-10-24.xlsx');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ kind: 'profile', name: 'Glenn Myklebust', days: 2, posts: 1 });

      const dash = await request(app).get('/kpi/dashboard').set(auth);
      const profile = dash.body.linkedin.profiles.find((p: any) => p.name === 'Glenn Myklebust');
      expect(profile.followers).toBe(3457);
      expect(profile.last30).toEqual({ impressions: 6, engagements: 1, newFollowers: 3 });
      expect(profile.topPosts[0]).toMatchObject({ title: 'Sport is having a moment…', impressions: 40, engagements: 3 });
      expect(profile.demographics.Location).toEqual([{ value: 'Greater Oslo Region', percentage: '47%' }]);
    });

    it('needs LinkedIn’s file name to know whose profile it is', async () => {
      const res = await request(app).post('/kpi/linkedin/import').set('Authorization', `Bearer ${admin}`)
        .attach('file', profileFile(), 'export.xlsx');
      expect(res.status).toBe(400);
    });
  });
});
