import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { formatDistanceToNow, format } from 'date-fns';
import {
  ChevronRight, Download, FileText, Folder, FolderInput, FolderPlus, MoreHorizontal, Pencil, Plus,
  RotateCcw, Trash2, Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useSocketEvent } from '@/hooks/useSocketEvent';
import { getAuthFileUrl } from '@/lib/api';
import { formatBytes, FileIcon } from '@/lib/fileUtils';
import { DOC_TEMPLATES } from '@/lib/docTemplates';
import {
  createDocument, createFolder, deleteFolder, docPath, getAllFolders, getLibrary, getTrash, moveLibraryFile,
  restoreDocument, saveDocument, trashDocument, updateFolder, uploadLibraryFile,
  type DocSummary, type Library,
} from '@/lib/documents';

interface ChannelLibraryProps {
  channelId: number;
}

type MoveTarget = { kind: 'document' | 'file' | 'folder'; id: number; name: string };

export function ChannelLibrary({ channelId }: ChannelLibraryProps) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const folderId = params.get('folder') ? Number(params.get('folder')) : null;
  const showTrash = params.get('view') === 'trash';

  const [library, setLibrary] = useState<Library | null>(null);
  const [trash, setTrash] = useState<DocSummary[] | null>(null);
  const [error, setError] = useState('');
  const [newFolderName, setNewFolderName] = useState<string | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);
  const [moving, setMoving] = useState<MoveTarget | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      if (showTrash) setTrash(await getTrash(channelId));
      else setLibrary(await getLibrary(channelId, folderId));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load documents');
    }
  }, [channelId, folderId, showTrash]);

  useEffect(() => {
    setLibrary(null);
    void refresh();
  }, [refresh]);

  // Someone else added, moved or deleted something in this channel
  useSocketEvent<{ channelId: number }>('library:changed', (data) => {
    if (data.channelId === channelId) void refresh();
  });

  const openFolder = (id: number | null) => setParams(id ? { folder: String(id) } : {});
  const readOnly = library?.readOnly ?? false;

  const run = async (action: () => Promise<unknown>) => {
    try {
      setError('');
      await action();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  const handleNewDocument = async (templateId: string) => {
    setShowTemplates(false);
    const template = DOC_TEMPLATES.find((t) => t.id === templateId)!;
    const date = format(new Date(), 'd.M.yyyy');
    try {
      const doc = await createDocument(channelId, { title: template.title(date), folderId, content: template.content(date) });
      navigate(docPath(channelId, doc.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the document');
    }
  };

  const handleUpload = async (files: FileList | File[]) => {
    setUploading(true);
    try {
      for (const file of Array.from(files)) await uploadLibraryFile(file, channelId, folderId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const isEmpty = library && library.folders.length + library.documents.length + library.files.length === 0;

  return (
    <div
      className={cn('relative flex min-h-0 flex-1 flex-col bg-slack-surface', dragOver && 'ring-2 ring-inset ring-slack-btn/50')}
      onDragOver={(e) => { if (!readOnly && !showTrash && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false); }}
      onDrop={(e) => {
        if (readOnly || showTrash) return;
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length) void handleUpload(e.dataTransfer.files);
      }}
      data-testid="channel-library"
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 px-6 pb-3 pt-4">
        <nav className="flex min-w-0 items-center gap-1 text-[15px]" aria-label="Folder path">
          <button onClick={() => { setParams({}); }} className={cn('rounded-lg px-2 py-1 font-heading font-bold tracking-tight hover:bg-slack-hover', !folderId && !showTrash ? 'text-slack-primary' : 'text-slack-secondary')}>
            Docs
          </button>
          {showTrash && (
            <><ChevronRight className="h-4 w-4 text-slack-hint" /><span className="px-2 py-1 font-heading font-bold text-slack-primary">Trash</span></>
          )}
          {!showTrash && library?.breadcrumb.map((f, i) => (
            <span key={f.id} className="flex min-w-0 items-center gap-1">
              <ChevronRight className="h-4 w-4 flex-shrink-0 text-slack-hint" />
              {i === library.breadcrumb.length - 1 && !readOnly ? (
                // Current folder: click the name to rename it
                renaming?.id === f.id ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const name = renaming.name.trim();
                      if (!name || name === f.name) return setRenaming(null);
                      void run(() => updateFolder(f.id, { name })).then(() => setRenaming(null));
                    }}
                  >
                    <input
                      autoFocus
                      data-testid="folder-title-input"
                      value={renaming.name}
                      onChange={(e) => setRenaming({ id: f.id, name: e.target.value.slice(0, 120) })}
                      onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)}
                      onBlur={(e) => e.currentTarget.form?.requestSubmit()}
                      onFocus={(e) => e.currentTarget.select()}
                      aria-label="Folder name"
                      size={Math.max(renaming.name.length, 6)}
                      className="rounded-lg neu-inset-sm px-2 py-1 font-heading text-[15px] font-bold tracking-tight text-slack-primary outline-none"
                    />
                  </form>
                ) : (
                  <button
                    data-testid="folder-title"
                    onClick={() => setRenaming({ id: f.id, name: f.name })}
                    title="Click to rename"
                    className="group flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1 font-heading font-bold tracking-tight text-slack-primary hover:bg-slack-hover"
                  >
                    <span className="truncate">{f.name}</span>
                    <Pencil className="h-3.5 w-3.5 flex-shrink-0 text-slack-hint opacity-0 transition-opacity group-hover:opacity-100" />
                  </button>
                )
              ) : (
                <button onClick={() => openFolder(f.id)} className={cn('truncate rounded-lg px-2 py-1 font-heading font-bold tracking-tight hover:bg-slack-hover', i === library.breadcrumb.length - 1 ? 'text-slack-primary' : 'text-slack-secondary')}>
                  {f.name}
                </button>
              )}
            </span>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {!showTrash && !readOnly && (
            <>
              <div className="relative">
                <Button data-testid="new-document" onClick={() => setShowTemplates(!showTemplates)}>
                  <Plus className="mr-1 h-4 w-4" /> New document
                </Button>
                {showTemplates && (
                  <div className="absolute right-0 top-11 z-30 w-[300px] space-y-1 rounded-2xl neu-raised p-2" role="menu">
                    {DOC_TEMPLATES.map((t) => (
                      <button
                        key={t.id}
                        role="menuitem"
                        data-testid={`template-${t.id}`}
                        onClick={() => handleNewDocument(t.id)}
                        className="flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left hover:neu-raised-sm"
                      >
                        <FileText className="mt-0.5 h-4 w-4 flex-shrink-0 text-slack-btn" />
                        <span>
                          <span className="block text-[14px] font-medium text-slack-primary">{t.name}</span>
                          <span className="block text-[12px] text-slack-hint">{t.description}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Button variant="ghost" onClick={() => setNewFolderName('')} data-testid="new-folder">
                <FolderPlus className="mr-1.5 h-4 w-4" /> Folder
              </Button>
              <Button variant="ghost" onClick={() => fileInput.current?.click()} disabled={uploading}>
                <Upload className="mr-1.5 h-4 w-4" /> {uploading ? 'Uploading…' : 'Upload'}
              </Button>
              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                accept="image/*,audio/*,video/*,.pdf,.txt,.json,.zip"
                onChange={(e) => { if (e.target.files?.length) void handleUpload(e.target.files); e.target.value = ''; }}
              />
            </>
          )}
          <Button variant="ghost" size="icon-sm" title={showTrash ? 'Back to documents' : 'Trash'} aria-label="Trash"
            onClick={() => setParams(showTrash ? {} : { view: 'trash' })} className={showTrash ? 'neu-inset-sm' : ''}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {error && <p className="mx-6 mb-2 rounded-xl bg-slack-error-bg px-3 py-2 text-[13px] text-slack-error" role="alert">{error}</p>}

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8" onClick={() => { setMenuFor(null); setShowTemplates(false); }}>
        {showTrash ? (
          <TrashList trash={trash} onRestore={(id) => run(() => restoreDocument(id))} />
        ) : !library ? (
          <p className="py-6 text-[14px] text-slack-hint">Loading…</p>
        ) : (
          <div className="space-y-2.5">
            {newFolderName !== null && (
              <form
                className="flex items-center gap-3 rounded-2xl neu-inset px-4 py-2.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = newFolderName.trim();
                  if (!name) return;
                  void run(() => createFolder(channelId, name, folderId)).then(() => setNewFolderName(null));
                }}
              >
                <Folder className="h-5 w-5 text-[#D4A93A]" />
                <input
                  autoFocus
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value.slice(0, 120))}
                  onKeyDown={(e) => e.key === 'Escape' && setNewFolderName(null)}
                  placeholder="Folder name"
                  aria-label="Folder name"
                  className="flex-1 bg-transparent text-[15px] outline-none"
                />
                <Button size="sm" type="submit" disabled={!newFolderName.trim()}>Create</Button>
                <Button size="sm" variant="ghost" type="button" onClick={() => setNewFolderName(null)}>Cancel</Button>
              </form>
            )}

            {library.folders.map((f) => (
              <Row
                key={`folder-${f.id}`}
                icon={<Folder className="h-5 w-5 fill-[#ECC45A]/30 text-[#D4A93A]" />}
                onOpen={() => openFolder(f.id)}
                title={renaming?.id === f.id ? (
                  <form onSubmit={(e) => { e.preventDefault(); const name = renaming.name.trim(); if (name) void run(() => updateFolder(f.id, { name })).then(() => setRenaming(null)); }}
                    onClick={(e) => e.stopPropagation()}>
                    <input autoFocus value={renaming.name} onChange={(e) => setRenaming({ id: f.id, name: e.target.value.slice(0, 120) })}
                      onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)} onBlur={() => setRenaming(null)}
                      aria-label="Folder name" className="w-full rounded-lg neu-inset-sm px-2 py-0.5 text-[15px] outline-none" />
                  </form>
                ) : f.name}
                meta={`${f._count.documents} ${f._count.documents === 1 ? 'document' : 'documents'} · ${f._count.files} ${f._count.files === 1 ? 'file' : 'files'}${f._count.children ? ` · ${f._count.children} ${f._count.children === 1 ? 'folder' : 'folders'}` : ''}`}
                menuOpen={menuFor === `folder-${f.id}`}
                onMenu={readOnly ? undefined : () => setMenuFor(menuFor === `folder-${f.id}` ? null : `folder-${f.id}`)}
                actions={[
                  { label: 'Rename', icon: Pencil, onClick: () => setRenaming({ id: f.id, name: f.name }) },
                  { label: 'Move to…', icon: FolderInput, onClick: () => setMoving({ kind: 'folder', id: f.id, name: f.name }) },
                  { label: 'Delete folder', icon: Trash2, danger: true, onClick: () => run(() => deleteFolder(f.id)) },
                ]}
              />
            ))}

            {library.documents.map((d) => (
              <Row
                key={`doc-${d.id}`}
                testId="library-document"
                icon={<FileText className="h-5 w-5 text-slack-btn" />}
                href={docPath(channelId, d.id)}
                title={d.title}
                meta={`Edited by ${d.updater.name} · ${formatDistanceToNow(new Date(d.updatedAt), { addSuffix: true })}`}
                menuOpen={menuFor === `doc-${d.id}`}
                onMenu={readOnly ? undefined : () => setMenuFor(menuFor === `doc-${d.id}` ? null : `doc-${d.id}`)}
                actions={[
                  { label: 'Move to…', icon: FolderInput, onClick: () => setMoving({ kind: 'document', id: d.id, name: d.title }) },
                  { label: 'Move to trash', icon: Trash2, danger: true, onClick: () => run(() => trashDocument(d.id)) },
                ]}
              />
            ))}

            {library.files.map((f) => (
              <Row
                key={`file-${f.id}`}
                icon={<FileIcon mimetype={f.mimetype} />}
                externalHref={getAuthFileUrl(`/files/${f.id}/download`)}
                title={f.originalName}
                meta={`${formatBytes(f.size)} · ${f.user.name} · ${formatDistanceToNow(new Date(f.createdAt), { addSuffix: true })}`}
                menuOpen={menuFor === `file-${f.id}`}
                onMenu={() => setMenuFor(menuFor === `file-${f.id}` ? null : `file-${f.id}`)}
                actions={[
                  { label: 'Download', icon: Download, onClick: () => { window.location.href = getAuthFileUrl(`/files/${f.id}/download`, { download: true }); } },
                  ...(readOnly ? [] : [{ label: 'Move to…', icon: FolderInput, onClick: () => setMoving({ kind: 'file', id: f.id, name: f.originalName }) }]),
                ]}
              />
            ))}

            {isEmpty && newFolderName === null && (
              <div className="flex flex-col items-center gap-2 rounded-[28px] neu-inset px-6 py-14 text-center">
                <FileText className="h-8 w-8 text-slack-hint" />
                <p className="font-heading text-[17px] font-bold text-slack-primary">{folderId ? 'This folder is empty' : 'No documents yet'}</p>
                <p className="max-w-[380px] text-[14px] text-slack-secondary">
                  {readOnly ? 'This channel is archived.' : 'Create a document from a template, add a folder, or drop files here. Everyone in the channel can see them.'}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {moving && (
        <MoveDialog
          channelId={channelId}
          target={moving}
          currentFolderId={folderId}
          onClose={() => setMoving(null)}
          onMove={(destination) => run(async () => {
            if (moving.kind === 'document') await saveDocument(moving.id, { folderId: destination });
            else if (moving.kind === 'file') await moveLibraryFile(moving.id, destination);
            else await updateFolder(moving.id, { parentId: destination });
            setMoving(null);
          })}
        />
      )}
    </div>
  );
}

interface RowAction { label: string; icon: typeof Pencil; onClick: () => void; danger?: boolean }

function Row({ icon, title, meta, href, externalHref, onOpen, onMenu, menuOpen, actions, testId }: {
  icon: React.ReactNode;
  title: React.ReactNode;
  meta: string;
  href?: string;
  externalHref?: string;
  onOpen?: () => void;
  onMenu?: () => void;
  menuOpen: boolean;
  actions: RowAction[];
  testId?: string;
}) {
  const body = (
    <>
      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl neu-inset-sm">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium text-slack-primary">{title}</span>
        <span className="block truncate text-[12px] text-slack-hint">{meta}</span>
      </span>
    </>
  );
  const rowClass = 'flex min-w-0 flex-1 items-center gap-3 text-left';
  return (
    <div data-testid={testId} className="relative flex items-center gap-2 rounded-2xl neu-raised-sm px-3 py-2.5 transition-shadow hover:shadow-[6px_6px_14px_var(--neu-dark),-6px_-6px_14px_var(--neu-light)]">
      {href ? <Link to={href} className={rowClass}>{body}</Link>
        : externalHref ? <a href={externalHref} target="_blank" rel="noopener noreferrer" className={rowClass}>{body}</a>
        : <button type="button" onClick={onOpen} className={rowClass}>{body}</button>}
      {onMenu && actions.length > 0 && (
        <Button variant="toolbar" size="icon-sm" aria-label="More actions" onClick={(e) => { e.stopPropagation(); onMenu(); }}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      )}
      {menuOpen && (
        <div className="absolute right-2 top-12 z-20 w-[190px] rounded-2xl neu-raised p-1.5" role="menu" onClick={(e) => e.stopPropagation()}>
          {actions.map((a) => (
            <button key={a.label} role="menuitem" onClick={() => { onMenu?.(); a.onClick(); }}
              className={cn('flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left text-[14px] hover:neu-raised-sm', a.danger ? 'text-slack-error' : 'text-slack-primary')}>
              <a.icon className="h-4 w-4" /> {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TrashList({ trash, onRestore }: { trash: DocSummary[] | null; onRestore: (id: number) => void }) {
  if (!trash) return <p className="py-6 text-[14px] text-slack-hint">Loading…</p>;
  if (trash.length === 0) {
    return <p className="rounded-[28px] neu-inset px-6 py-12 text-center text-[14px] text-slack-secondary">The trash is empty.</p>;
  }
  return (
    <div className="space-y-2.5">
      {trash.map((d) => (
        <div key={d.id} className="flex items-center gap-3 rounded-2xl neu-raised-sm px-3 py-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl neu-inset-sm"><FileText className="h-5 w-5 text-slack-hint" /></span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-medium text-slack-primary">{d.title}</span>
            <span className="block text-[12px] text-slack-hint">Deleted {d.deletedAt ? formatDistanceToNow(new Date(d.deletedAt), { addSuffix: true }) : ''}</span>
          </span>
          <Button size="sm" variant="ghost" onClick={() => onRestore(d.id)}><RotateCcw className="mr-1.5 h-4 w-4" /> Restore</Button>
        </div>
      ))}
    </div>
  );
}

function MoveDialog({ channelId, target, currentFolderId, onClose, onMove }: {
  channelId: number;
  target: MoveTarget;
  currentFolderId: number | null;
  onClose: () => void;
  onMove: (folderId: number | null) => void;
}) {
  const [folders, setFolders] = useState<Array<{ id: number; name: string; parentId: number | null }> | null>(null);
  useEffect(() => { getAllFolders(channelId).then(setFolders).catch(() => setFolders([])); }, [channelId]);

  // Depth-first tree; a folder can't be moved into itself or its descendants
  const rows = useMemo(() => {
    if (!folders) return [];
    const out: Array<{ id: number; name: string; depth: number }> = [];
    const walk = (parentId: number | null, depth: number) => {
      for (const f of folders.filter((x) => x.parentId === parentId)) {
        if (target.kind === 'folder' && f.id === target.id) continue;
        out.push({ id: f.id, name: f.name, depth });
        walk(f.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [folders, target]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onMouseDown={onClose}>
      <div className="w-full max-w-[440px] rounded-[24px] neu-dialog p-6" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Move to folder">
        <h2 className="mb-1 font-heading text-[20px] font-bold text-slack-primary">Move “{target.name}”</h2>
        <p className="mb-4 text-[13px] text-slack-hint">Choose a folder in this channel.</p>
        <div className="max-h-[320px] space-y-1 overflow-y-auto rounded-2xl neu-inset p-2">
          <button onClick={() => onMove(null)} disabled={currentFolderId === null && target.kind !== 'folder'}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[14px] hover:neu-raised-sm disabled:opacity-50">
            <FileText className="h-4 w-4 text-slack-btn" /> Docs (top level)
          </button>
          {rows.map((r) => (
            <button key={r.id} onClick={() => onMove(r.id)} disabled={r.id === currentFolderId && target.kind !== 'folder'}
              style={{ paddingLeft: 12 + r.depth * 18 }}
              className="flex w-full items-center gap-2 rounded-xl py-2 pr-3 text-left text-[14px] hover:neu-raised-sm disabled:opacity-50">
              <Folder className="h-4 w-4 text-[#D4A93A]" /> {r.name}
            </button>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
