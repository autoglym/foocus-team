import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Express } from 'express';

// Configure Google before the app (and googleAuth.ts) is loaded in this test file
process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
process.env.GOOGLE_ALLOWED_DOMAINS = 'foocus.ai';
process.env.APP_URL = 'https://team.example.com';

describe('Google sign-in', () => {
  let app: Express;
  let JWT_SECRET: string;

  beforeAll(async () => {
    app = (await import('../app.js')).default;
    JWT_SECRET = (await import('../config.js')).JWT_SECRET;
  });

  it('reports that Google sign-in is enabled', async () => {
    const res = await request(app).get('/auth/google/enabled');
    expect(res.body).toEqual({ enabled: true });
  });

  it('redirects to Google with state, domain hint and a state cookie', async () => {
    const res = await request(app).get('/auth/google');
    expect(res.status).toBe(302);
    const location = new URL(res.headers.location);
    expect(location.hostname).toBe('accounts.google.com');
    expect(location.searchParams.get('client_id')).toBe('test-client.apps.googleusercontent.com');
    expect(location.searchParams.get('redirect_uri')).toBe('https://team.example.com/auth/google/callback');
    expect(location.searchParams.get('hd')).toBe('foocus.ai');
    expect(location.searchParams.get('scope')).toContain('email');
    expect(location.searchParams.get('state')).toBeTruthy();
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/g_oauth_state=[a-f0-9]{32}/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
  });

  it('rejects a callback whose state is not bound to this browser', async () => {
    const state = jwt.sign({ nonce: 'a'.repeat(32), purpose: 'google-oauth' }, JWT_SECRET, { expiresIn: '10m' });
    const res = await request(app)
      .get('/auth/google/callback')
      .query({ code: 'fake-code', state })
      .set('Cookie', `g_oauth_state=${'b'.repeat(32)}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^https:\/\/team\.example\.com\/login\/google#error=/);
    expect(res.headers.location).not.toContain('token=');
  });

  it('rejects a forged state', async () => {
    const state = jwt.sign({ nonce: 'a'.repeat(32), purpose: 'google-oauth' }, 'not-our-secret');
    const res = await request(app)
      .get('/auth/google/callback')
      .query({ code: 'fake-code', state })
      .set('Cookie', `g_oauth_state=${'a'.repeat(32)}`);
    expect(res.headers.location).toContain('#error=');
  });

  it('handles a cancelled sign-in', async () => {
    const res = await request(app).get('/auth/google/callback').query({ error: 'access_denied' });
    expect(res.headers.location).toContain('#error=');
  });
});
