-- Files are stored in Supabase Storage instead of Google Cloud Storage
ALTER TABLE "File" RENAME COLUMN "gcsPath" TO "storagePath";
