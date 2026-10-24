import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';

interface Preview {
  url: string;
  title: string;
  description: string | null;
  image: string | null;
  siteName: string;
}

// Same URL rules as renderMessageContent: [text](url) and bare http(s) URLs
const URL_PATTERN = /\[[^\]]+\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"'\])]+)/g;

const GOOGLE_DOC = /^https:\/\/docs\.google\.com\/(presentation|document|spreadsheets)\/d\/([a-zA-Z0-9_-]{10,})/;
const GOOGLE_KIND = {
  presentation: { label: 'Google Slides', embed: (id: string) => `https://docs.google.com/presentation/d/${id}/embed?start=false&loop=false&delayms=3000`, ratio: 'aspect-video' },
  document: { label: 'Google Docs', embed: (id: string) => `https://docs.google.com/document/d/${id}/preview`, ratio: 'h-[420px]' },
  spreadsheets: { label: 'Google Sheets', embed: (id: string) => `https://docs.google.com/spreadsheets/d/${id}/preview`, ratio: 'h-[360px]' },
} as const;

// One request per URL per session, shared between messages
const previewCache = new Map<string, Promise<Preview | null>>();

function fetchPreview(url: string): Promise<Preview | null> {
  let pending = previewCache.get(url);
  if (!pending) {
    const token = localStorage.getItem('token');
    pending = fetch(`/unfurl?url=${encodeURIComponent(url)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => (res.status === 200 ? (res.json() as Promise<Preview>) : null))
      .catch(() => null);
    previewCache.set(url, pending);
  }
  return pending;
}

/** First previewable URL in a message, skipping links back into this app. */
export function firstPreviewUrl(content: string): string | null {
  for (const m of content.matchAll(URL_PATTERN)) {
    const url = (m[1] ?? m[2]).replace(/[.,;:!?]+$/, '');
    try {
      if (new URL(url).origin === window.location.origin) continue;
    } catch {
      continue;
    }
    return url;
  }
  return null;
}

function GoogleEmbed({ url, kind, id }: { url: string; kind: keyof typeof GOOGLE_KIND; id: string }) {
  const [open, setOpen] = useState(true);
  const info = GOOGLE_KIND[kind];
  return (
    <div data-testid="google-embed" className="mt-2 max-w-[560px] overflow-hidden rounded-2xl neu-raised-sm">
      <div className="flex items-center gap-2 px-3 py-2 text-[13px]">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1 font-medium text-slack-primary"
          aria-expanded={open}
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {info.label}
        </button>
        <a href={url} target="_blank" rel="noopener noreferrer" className="ml-auto flex items-center gap-1 text-slack-link hover:underline">
          Open <ExternalLink className="h-3 w-3" />
        </a>
      </div>
      {open && (
        <iframe
          src={info.embed(id)}
          title={info.label}
          loading="lazy"
          allowFullScreen
          className={`w-full border-0 border-t border-slack-border/60 bg-white ${info.ratio}`}
        />
      )}
    </div>
  );
}

function LinkCard({ url }: { url: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchPreview(url).then((p) => !cancelled && setPreview(p));
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!preview) return null;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="link-preview"
      className="mt-2 flex max-w-[560px] overflow-hidden rounded-2xl neu-raised-sm transition-shadow hover:shadow-[0_8px_24px_-8px_rgba(15,17,24,0.18)]"
    >
      <div className="min-w-0 flex-1 border-l-[3px] border-slack-btn px-3 py-2.5">
        <p className="text-[12px] text-slack-hint">{preview.siteName}</p>
        <p className="line-clamp-2 text-[14px] font-semibold leading-[19px] text-slack-link">{preview.title}</p>
        {preview.description && (
          <p className="mt-0.5 line-clamp-2 text-[13px] leading-[18px] text-slack-secondary">{preview.description}</p>
        )}
      </div>
      {preview.image && !imageFailed && (
        <img
          src={preview.image}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
          className="h-[88px] w-[120px] flex-shrink-0 self-center object-cover"
        />
      )}
    </a>
  );
}

export function LinkPreview({ content }: { content: string }) {
  const url = firstPreviewUrl(content);
  if (!url) return null;
  const google = url.match(GOOGLE_DOC);
  if (google) {
    return <GoogleEmbed url={url} kind={google[1] as keyof typeof GOOGLE_KIND} id={google[2]} />;
  }
  return <LinkCard url={url} />;
}
