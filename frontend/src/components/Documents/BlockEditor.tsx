import '@blocknote/mantine/style.css';
import type { PartialBlock } from '@blocknote/core';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import { getAuthFileUrl } from '@/lib/api';
import type { Blocks } from '@/lib/documents';

// Loaded lazily (React.lazy) so BlockNote/Mantine stay out of the main bundle.

interface BlockEditorProps {
  initialContent: Blocks;
  editable: boolean;
  onChange?: (blocks: Blocks) => void;
  /** Upload an image/file dropped into the document; returns its stored URL. */
  uploadFile?: (file: File) => Promise<string>;
}

export default function BlockEditor({ initialContent, editable, onChange, uploadFile }: BlockEditorProps) {
  const editor = useCreateBlockNote({
    initialContent: initialContent.length > 0 ? (initialContent as PartialBlock[]) : undefined,
    uploadFile,
    // Stored URLs are our authenticated /files/:id/download endpoint; add a fresh
    // short-lived download token whenever the editor renders one
    resolveFileUrl: async (url) => getAuthFileUrl(url),
  });

  return (
    <BlockNoteView
      editor={editor}
      editable={editable}
      theme="light"
      className="foocus-blocknote"
      onChange={() => onChange?.(editor.document as Blocks)}
    />
  );
}
