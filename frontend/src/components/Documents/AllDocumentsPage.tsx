import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { FileText, Search } from 'lucide-react';
import { channelDisplayName } from '@/lib/channelName';
import { docPath, getAllDocuments, type DocSummary } from '@/lib/documents';

/** Every document the user can open, across all their channels. */
export function AllDocumentsPage() {
  const [query, setQuery] = useState('');
  const [docs, setDocs] = useState<DocSummary[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const handle = setTimeout(() => {
      getAllDocuments(query.trim())
        .then((d) => { setDocs(d); setError(''); })
        .catch((err) => setError(err instanceof Error ? err.message : 'Could not load documents'));
    }, query ? 250 : 0);
    return () => clearTimeout(handle);
  }, [query]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slack-canvas" data-testid="all-documents">
      <div className="flex flex-wrap items-center gap-4 px-6 pb-3 pt-5">
        <h1 className="font-heading text-[22px] font-bold tracking-tight text-slack-primary">Documents</h1>
        <label className="relative ml-auto w-full max-w-[340px]">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slack-hint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search titles and text…"
            aria-label="Search documents"
            className="h-10 w-full rounded-full surface-well pl-10 pr-4 text-[14px] outline-none focus:ring-2 focus:ring-slack-btn/40"
          />
        </label>
      </div>

      {error && <p className="mx-6 mb-2 text-[13px] text-slack-error" role="alert">{error}</p>}

      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-6 pb-8">
        {docs === null && <p className="py-6 text-[14px] text-slack-hint">Loading…</p>}
        {docs?.length === 0 && (
          <p className="rounded-[28px] surface-well px-6 py-12 text-center text-[14px] text-slack-secondary">
            {query ? 'No documents match your search.' : 'No documents yet. Open a channel and choose Docs to create one.'}
          </p>
        )}
        {docs?.map((d) => (
          <Link
            key={d.id}
            to={docPath(d.channelId, d.id)}
            className="flex items-center gap-3 rounded-2xl surface-card-sm px-3 py-2.5 transition-shadow hover:border-slack-border-dark hover:shadow-[var(--shadow-card-hover)]"
          >
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl surface-well-sm">
              <FileText className="h-5 w-5 text-slack-btn" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium text-slack-primary">{d.title}</span>
              <span className="block truncate text-[12px] text-slack-hint">
                {d.channel ? channelDisplayName(d.channel, true) : ''} · Edited by {d.updater.name} · {formatDistanceToNow(new Date(d.updatedAt), { addSuffix: true })}
              </span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
