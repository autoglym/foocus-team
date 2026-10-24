import { Router, Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { AuthRequest } from '../types.js';
import { getIO } from '../websocket/index.js';
import { USER_SELECT_BASIC, FILE_SELECT } from '../db/selects.js';
import { parseIntParam } from '../utils/params.js';
import { logError } from '../utils/logger.js';

// Folders and documents per channel. Access is the channel's: members can read
// and write, archived channels are read-only. Documents are soft-deleted (trash)
// and every save is kept in DocumentVersion (consecutive saves by the same person
// within VERSION_WINDOW_MS update one version instead of piling up).

const router = Router();

const VERSION_WINDOW_MS = 10 * 60 * 1000;
const MAX_CONTENT_BYTES = 1_500_000;

type Access = { ok: true; archived: boolean } | { ok: false; status: number; error: string };

async function channelAccess(userId: number, channelId: number): Promise<Access> {
  const [membership, channel] = await Promise.all([
    prisma.channelMember.findUnique({ where: { userId_channelId: { userId, channelId } } }),
    prisma.channel.findUnique({ where: { id: channelId }, select: { archivedAt: true } }),
  ]);
  // 404 rather than 403 so documents in other channels can't be enumerated
  if (!channel || !membership) return { ok: false, status: 404, error: 'Not found' };
  return { ok: true, archived: !!channel.archivedAt };
}

async function writeAccess(userId: number, channelId: number): Promise<Access> {
  const access = await channelAccess(userId, channelId);
  if (access.ok && access.archived) return { ok: false, status: 403, error: 'This channel has been archived' };
  return access;
}

function deny(res: Response, access: Extract<Access, { ok: false }>) {
  res.status(access.status).json({ error: access.error });
}

/** Plain text of a BlockNote document: every "text" leaf, one line per block. */
export function blocksToText(blocks: unknown): string {
  const lines: string[] = [];
  const inline = (node: unknown): string => {
    // Partial blocks (templates, API clients) may use a plain string as content
    if (typeof node === 'string') return node;
    if (!node || typeof node !== 'object') return '';
    if (Array.isArray(node)) return node.map(inline).join('');
    const n = node as Record<string, unknown>;
    if (typeof n.text === 'string') return n.text;
    // Links and other inline containers keep their text under `content`;
    // tables keep rows/cells under `rows`/`cells`
    if (n.type === 'tableContent' && Array.isArray(n.rows)) {
      return (n.rows as Array<{ cells?: unknown[] }>)
        .map((row) => (row.cells ?? []).map(inline).join(' | '))
        .join('\n');
    }
    return inline(n.content);
  };
  const walk = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const block of list) {
      if (!block || typeof block !== 'object') continue;
      const b = block as Record<string, unknown>;
      const text = inline(b.content).trim();
      if (text) lines.push(text);
      walk(b.children);
    }
  };
  walk(blocks);
  return lines.join('\n').slice(0, 500_000);
}

const blocksSchema = z.array(z.any()).refine(
  (blocks) => JSON.stringify(blocks).length <= MAX_CONTENT_BYTES,
  { message: 'Document is too large' },
);
const titleSchema = z.string().trim().min(1, 'Title is required').max(200, 'Title must be 200 characters or fewer');
const folderNameSchema = z.string().trim().min(1, 'Folder name is required').max(120, 'Folder name must be 120 characters or fewer')
  .refine((n) => !/[/\\]/.test(n), { message: 'Folder names cannot contain / or \\' });

async function folderInChannel(folderId: number | null | undefined, channelId: number) {
  if (folderId === null || folderId === undefined) return true;
  const folder = await prisma.folder.findUnique({ where: { id: folderId }, select: { channelId: true } });
  return folder?.channelId === channelId;
}

async function breadcrumb(folderId: number | null): Promise<Array<{ id: number; name: string }>> {
  const path: Array<{ id: number; name: string }> = [];
  let current = folderId;
  for (let depth = 0; current && depth < 50; depth++) {
    const folder: { id: number; name: string; parentId: number | null } | null = await prisma.folder.findUnique({
      where: { id: current },
      select: { id: true, name: true, parentId: true },
    });
    if (!folder) break;
    path.unshift({ id: folder.id, name: folder.name });
    current = folder.parentId;
  }
  return path;
}

function emit(channelId: number, event: string, payload: Record<string, unknown>) {
  getIO()?.to(`channel:${channelId}`).emit(event, { channelId, ...payload });
}

const DOC_LIST_SELECT = {
  id: true,
  title: true,
  channelId: true,
  folderId: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  creator: { select: USER_SELECT_BASIC },
  updater: { select: USER_SELECT_BASIC },
} as const;

// ── Library: folders, documents and files in one folder ─────────────

// GET /channels/:id/library?folderId=
router.get('/channels/:id/library', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const channelId = parseIntParam(req.params.id);
    if (!channelId) return void res.status(400).json({ error: 'Invalid channel ID' });
    const access = await channelAccess(req.user!.userId, channelId);
    if (!access.ok) return deny(res, access);

    const rawFolder = req.query.folderId ? parseIntParam(req.query.folderId as string) : null;
    if (req.query.folderId && !rawFolder) return void res.status(400).json({ error: 'Invalid folder ID' });
    if (!(await folderInChannel(rawFolder, channelId))) return void res.status(404).json({ error: 'Folder not found' });

    const [folders, documents, files, path] = await Promise.all([
      prisma.folder.findMany({
        where: { channelId, parentId: rawFolder },
        orderBy: { name: 'asc' },
        select: {
          id: true, name: true, parentId: true, updatedAt: true,
          _count: { select: { children: true, documents: { where: { deletedAt: null } }, files: true } },
        },
      }),
      prisma.document.findMany({
        where: { channelId, folderId: rawFolder, deletedAt: null },
        orderBy: { updatedAt: 'desc' },
        select: DOC_LIST_SELECT,
      }),
      prisma.file.findMany({
        where: { channelId, folderId: rawFolder, messageId: null },
        orderBy: { createdAt: 'desc' },
        select: { ...FILE_SELECT, createdAt: true, user: { select: USER_SELECT_BASIC } },
      }),
      breadcrumb(rawFolder),
    ]);

    res.json({ folderId: rawFolder, breadcrumb: path, readOnly: access.archived, folders, documents, files });
  } catch (error) {
    logError('Get library error', error);
    res.status(500).json({ error: 'Failed to load documents' });
  }
});

// ── Folders ──────────────────────────────────────────────────────────

// GET /channels/:id/folders - every folder in the channel (flat), for "Move to…"
router.get('/channels/:id/folders', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const channelId = parseIntParam(req.params.id);
    if (!channelId) return void res.status(400).json({ error: 'Invalid channel ID' });
    const access = await channelAccess(req.user!.userId, channelId);
    if (!access.ok) return deny(res, access);
    const folders = await prisma.folder.findMany({
      where: { channelId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, parentId: true },
    });
    res.json(folders);
  } catch (error) {
    logError('List folders error', error);
    res.status(500).json({ error: 'Failed to list folders' });
  }
});

const createFolderSchema = z.object({
  name: folderNameSchema,
  parentId: z.number().int().positive().nullable().optional(),
});

// POST /channels/:id/folders
router.post('/channels/:id/folders', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const channelId = parseIntParam(req.params.id);
    if (!channelId) return void res.status(400).json({ error: 'Invalid channel ID' });
    const access = await writeAccess(req.user!.userId, channelId);
    if (!access.ok) return deny(res, access);

    const parsed = createFolderSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0]?.message });
    const parentId = parsed.data.parentId ?? null;
    if (!(await folderInChannel(parentId, channelId))) return void res.status(404).json({ error: 'Folder not found' });

    const duplicate = await prisma.folder.findFirst({
      where: { channelId, parentId, name: { equals: parsed.data.name, mode: 'insensitive' } },
    });
    if (duplicate) return void res.status(409).json({ error: 'A folder with that name already exists here' });

    const folder = await prisma.folder.create({
      data: { channelId, parentId, name: parsed.data.name, createdBy: req.user!.userId },
    });
    emit(channelId, 'library:changed', { folderId: parentId });
    res.status(201).json(folder);
  } catch (error) {
    logError('Create folder error', error);
    res.status(500).json({ error: 'Failed to create folder' });
  }
});

const updateFolderSchema = z.object({
  name: folderNameSchema.optional(),
  parentId: z.number().int().positive().nullable().optional(),
}).refine((d) => d.name !== undefined || d.parentId !== undefined, { message: 'Nothing to update' });

// PATCH /folders/:id - rename and/or move
router.patch('/folders/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseIntParam(req.params.id);
    if (!id) return void res.status(400).json({ error: 'Invalid folder ID' });
    const folder = await prisma.folder.findUnique({ where: { id } });
    if (!folder) return void res.status(404).json({ error: 'Folder not found' });
    const access = await writeAccess(req.user!.userId, folder.channelId);
    if (!access.ok) return deny(res, access);

    const parsed = updateFolderSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0]?.message });

    const parentId = parsed.data.parentId === undefined ? folder.parentId : parsed.data.parentId;
    if (parsed.data.parentId !== undefined) {
      if (!(await folderInChannel(parentId, folder.channelId))) return void res.status(404).json({ error: 'Folder not found' });
      // A folder can't be moved into itself or one of its own subfolders
      const ancestors = await breadcrumb(parentId);
      if (parentId === id || ancestors.some((a) => a.id === id)) {
        return void res.status(400).json({ error: 'A folder cannot be moved into itself' });
      }
    }
    const name = parsed.data.name ?? folder.name;
    const duplicate = await prisma.folder.findFirst({
      where: { channelId: folder.channelId, parentId, id: { not: id }, name: { equals: name, mode: 'insensitive' } },
    });
    if (duplicate) return void res.status(409).json({ error: 'A folder with that name already exists here' });

    const updated = await prisma.folder.update({ where: { id }, data: { name, parentId } });
    emit(folder.channelId, 'library:changed', { folderId: parentId });
    res.json(updated);
  } catch (error) {
    logError('Update folder error', error);
    res.status(500).json({ error: 'Failed to update folder' });
  }
});

// DELETE /folders/:id - only empty folders (documents in the trash don't count)
router.delete('/folders/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseIntParam(req.params.id);
    if (!id) return void res.status(400).json({ error: 'Invalid folder ID' });
    const folder = await prisma.folder.findUnique({
      where: { id },
      include: { _count: { select: { children: true, files: true, documents: { where: { deletedAt: null } } } } },
    });
    if (!folder) return void res.status(404).json({ error: 'Folder not found' });
    const access = await writeAccess(req.user!.userId, folder.channelId);
    if (!access.ok) return deny(res, access);
    if (folder._count.children + folder._count.files + folder._count.documents > 0) {
      return void res.status(409).json({ error: 'Move or delete the contents first' });
    }
    await prisma.folder.delete({ where: { id } });
    emit(folder.channelId, 'library:changed', { folderId: folder.parentId });
    res.json({ message: 'Folder deleted' });
  } catch (error) {
    logError('Delete folder error', error);
    res.status(500).json({ error: 'Failed to delete folder' });
  }
});

// ── Documents ────────────────────────────────────────────────────────

const createDocumentSchema = z.object({
  title: titleSchema,
  folderId: z.number().int().positive().nullable().optional(),
  content: blocksSchema.optional(),
});

// POST /channels/:id/documents
router.post('/channels/:id/documents', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const channelId = parseIntParam(req.params.id);
    if (!channelId) return void res.status(400).json({ error: 'Invalid channel ID' });
    const userId = req.user!.userId;
    const access = await writeAccess(userId, channelId);
    if (!access.ok) return deny(res, access);

    const parsed = createDocumentSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0]?.message });
    const folderId = parsed.data.folderId ?? null;
    if (!(await folderInChannel(folderId, channelId))) return void res.status(404).json({ error: 'Folder not found' });

    const content = (parsed.data.content ?? []) as Prisma.InputJsonValue;
    const contentText = blocksToText(content);
    const document = await prisma.document.create({
      data: {
        channelId, folderId, title: parsed.data.title, content, contentText,
        createdBy: userId, updatedBy: userId,
        versions: { create: { title: parsed.data.title, content, contentText, createdBy: userId } },
      },
      select: DOC_LIST_SELECT,
    });
    emit(channelId, 'library:changed', { folderId });
    res.status(201).json(document);
  } catch (error) {
    logError('Create document error', error);
    res.status(500).json({ error: 'Failed to create document' });
  }
});

// GET /documents?q= - every document the user can open, newest first
router.get('/documents', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 200) : '';
    const documents = await prisma.document.findMany({
      where: {
        deletedAt: null,
        channel: { members: { some: { userId } } },
        ...(q ? { OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { contentText: { contains: q, mode: 'insensitive' } },
        ] } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      select: { ...DOC_LIST_SELECT, channel: { select: { id: true, name: true, isGroupDM: true } } },
    });
    res.json(documents);
  } catch (error) {
    logError('List documents error', error);
    res.status(500).json({ error: 'Failed to list documents' });
  }
});

async function loadDocument(req: AuthRequest, res: Response, opts: { write?: boolean; includeDeleted?: boolean } = {}) {
  const id = parseIntParam(req.params.id);
  if (!id) {
    res.status(400).json({ error: 'Invalid document ID' });
    return null;
  }
  const document = await prisma.document.findUnique({ where: { id } });
  if (!document || (document.deletedAt && !opts.includeDeleted)) {
    res.status(404).json({ error: 'Document not found' });
    return null;
  }
  const access = opts.write
    ? await writeAccess(req.user!.userId, document.channelId)
    : await channelAccess(req.user!.userId, document.channelId);
  if (!access.ok) {
    deny(res, access);
    return null;
  }
  return { document, readOnly: access.archived };
}

// GET /documents/:id
router.get('/documents/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const loaded = await loadDocument(req, res);
    if (!loaded) return;
    const { document, readOnly } = loaded;
    const [channel, creator, updater, path] = await Promise.all([
      prisma.channel.findUnique({ where: { id: document.channelId }, select: { id: true, name: true, isGroupDM: true } }),
      prisma.user.findUnique({ where: { id: document.createdBy }, select: USER_SELECT_BASIC }),
      prisma.user.findUnique({ where: { id: document.updatedBy }, select: USER_SELECT_BASIC }),
      breadcrumb(document.folderId),
    ]);
    const { contentText: _omit, ...rest } = document;
    res.json({ ...rest, channel, creator, updater, breadcrumb: path, readOnly });
  } catch (error) {
    logError('Get document error', error);
    res.status(500).json({ error: 'Failed to load document' });
  }
});

const updateDocumentSchema = z.object({
  title: titleSchema.optional(),
  content: blocksSchema.optional(),
  folderId: z.number().int().positive().nullable().optional(),
}).refine((d) => d.title !== undefined || d.content !== undefined || d.folderId !== undefined, { message: 'Nothing to update' });

// PUT /documents/:id - save (last write wins)
router.put('/documents/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const loaded = await loadDocument(req, res, { write: true });
    if (!loaded) return;
    const { document } = loaded;
    const userId = req.user!.userId;

    const parsed = updateDocumentSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0]?.message });
    if (parsed.data.folderId !== undefined && !(await folderInChannel(parsed.data.folderId, document.channelId))) {
      return void res.status(404).json({ error: 'Folder not found' });
    }

    const title = parsed.data.title ?? document.title;
    const content = (parsed.data.content ?? document.content) as Prisma.InputJsonValue;
    const contentText = parsed.data.content !== undefined ? blocksToText(content) : document.contentText;
    const contentChanged = parsed.data.content !== undefined || parsed.data.title !== undefined;

    const updated = await prisma.$transaction(async (tx) => {
      const doc = await tx.document.update({
        where: { id: document.id },
        data: {
          title, content, contentText, updatedBy: userId,
          ...(parsed.data.folderId !== undefined ? { folderId: parsed.data.folderId } : {}),
        },
        select: DOC_LIST_SELECT,
      });
      if (contentChanged) {
        const latest = await tx.documentVersion.findFirst({
          where: { documentId: document.id },
          orderBy: { createdAt: 'desc' },
        });
        if (latest && latest.createdBy === userId && Date.now() - latest.createdAt.getTime() < VERSION_WINDOW_MS) {
          await tx.documentVersion.update({ where: { id: latest.id }, data: { title, content, contentText } });
        } else {
          await tx.documentVersion.create({ data: { documentId: document.id, title, content, contentText, createdBy: userId } });
        }
      }
      return doc;
    });

    emit(document.channelId, 'document:updated', {
      documentId: document.id, updatedBy: userId, updatedAt: updated.updatedAt, title: updated.title,
    });
    if (parsed.data.folderId !== undefined || parsed.data.title !== undefined) {
      emit(document.channelId, 'library:changed', { folderId: updated.folderId });
    }
    res.json(updated);
  } catch (error) {
    logError('Save document error', error);
    res.status(500).json({ error: 'Failed to save document' });
  }
});

// DELETE /documents/:id - move to trash
router.delete('/documents/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const loaded = await loadDocument(req, res, { write: true });
    if (!loaded) return;
    await prisma.document.update({ where: { id: loaded.document.id }, data: { deletedAt: new Date() } });
    emit(loaded.document.channelId, 'library:changed', { folderId: loaded.document.folderId });
    res.json({ message: 'Moved to trash' });
  } catch (error) {
    logError('Delete document error', error);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

// POST /documents/:id/restore - restore from trash (to the root if its folder is gone)
router.post('/documents/:id/restore', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const loaded = await loadDocument(req, res, { write: true, includeDeleted: true });
    if (!loaded) return;
    const doc = await prisma.document.update({
      where: { id: loaded.document.id },
      data: { deletedAt: null },
      select: DOC_LIST_SELECT,
    });
    emit(loaded.document.channelId, 'library:changed', { folderId: doc.folderId });
    res.json(doc);
  } catch (error) {
    logError('Restore document error', error);
    res.status(500).json({ error: 'Failed to restore document' });
  }
});

// GET /channels/:id/trash - documents in the channel's trash
router.get('/channels/:id/trash', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const channelId = parseIntParam(req.params.id);
    if (!channelId) return void res.status(400).json({ error: 'Invalid channel ID' });
    const access = await channelAccess(req.user!.userId, channelId);
    if (!access.ok) return deny(res, access);
    const documents = await prisma.document.findMany({
      where: { channelId, deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
      select: DOC_LIST_SELECT,
    });
    res.json(documents);
  } catch (error) {
    logError('Get trash error', error);
    res.status(500).json({ error: 'Failed to load trash' });
  }
});

// ── Versions ─────────────────────────────────────────────────────────

// GET /documents/:id/versions
router.get('/documents/:id/versions', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const loaded = await loadDocument(req, res);
    if (!loaded) return;
    const versions = await prisma.documentVersion.findMany({
      where: { documentId: loaded.document.id },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { id: true, title: true, createdAt: true, author: { select: USER_SELECT_BASIC } },
    });
    res.json(versions);
  } catch (error) {
    logError('List versions error', error);
    res.status(500).json({ error: 'Failed to load version history' });
  }
});

// GET /documents/:id/versions/:versionId
router.get('/documents/:id/versions/:versionId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const loaded = await loadDocument(req, res);
    if (!loaded) return;
    const versionId = parseIntParam(req.params.versionId);
    const version = versionId
      ? await prisma.documentVersion.findFirst({
          where: { id: versionId, documentId: loaded.document.id },
          select: { id: true, title: true, content: true, createdAt: true, author: { select: USER_SELECT_BASIC } },
        })
      : null;
    if (!version) return void res.status(404).json({ error: 'Version not found' });
    res.json(version);
  } catch (error) {
    logError('Get version error', error);
    res.status(500).json({ error: 'Failed to load version' });
  }
});

// POST /documents/:id/versions/:versionId/restore - make an old version current (kept as a new version)
router.post('/documents/:id/versions/:versionId/restore', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const loaded = await loadDocument(req, res, { write: true });
    if (!loaded) return;
    const userId = req.user!.userId;
    const versionId = parseIntParam(req.params.versionId);
    const version = versionId
      ? await prisma.documentVersion.findFirst({ where: { id: versionId, documentId: loaded.document.id } })
      : null;
    if (!version) return void res.status(404).json({ error: 'Version not found' });

    const content = version.content as Prisma.InputJsonValue;
    const updated = await prisma.$transaction(async (tx) => {
      const doc = await tx.document.update({
        where: { id: loaded.document.id },
        data: { title: version.title, content, contentText: version.contentText, updatedBy: userId },
        select: DOC_LIST_SELECT,
      });
      await tx.documentVersion.create({
        data: { documentId: loaded.document.id, title: version.title, content, contentText: version.contentText, createdBy: userId },
      });
      return doc;
    });
    emit(loaded.document.channelId, 'document:updated', {
      documentId: loaded.document.id, updatedBy: userId, updatedAt: updated.updatedAt, title: updated.title,
    });
    res.json(updated);
  } catch (error) {
    logError('Restore version error', error);
    res.status(500).json({ error: 'Failed to restore version' });
  }
});

// ── Library files ────────────────────────────────────────────────────

// PATCH /library/files/:id - move a library file to another folder (uploader or any member)
router.patch('/library/files/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseIntParam(req.params.id);
    if (!id) return void res.status(400).json({ error: 'Invalid file ID' });
    const file = await prisma.file.findUnique({ where: { id }, select: { id: true, channelId: true, folderId: true } });
    if (!file?.channelId) return void res.status(404).json({ error: 'File not found' });
    const access = await writeAccess(req.user!.userId, file.channelId);
    if (!access.ok) return deny(res, access);

    const parsed = z.object({ folderId: z.number().int().positive().nullable() }).safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: 'Invalid folder' });
    if (!(await folderInChannel(parsed.data.folderId, file.channelId))) return void res.status(404).json({ error: 'Folder not found' });

    await prisma.file.update({ where: { id }, data: { folderId: parsed.data.folderId } });
    emit(file.channelId, 'library:changed', { folderId: parsed.data.folderId });
    res.json({ message: 'File moved' });
  } catch (error) {
    logError('Move file error', error);
    res.status(500).json({ error: 'Failed to move file' });
  }
});

export default router;
