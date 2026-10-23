import fs from 'fs';
import crypto from 'crypto';
import { StorageClient } from '@supabase/storage-js';

// Supabase Storage setup - only initialize if URL and secret key are configured.
// Without them, routes/files.ts falls back to local disk (backend/uploads/).
const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/+$/, '');
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'files';
const SIGNED_URL_TTL = parseInt(process.env.SUPABASE_SIGNED_URL_TTL || '300', 10);

const client = SUPABASE_URL && SUPABASE_SECRET_KEY
  ? new StorageClient(`${SUPABASE_URL}/storage/v1`, {
      apikey: SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
    })
  : null;

const bucket = client ? client.from(BUCKET) : null;

export const isRemoteStorageEnabled = bucket !== null;

// Origin + path prefix that signed URLs point to, for the CSP in app.ts
export const signedUrlSource = isRemoteStorageEnabled
  ? `${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/`
  : null;

// Upload a local temp file to the private bucket and delete the temp file.
// The object key carries no user-controlled text (Supabase rejects many
// non-ASCII characters in keys); the original name lives in File.originalName.
export async function uploadFile(localPath: string, mimetype: string): Promise<{ storagePath: string }> {
  if (!bucket) throw new Error('Supabase Storage not configured');

  const storagePath = `uploads/${Date.now()}-${crypto.randomUUID()}`;

  const body = await fs.promises.readFile(localPath);
  const { error } = await bucket.upload(storagePath, body, {
    contentType: mimetype,
    upsert: false,
  });
  if (error) throw error;

  // Delete local temp file after upload
  fs.unlinkSync(localPath);

  return { storagePath };
}

// Short-lived signed URL. With downloadAs set, Supabase sends
// Content-Disposition: attachment with that filename.
export async function createSignedUrl(storagePath: string, downloadAs?: string): Promise<string> {
  if (!bucket) throw new Error('Supabase Storage not configured');
  const { data, error } = await bucket.createSignedUrl(
    storagePath,
    SIGNED_URL_TTL,
    downloadAs ? { download: downloadAs } : undefined,
  );
  if (error) throw error;
  return data.signedUrl;
}

export async function deleteFile(storagePath: string): Promise<void> {
  if (!bucket) throw new Error('Supabase Storage not configured');
  const { error } = await bucket.remove([storagePath]);
  if (error) throw error;
}
