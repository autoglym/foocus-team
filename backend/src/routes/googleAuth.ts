import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import prisma from '../db.js';
import { JWT_SECRET } from '../config.js';
import { logError } from '../utils/logger.js';
import { joinDefaultChannels } from './auth.js';

// "Sign in with Google" (OAuth 2.0 authorization code flow).
// - Existing users can sign in with the Google account that has the same, verified email.
// - New users are created automatically only for GOOGLE_ALLOWED_DOMAINS (e.g. foocus.ai);
//   everyone else still needs an invite link.
// Configure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_ALLOWED_DOMAINS and APP_URL.

const router = Router();

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const APP_URL = (process.env.APP_URL || 'http://localhost:5173').replace(/\/+$/, '');
const ALLOWED_DOMAINS = (process.env.GOOGLE_ALLOWED_DOMAINS || '')
  .split(',')
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);
const REDIRECT_URI = `${APP_URL}/auth/google/callback`;
const STATE_COOKIE = 'g_oauth_state';

export const isGoogleAuthEnabled = Boolean(CLIENT_ID && CLIENT_SECRET);
const oauth = isGoogleAuthEnabled ? new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI) : null;

function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

function finish(res: Response, result: { token: string } | { error: string }) {
  res.setHeader('Set-Cookie', `${STATE_COOKIE}=; Path=/auth/google; HttpOnly; SameSite=Lax; Max-Age=0${APP_URL.startsWith('https') ? '; Secure' : ''}`);
  // The token travels in the URL fragment, which is never sent to servers or logged
  const fragment = 'token' in result
    ? `token=${encodeURIComponent(result.token)}`
    : `error=${encodeURIComponent(result.error)}`;
  res.redirect(302, `${APP_URL}/login/google#${fragment}`);
}

// GET /auth/google/enabled - lets the login page decide whether to show the button
router.get('/enabled', (_req, res) => {
  res.json({ enabled: isGoogleAuthEnabled });
});

// GET /auth/google - start the flow
router.get('/', (req: Request, res: Response) => {
  if (!oauth) {
    res.status(404).json({ error: 'Google sign-in is not configured' });
    return;
  }
  const nonce = crypto.randomBytes(16).toString('hex');
  const state = jwt.sign({ nonce, purpose: 'google-oauth' }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '10m' });
  res.setHeader('Set-Cookie', `${STATE_COOKIE}=${nonce}; Path=/auth/google; HttpOnly; SameSite=Lax; Max-Age=600${APP_URL.startsWith('https') ? '; Secure' : ''}`);
  const url = oauth.generateAuthUrl({
    scope: ['openid', 'email', 'profile'],
    state,
    prompt: 'select_account',
    ...(ALLOWED_DOMAINS.length === 1 ? { hd: ALLOWED_DOMAINS[0] } : {}),
  });
  res.redirect(302, url);
});

// GET /auth/google/callback - Google redirects here with ?code&state
router.get('/callback', async (req: Request, res: Response) => {
  if (!oauth) {
    res.status(404).json({ error: 'Google sign-in is not configured' });
    return;
  }
  try {
    const { code, state, error } = req.query as Record<string, string | undefined>;
    if (error) return finish(res, { error: 'Google sign-in was cancelled' });
    if (!code || !state) return finish(res, { error: 'Google sign-in failed' });

    // State must be ours, fresh, and bound to this browser (login-CSRF protection)
    let payload: { nonce?: string; purpose?: string };
    try {
      payload = jwt.verify(state, JWT_SECRET, { algorithms: ['HS256'] }) as typeof payload;
    } catch {
      return finish(res, { error: 'Sign-in link expired, please try again' });
    }
    const cookieNonce = readCookie(req, STATE_COOKIE);
    const digest = (v: string) => crypto.createHash('sha256').update(v).digest();
    if (payload.purpose !== 'google-oauth' || !payload.nonce || !cookieNonce ||
        !crypto.timingSafeEqual(digest(payload.nonce), digest(cookieNonce))) {
      return finish(res, { error: 'Sign-in could not be verified, please try again' });
    }

    const { tokens } = await oauth.getToken(code);
    if (!tokens.id_token) return finish(res, { error: 'Google sign-in failed' });
    const ticket = await oauth.verifyIdToken({ idToken: tokens.id_token, audience: CLIENT_ID });
    const claims = ticket.getPayload();
    if (!claims?.email || !claims.email_verified) {
      return finish(res, { error: 'Your Google account has no verified email address' });
    }

    const email = claims.email.toLowerCase();
    let user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, role: true, deactivatedAt: true, tokenVersion: true },
    });

    if (user?.deactivatedAt) {
      return finish(res, { error: 'This account has been deactivated' });
    }

    if (!user) {
      const domain = email.split('@')[1];
      const allowed = ALLOWED_DOMAINS.includes(domain) && (!claims.hd || claims.hd.toLowerCase() === domain);
      if (!allowed) {
        return finish(res, { error: 'No account for this email. Ask an admin for an invite link.' });
      }
      // Random, unusable password: the account signs in with Google
      const password = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
      user = await prisma.user.create({
        data: {
          email,
          name: (claims.name || email.split('@')[0]).slice(0, 100),
          password,
          role: 'MEMBER',
        },
        select: { id: true, role: true, deactivatedAt: true, tokenVersion: true },
      });
      await joinDefaultChannels(user.id, user.role);
    }

    const token = jwt.sign({ userId: user.id, tokenVersion: user.tokenVersion }, JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: '7d',
    });
    return finish(res, { token });
  } catch (err) {
    logError('Google sign-in error', err);
    return finish(res, { error: 'Google sign-in failed' });
  }
});

export default router;
