import { TEST_PASSWORD } from './test-constants.js';
import request from 'supertest';
import app from '../app.js';
import prisma from '../db.js';
import { isPrivateAddress, validatePublicUrl, parseMetadata } from '../services/linkPreview.js';

describe('Link previews', () => {
  describe('SSRF guards', () => {
    it.each([
      '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
      '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1',
    ])('treats %s as private', (ip) => {
      expect(isPrivateAddress(ip)).toBe(true);
    });

    it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111'])('treats %s as public', (ip) => {
      expect(isPrivateAddress(ip)).toBe(false);
    });

    it.each([
      'http://localhost/', 'http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data',
      'http://[::1]/', 'ftp://example.com/', 'https://example.com:8443/', 'https://user:pw@example.com/',
      'file:///etc/passwd', 'not a url', 'http://printer.local/',
    ])('rejects %s', (raw) => {
      expect(validatePublicUrl(raw)).toBeNull();
    });

    it('accepts a normal https URL', () => {
      expect(validatePublicUrl('https://www.foocus.ai/about')?.hostname).toBe('www.foocus.ai');
    });
  });

  describe('parseMetadata', () => {
    const page = new URL('https://example.com/article/1');

    it('prefers Open Graph tags and resolves relative images', () => {
      const html = `<html><head>
        <title>Fallback</title>
        <meta property="og:title" content="Sesongens beste &amp; mest sette">
        <meta content="En kort beskrivelse" property="og:description">
        <meta property="og:image" content="/img/cover.jpg">
        <meta property="og:site_name" content="Eksempel">
      </head><body></body></html>`;
      expect(parseMetadata(html, page)).toEqual({
        url: 'https://example.com/article/1',
        title: 'Sesongens beste & mest sette',
        description: 'En kort beskrivelse',
        image: 'https://example.com/img/cover.jpg',
        siteName: 'Eksempel',
      });
    });

    it('falls back to <title> and hostname', () => {
      const preview = parseMetadata('<head><title> Bare tittel </title></head>', page);
      expect(preview?.title).toBe('Bare tittel');
      expect(preview?.siteName).toBe('example.com');
      expect(preview?.image).toBeNull();
    });

    it('drops non-https images and returns null without a title', () => {
      expect(parseMetadata('<head><meta property="og:image" content="http://x.com/a.jpg"></head>', page)).toBeNull();
      const preview = parseMetadata('<head><title>T</title><meta property="og:image" content="http://x.com/a.jpg"></head>', page);
      expect(preview?.image).toBeNull();
    });
  });

  describe('GET /unfurl', () => {
    let token: string;

    beforeAll(async () => {
      await prisma.user.deleteMany({ where: { email: 'unfurl-test@example.com' } });
      const res = await request(app).post('/auth/register').send({
        email: 'unfurl-test@example.com', password: TEST_PASSWORD, name: 'Unfurl Tester',
      });
      token = res.body.token;
    });

    it('requires authentication', async () => {
      const res = await request(app).get('/unfurl').query({ url: 'https://example.com' });
      expect(res.status).toBe(401);
    });

    it('rejects internal addresses without fetching them', async () => {
      const res = await request(app)
        .get('/unfurl')
        .set('Authorization', `Bearer ${token}`)
        .query({ url: 'http://169.254.169.254/latest/meta-data' });
      expect(res.status).toBe(400);
    });
  });
});
