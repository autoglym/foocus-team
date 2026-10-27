import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { formatDistanceToNow, format } from 'date-fns';
import { ChevronRight, FileText, History, RotateCcw, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { getSocket } from '@/lib/socket';
import { useAuthStore } from '@/stores/useAuthStore';
import { useSocketEvent } from '@/hooks/useSocketEvent';
import { channelDisplayName } from '@/lib/channelName';
import {
  getDocument, getVersion, getVersions, restoreVersion, saveDocument, trashDocument, uploadLibraryFile,
  type Blocks, type DocDetail, type DocVersion,
} from '@/lib/documents';

const BlockEditor = lazy(() => import('./BlockEditor'));

const SAVE_DELAY_MS = 1000;
const PRESENCE_HEARTBEAT_MS = 15_000;
const PRESENCE_EXPIRY_MS = 45_000;

type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error';

function EditorFallback() {
  return <div className="px-2 py-6 text-[14px] text-slack-hint">Loading editor…</div>;
}

export function DocumentPage() {
  const { channelId: channelParam, documentId: documentParam } = useParams();
  const channelId = Number(channelParam);
  const documentId = Number(documentParam);
  const navigate = useNavigate();
  const me = useAuthStore((s) => s.user?.id);

  const [doc, setDoc] = useState<DocDetail | null>(null);
  const [loadError, setLoadError] = useState('');
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [editorKey, setEditorKey] = useState(0);
  const [remoteUpdate, setRemoteUpdate] = useState<string | null>(null);
  const [editors, setEditors] = useState<Record<number, { name: string; at: number }>>({});
  const [showHistory, setShowHistory] = useState(false);

  const pending = useRef<{ title?: string; content?: Blocks }>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastAnnounce = useRef(0);
  const editorsRef = useRef(editors);
  editorsRef.current = editors;

  const load = useCallback(async () => {
    const d = await getDocument(documentId);
    setDoc(d);
    setTitle(d.title);
    setEditorKey((k) => k + 1);
    setRemoteUpdate(null);
    setStatus('saved');
  }, [documentId]);

  useEffect(() => {
    setDoc(null);
    setLoadError('');
    load().catch((err) => setLoadError(err instanceof Error ? err.message : 'Could not open the document'));
  }, [load]);

  const flush = useCallback(async () => {
    clearTimeout(saveTimer.current);
    const data = pending.current;
    if (data.title === undefined && data.content === undefined) return;
    pending.current = {};
    setStatus('saving');
    try {
      await saveDocument(documentId, data);
      setStatus(pending.current.title !== undefined || pending.current.content !== undefined ? 'unsaved' : 'saved');
    } catch {
      pending.current = { ...data, ...pending.current };
      setStatus('error');
    }
  }, [documentId]);

  const announceEditing = useCallback(() => {
    const now = Date.now();
    if (now - lastAnnounce.current < PRESENCE_HEARTBEAT_MS) return;
    lastAnnounce.current = now;
    getSocket()?.emit('document:editing', { documentId, editing: true });
  }, [documentId]);

  const schedule = useCallback((patch: { title?: string; content?: Blocks }) => {
    pending.current = { ...pending.current, ...patch };
    setStatus('unsaved');
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, SAVE_DELAY_MS);
    announceEditing();
  }, [flush, announceEditing]);

  // Save on leave; warn before closing the tab with unsaved changes
  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === 'hidden') void flush(); };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (pending.current.title !== undefined || pending.current.content !== undefined) {
        void flush();
        e.preventDefault();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeunload', onBeforeUnload);
      void flush();
      if (lastAnnounce.current) getSocket()?.emit('document:editing', { documentId, editing: false });
      lastAnnounce.current = 0;
    };
  }, [flush, documentId]);

  // Live: who else is editing, and saves made by others
  useSocketEvent<{ documentId: number; userId: number; name: string; editing: boolean }>('document:editing', (data) => {
    if (data.documentId !== documentId || data.userId === me) return;
    setEditors((prev) => {
      const next = { ...prev };
      if (data.editing) next[data.userId] = { name: data.name, at: Date.now() };
      else delete next[data.userId];
      return next;
    });
  });
  useSocketEvent<{ documentId: number; updatedBy: number }>('document:updated', (data) => {
    if (data.documentId !== documentId || data.updatedBy === me) return;
    setRemoteUpdate(editorsRef.current[data.updatedBy]?.name ?? 'A teammate');
  });
  useEffect(() => {
    const prune = setInterval(() => {
      setEditors((prev) => {
        const fresh = Object.fromEntries(Object.entries(prev).filter(([, v]) => Date.now() - v.at < PRESENCE_EXPIRY_MS));
        return Object.keys(fresh).length === Object.keys(prev).length ? prev : fresh;
      });
    }, 10_000);
    return () => clearInterval(prune);
  }, []);

  const uploadFile = useCallback(async (file: File) => {
    const uploaded = await uploadLibraryFile(file, channelId, doc?.folderId ?? null);
    return uploaded.url;
  }, [channelId, doc?.folderId]);

  const handleTrash = async () => {
    if (!window.confirm('Move this document to the trash? It can be restored from the trash.')) return;
    await trashDocument(documentId);
    navigate(`/c/${channelId}/docs${doc?.folderId ? `?folder=${doc.folderId}` : ''}`);
  };

  if (loadError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-slack-surface text-slack-secondary">
        <FileText className="h-8 w-8 text-slack-hint" />
        <p>{loadError === 'Not found' || loadError === 'Document not found' ? 'This document doesn’t exist or you don’t have access to it.' : loadError}</p>
        <Button variant="ghost" onClick={() => navigate(`/c/${channelId}/docs`)}>Back to documents</Button>
      </div>
    );
  }

  const readOnly = doc?.readOnly ?? true;
  const otherEditors = Object.entries(editors);
  const statusText = { saved: 'Saved', unsaved: 'Unsaved changes', saving: 'Saving…', error: 'Could not save — retrying when you type' }[status];

  return (
    <div className="flex h-full min-h-0 flex-1 bg-slack-canvas">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar: where the document lives, who's here, save state */}
        <header className="relative z-10 flex h-[52px] flex-shrink-0 items-center gap-3 px-5 shadow-[0_1px_0_rgba(15,17,24,0.06)]">
          <nav className="flex min-w-0 items-center gap-1 text-[13px] text-slack-secondary" aria-label="Breadcrumb">
            {doc && (
              <>
                <Link to={`/c/${channelId}`} className="truncate rounded-md px-1.5 py-0.5 hover:bg-slack-hover">
                  {channelDisplayName(doc.channel, true)}
                </Link>
                <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-slack-hint" />
                <Link to={`/c/${channelId}/docs`} className="rounded-md px-1.5 py-0.5 hover:bg-slack-hover">Docs</Link>
                {doc.breadcrumb.map((f) => (
                  <span key={f.id} className="flex items-center gap-1">
                    <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-slack-hint" />
                    <Link to={`/c/${channelId}/docs?folder=${f.id}`} className="truncate rounded-md px-1.5 py-0.5 hover:bg-slack-hover">{f.name}</Link>
                  </span>
                ))}
              </>
            )}
          </nav>

          <div className="ml-auto flex flex-shrink-0 items-center gap-2">
            {otherEditors.length > 0 && (
              <span data-testid="doc-editing-presence" className="flex items-center gap-1.5 rounded-full surface-well-sm px-2.5 py-1 text-[12px] text-slack-link">
                <span className="h-2 w-2 animate-pulse rounded-full bg-[#1F8854]" />
                {otherEditors.map(([, v]) => v.name).join(', ')} {otherEditors.length === 1 ? 'is' : 'are'} editing
              </span>
            )}
            {!readOnly && (
              <span data-testid="doc-save-status" className={cn('text-[12px]', status === 'error' ? 'text-slack-error' : 'text-slack-hint')}>
                {statusText}
              </span>
            )}
            <Button variant="ghost" size="sm" onClick={() => setShowHistory(!showHistory)} aria-pressed={showHistory}>
              <History className="mr-1.5 h-4 w-4" /> History
            </Button>
            {!readOnly && (
              <Button variant="ghost" size="icon-sm" onClick={handleTrash} title="Move to trash" aria-label="Move to trash">
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[880px] px-6 pb-16 pt-8">
            {remoteUpdate && (
              <div className="mb-4 flex items-center gap-3 rounded-2xl surface-well-sm px-4 py-2.5 text-[14px] text-slack-primary" role="status">
                <span>{remoteUpdate} saved a newer version.</span>
                <Button size="sm" className="ml-auto" onClick={() => load()}>Load latest</Button>
              </div>
            )}

            {doc ? (
              <>
                <input
                  data-testid="doc-title"
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value.slice(0, 200));
                    if (e.target.value.trim()) schedule({ title: e.target.value.slice(0, 200).trim() });
                  }}
                  readOnly={readOnly}
                  placeholder="Untitled"
                  aria-label="Document title"
                  className="w-full bg-transparent font-heading text-[34px] font-bold leading-tight tracking-tight text-slack-primary outline-none placeholder:text-slack-disabled"
                />
                <p className="mb-5 mt-1 flex items-center gap-1.5 text-[13px] text-slack-hint">
                  <Avatar src={doc.updater.avatar ?? undefined} alt={doc.updater.name} fallback={doc.updater.name} size="sm" className="h-4 w-4" />
                  Last edited by {doc.updater.name} · {formatDistanceToNow(new Date(doc.updatedAt), { addSuffix: true })}
                  {readOnly && <span className="ml-2 rounded-full surface-well-sm px-2 py-0.5 text-[11px]">Read-only</span>}
                </p>

                <div className="min-h-[60vh] rounded-[28px] surface-card px-4 py-6 md:px-8">
                  <Suspense fallback={<EditorFallback />}>
                    <BlockEditor
                      key={editorKey}
                      initialContent={doc.content}
                      editable={!readOnly}
                      uploadFile={readOnly ? undefined : uploadFile}
                      onChange={(blocks) => schedule({ content: blocks })}
                    />
                  </Suspense>
                </div>
              </>
            ) : (
              <EditorFallback />
            )}
          </div>
        </div>
      </div>

      {showHistory && doc && (
        <VersionHistory
          documentId={documentId}
          readOnly={readOnly}
          onClose={() => setShowHistory(false)}
          onRestored={async () => {
            pending.current = {};
            await load();
          }}
        />
      )}
    </div>
  );
}

function VersionHistory({ documentId, readOnly, onClose, onRestored }: {
  documentId: number;
  readOnly: boolean;
  onClose: () => void;
  onRestored: () => Promise<void>;
}) {
  const [versions, setVersions] = useState<DocVersion[] | null>(null);
  const [preview, setPreview] = useState<(DocVersion & { content: Blocks }) | null>(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    getVersions(documentId).then(setVersions).catch(() => setVersions([]));
  }, [documentId]);

  const handleRestore = async () => {
    if (!preview) return;
    setRestoring(true);
    try {
      await restoreVersion(documentId, preview.id);
      setPreview(null);
      await onRestored();
      setVersions(await getVersions(documentId));
    } finally {
      setRestoring(false);
    }
  };

  return (
    <aside className="flex w-[320px] flex-shrink-0 flex-col border-l border-slack-border/70 bg-slack-surface" aria-label="Version history">
      <div className="flex h-[52px] items-center justify-between px-4">
        <h2 className="font-heading text-[16px] font-bold text-slack-primary">Version history</h2>
        <Button variant="toolbar" size="icon-sm" onClick={onClose} aria-label="Close history"><X className="h-4 w-4" /></Button>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-4">
        {versions === null && <p className="px-2 text-[13px] text-slack-hint">Loading…</p>}
        {versions?.map((v, i) => (
          <button
            key={v.id}
            onClick={() => getVersion(documentId, v.id).then(setPreview)}
            className={cn(
              'flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-all',
              preview?.id === v.id ? 'surface-well-sm' : 'hover:bg-slack-hover'
            )}
          >
            <Avatar src={v.author.avatar ?? undefined} alt={v.author.name} fallback={v.author.name} size="sm" className="h-7 w-7" />
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-slack-primary">
                {format(new Date(v.createdAt), 'd MMM yyyy, HH:mm')}{i === 0 && <span className="ml-1.5 text-slack-hint">(current)</span>}
              </span>
              <span className="block truncate text-[12px] text-slack-hint">{v.author.name}</span>
            </span>
          </button>
        ))}
      </div>

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onMouseDown={() => setPreview(null)}>
          <div className="flex max-h-[85vh] w-full max-w-[820px] flex-col rounded-[28px] surface-dialog" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 px-6 pt-5">
              <div className="min-w-0">
                <h3 className="truncate font-heading text-[20px] font-bold text-slack-primary">{preview.title}</h3>
                <p className="text-[13px] text-slack-hint">{format(new Date(preview.createdAt), 'd MMM yyyy, HH:mm')} · {preview.author.name}</p>
              </div>
              <div className="ml-auto flex gap-2">
                <Button variant="ghost" onClick={() => setPreview(null)}>Close</Button>
                {!readOnly && (
                  <Button onClick={handleRestore} disabled={restoring}>
                    <RotateCcw className="mr-1.5 h-4 w-4" /> {restoring ? 'Restoring…' : 'Restore this version'}
                  </Button>
                )}
              </div>
            </div>
            <div className="m-4 min-h-0 overflow-y-auto rounded-2xl surface-well px-4 py-5">
              <Suspense fallback={<EditorFallback />}>
                <BlockEditor key={preview.id} initialContent={preview.content} editable={false} />
              </Suspense>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
