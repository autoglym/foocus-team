import dns from 'dns';
import http from 'http';
import https from 'https';
import net from 'net';

// Server-side link previews (Open Graph / <title>), with SSRF protection:
// only http(s) on ports 80/443, every resolved IP is checked at connect time
// (also after redirects), small response cap and a short timeout.

export interface LinkPreview {
  url: string;
  title: string;
  description: string | null;
  image: string | null;
  siteName: string;
}

const TIMEOUT_MS = 5_000;
const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_TTL_MISS_MS = 30 * 60 * 1000;
const CACHE_MAX = 1000;

const cache = new Map<string, { value: LinkPreview | null; expires: number }>();

/** True for loopback, private, link-local, CGNAT, multicast and other non-public ranges. */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return (
      lower === '::' || lower === '::1' ||
      lower.startsWith('fc') || lower.startsWith('fd') ||
      lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb') ||
      lower.startsWith('ff') || lower.startsWith('64:ff9b:')
    );
  }
  return true;
}

/** Rejects anything that isn't a public http(s) URL on the default ports. */
export function validatePublicUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.port && url.port !== '80' && url.port !== '443') return null;
  if (url.username || url.password) return null;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && isPrivateAddress(host)) return null;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return null;
  return url;
}

// DNS lookup that refuses to connect to non-public addresses (also defeats DNS rebinding,
// since the address that is checked is the one the socket connects to).
const safeLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { all: true }, (err, addresses) => {
    if (err) return callback(err, '', 0);
    if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
      return callback(new Error(`Blocked non-public address for ${hostname}`), '', 0);
    }
    if ((options as dns.LookupOptions).all) {
      return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, addresses);
    }
    callback(null, addresses[0].address, addresses[0].family);
  });
};

function fetchHtml(url: URL, redirectsLeft = MAX_REDIRECTS): Promise<{ html: string; finalUrl: URL } | null> {
  return new Promise((resolve) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.get(url, {
      lookup: safeLookup,
      timeout: TIMEOUT_MS,
      headers: {
        'User-Agent': 'FoocusTeamBot/1.0 (link preview)',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'nb,en;q=0.8',
      },
    }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location && redirectsLeft > 0) {
        res.resume();
        const next = validatePublicUrl(new URL(res.headers.location, url).toString());
        if (!next) return resolve(null);
        fetchHtml(next, redirectsLeft - 1).then(resolve);
        return;
      }
      const type = String(res.headers['content-type'] || '');
      if (status !== 200 || !type.includes('html')) {
        res.resume();
        return resolve(null);
      }
      const charset = type.match(/charset=([\w-]+)/i)?.[1]?.toLowerCase() || 'utf-8';
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        chunks.push(chunk);
        if (size >= MAX_BYTES) res.destroy();
      });
      const finish = () => {
        let decoder: TextDecoder;
        try {
          decoder = new TextDecoder(charset);
        } catch {
          decoder = new TextDecoder('utf-8');
        }
        resolve({ html: decoder.decode(Buffer.concat(chunks).subarray(0, MAX_BYTES)), finalUrl: url });
      };
      res.on('end', finish);
      res.on('close', finish);
      res.on('error', () => resolve(null));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

const clean = (text: string | undefined, max: number) =>
  text ? decodeEntities(text).replace(/\s+/g, ' ').trim().slice(0, max) || undefined : undefined;

/** Extracts Open Graph / Twitter / <title> metadata from an HTML document. */
export function parseMetadata(html: string, pageUrl: URL): LinkPreview | null {
  const head = html.slice(0, html.search(/<\/head>/i) > 0 ? html.search(/<\/head>/i) : html.length);
  const meta: Record<string, string> = {};
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs: Record<string, string> = {};
    for (const m of tag.matchAll(/([a-zA-Z:_-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
      attrs[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? '';
    }
    const key = (attrs.property || attrs.name || '').toLowerCase();
    if (key && attrs.content !== undefined && !(key in meta)) meta[key] = attrs.content;
  }
  const titleTag = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];

  const title = clean(meta['og:title'] || meta['twitter:title'] || titleTag, 200);
  if (!title) return null;

  let image: string | null = null;
  const rawImage = meta['og:image:secure_url'] || meta['og:image'] || meta['twitter:image'] || meta['twitter:image:src'];
  if (rawImage) {
    try {
      const resolved = new URL(decodeEntities(rawImage), pageUrl);
      if (resolved.protocol === 'https:') image = resolved.toString();
    } catch { /* ignore invalid image URL */ }
  }

  return {
    url: pageUrl.toString(),
    title,
    description: clean(meta['og:description'] || meta['twitter:description'] || meta['description'], 300) ?? null,
    image,
    siteName: clean(meta['og:site_name'], 80) ?? pageUrl.hostname.replace(/^www\./, ''),
  };
}

export async function getLinkPreview(rawUrl: string): Promise<LinkPreview | null> {
  const url = validatePublicUrl(rawUrl);
  if (!url) return null;
  const key = url.toString();

  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  const page = await fetchHtml(url);
  const value = page ? parseMetadata(page.html, page.finalUrl) : null;

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, { value, expires: Date.now() + (value ? CACHE_TTL_MS : CACHE_TTL_MISS_MS) });
  return value;
}
