import { request, type ApiFile } from '@/lib/api';

// BlockNote's document format: an array of blocks. Kept loose here so this
// module doesn't pull the editor bundle into the main chunk.
export type Blocks = unknown[];

export interface DocUser { id: number; name: string; avatar: string | null }

export interface DocSummary {
  id: number;
  title: string;
  channelId: number;
  folderId: number | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  creator: DocUser;
  updater: DocUser;
  channel?: { id: number; name: string; isGroupDM: boolean };
}

export interface FolderSummary {
  id: number;
  name: string;
  parentId: number | null;
  updatedAt: string;
  _count: { children: number; documents: number; files: number };
}

export interface LibraryFile extends ApiFile {
  createdAt: string;
  user: DocUser;
}

export interface Library {
  folderId: number | null;
  breadcrumb: Array<{ id: number; name: string }>;
  readOnly: boolean;
  folders: FolderSummary[];
  documents: DocSummary[];
  files: LibraryFile[];
}

export interface DocDetail extends Omit<DocSummary, 'creator' | 'updater'> {
  content: Blocks;
  creator: DocUser;
  updater: DocUser;
  channel: { id: number; name: string; isGroupDM: boolean };
  breadcrumb: Array<{ id: number; name: string }>;
  readOnly: boolean;
}

export interface DocVersion { id: number; title: string; createdAt: string; author: DocUser }

export const getLibrary = (channelId: number, folderId: number | null) =>
  request<Library>(`/channels/${channelId}/library${folderId ? `?folderId=${folderId}` : ''}`);

export const createFolder = (channelId: number, name: string, parentId: number | null) =>
  request<{ id: number }>(`/channels/${channelId}/folders`, { method: 'POST', body: JSON.stringify({ name, parentId }) });

export const updateFolder = (id: number, data: { name?: string; parentId?: number | null }) =>
  request(`/folders/${id}`, { method: 'PATCH', body: JSON.stringify(data) });

export const deleteFolder = (id: number) => request(`/folders/${id}`, { method: 'DELETE' });

export const createDocument = (channelId: number, data: { title: string; folderId: number | null; content?: Blocks }) =>
  request<DocSummary>(`/channels/${channelId}/documents`, { method: 'POST', body: JSON.stringify(data) });

export const getDocument = (id: number) => request<DocDetail>(`/documents/${id}`);

export const saveDocument = (id: number, data: { title?: string; content?: Blocks; folderId?: number | null }) =>
  request<DocSummary>(`/documents/${id}`, { method: 'PUT', body: JSON.stringify(data) });

export const trashDocument = (id: number) => request(`/documents/${id}`, { method: 'DELETE' });
export const restoreDocument = (id: number) => request<DocSummary>(`/documents/${id}/restore`, { method: 'POST' });
export const getTrash = (channelId: number) => request<DocSummary[]>(`/channels/${channelId}/trash`);

export const getAllDocuments = (q = '') =>
  request<DocSummary[]>(`/documents${q ? `?q=${encodeURIComponent(q)}` : ''}`);

export const getVersions = (id: number) => request<DocVersion[]>(`/documents/${id}/versions`);
export const getVersion = (id: number, versionId: number) =>
  request<DocVersion & { content: Blocks }>(`/documents/${id}/versions/${versionId}`);
export const restoreVersion = (id: number, versionId: number) =>
  request<DocSummary>(`/documents/${id}/versions/${versionId}/restore`, { method: 'POST' });

export const moveLibraryFile = (id: number, folderId: number | null) =>
  request(`/library/files/${id}`, { method: 'PATCH', body: JSON.stringify({ folderId }) });

export async function uploadLibraryFile(file: File, channelId: number, folderId: number | null): Promise<ApiFile> {
  const token = localStorage.getItem('token');
  const form = new FormData();
  form.append('channelId', String(channelId));
  if (folderId) form.append('folderId', String(folderId));
  form.append('file', file);
  const res = await fetch('/files', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error(body.error || 'Upload failed');
  }
  return res.json();
}

export const docPath = (channelId: number, documentId: number) => `/c/${channelId}/docs/${documentId}`;

export const getAllFolders = (channelId: number) =>
  request<Array<{ id: number; name: string; parentId: number | null }>>(`/channels/${channelId}/folders`);
