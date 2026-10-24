import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Hash, Lock, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useChannelStore } from '@/stores/useChannelStore';
import type { Channel } from '@/lib/types';

interface ChannelDetailsDialogProps {
  channel: Channel;
  open: boolean;
  readOnly?: boolean;
  onClose: () => void;
}

export function ChannelDetailsDialog({ channel, open, readOnly, onClose }: ChannelDetailsDialogProps) {
  const updateChannelDetails = useChannelStore((s) => s.updateChannelDetails);
  const [topic, setTopic] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setTopic(channel.topic ?? '');
      setDescription(channel.description ?? '');
      setError('');
    }
  }, [open, channel.topic, channel.description]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const isDirty = topic !== (channel.topic ?? '') || description !== (channel.description ?? '');

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setError('');
    try {
      await updateChannelDetails(channel.id, { topic, description });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save channel details');
    } finally {
      setIsSaving(false);
    }
  };

  // Portal to <body> so the dialog is not trapped in the header's stacking context
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="channel-details-title"
        className="w-full max-w-[520px] rounded-[24px] neu-raised"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-5">
          <h2 id="channel-details-title" className="flex items-center gap-1.5 font-heading text-[20px] font-bold tracking-tight text-slack-primary">
            {channel.isPrivate ? <Lock className="h-[18px] w-[18px] text-slack-secondary" /> : <Hash className="h-[18px] w-[18px] text-slack-secondary" />}
            {channel.name}
          </h2>
          <Button variant="toolbar" size="icon-sm" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form onSubmit={handleSave} className="space-y-4 px-6 pb-6 pt-4">
          <div>
            <label htmlFor="channel-topic" className="mb-1 flex justify-between text-[14px] font-medium text-slack-primary">
              Topic
              <span className="text-[12px] font-normal text-slack-hint">{topic.length}/250</span>
            </label>
            <input
              id="channel-topic"
              data-testid="channel-topic-input"
              value={topic}
              onChange={(e) => setTopic(e.target.value.slice(0, 250))}
              placeholder="What's the team working on right now?"
              disabled={readOnly}
              autoFocus={!readOnly}
              className="w-full rounded-xl neu-inset px-4 py-2.5 text-[15px] text-slack-primary outline-none focus:ring-2 focus:ring-slack-btn/40 disabled:opacity-70"
            />
          </div>

          <div>
            <label htmlFor="channel-description" className="mb-1 flex justify-between text-[14px] font-medium text-slack-primary">
              Description
              <span className="text-[12px] font-normal text-slack-hint">{description.length}/1000</span>
            </label>
            <textarea
              id="channel-description"
              data-testid="channel-description-input"
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, 1000))}
              placeholder="What is this channel for?"
              rows={4}
              disabled={readOnly}
              className="w-full resize-none rounded-xl neu-inset px-4 py-2.5 text-[15px] text-slack-primary outline-none focus:ring-2 focus:ring-slack-btn/40 disabled:opacity-70"
            />
          </div>

          {error && <p className="text-[13px] text-slack-error" role="alert">{error}</p>}

          {!readOnly && (
            <div className="flex justify-end gap-2">
              <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={!isDirty || isSaving}>{isSaving ? 'Saving…' : 'Save'}</Button>
            </div>
          )}
        </form>
      </div>
    </div>,
    document.body,
  );
}
