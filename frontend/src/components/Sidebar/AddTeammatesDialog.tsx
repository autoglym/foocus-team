import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Check, Plus, X } from 'lucide-react';
import { useChannelActions } from '@/hooks/useChannelActions';
import { useAuthStore } from '@/stores/useAuthStore';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import type { AuthUser } from '@/lib/api';

const MAX_GROUP_OTHERS = 8;

interface AddTeammatesDialogProps {
  open: boolean;
  onClose: () => void;
  onSelectUser: (user: AuthUser) => void;
  onStartGroup: (users: AuthUser[]) => Promise<void>;
}

export function AddTeammatesDialog({
  open,
  onClose,
  onSelectUser,
  onStartGroup,
}: AddTeammatesDialogProps) {
  const [teammateSearch, setTeammateSearch] = useState('');
  const [selected, setSelected] = useState<AuthUser[]>([]);
  const [groupError, setGroupError] = useState('');
  const [isStarting, setIsStarting] = useState(false);
  const { teammates, searchTeammates } = useChannelActions();
  const currentUser = useAuthStore((s) => s.user);

  // Load all teammates when dialog opens
  useEffect(() => {
    if (open) {
      setTeammateSearch('');
      setSelected([]);
      setGroupError('');
      searchTeammates('');
    }
  }, [open, searchTeammates]);

  if (!open) return null;

  const isSelected = (u: AuthUser) => selected.some((s) => s.id === u.id);
  const toggle = (u: AuthUser) => {
    setGroupError('');
    setSelected((prev) =>
      prev.some((s) => s.id === u.id)
        ? prev.filter((s) => s.id !== u.id)
        : prev.length >= MAX_GROUP_OTHERS ? prev : [...prev, u]
    );
  };

  const handleStart = async () => {
    if (selected.length === 1) {
      onSelectUser(selected[0]);
      return;
    }
    setIsStarting(true);
    try {
      await onStartGroup(selected);
    } catch (err) {
      setGroupError(err instanceof Error ? err.message : 'Could not start the group conversation');
    } finally {
      setIsStarting(false);
    }
  };

  // Portal to <body> so the sidebar's transform doesn't trap the fixed overlay
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-[480px] rounded-[24px] neu-raised p-6">
        <h2 className="font-heading text-[22px] font-bold tracking-tight text-slack-primary mb-1">Direct message</h2>
        <p className="text-[14px] text-slack-hint mb-4">
          Click a person to message them, or use + to add several people to a group.
        </p>

        {selected.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5" data-testid="group-selection">
            {selected.map((u) => (
              <span key={u.id} className="inline-flex items-center gap-1 rounded-full bg-slack-highlight py-0.5 pl-1 pr-1.5 text-[13px] text-slack-link">
                <Avatar src={u.avatar ?? undefined} alt={u.name} fallback={u.name} size="sm" className="h-5 w-5" />
                {u.name}
                <button type="button" onClick={() => toggle(u)} aria-label={`Remove ${u.name}`} className="rounded-full p-0.5 hover:bg-white/60">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <input
          data-testid="teammate-search"
          type="text"
          value={teammateSearch}
          onChange={(e) => {
            setTeammateSearch(e.target.value);
            searchTeammates(e.target.value);
          }}
          placeholder="Search by name..."
          autoFocus
          className="w-full rounded-xl neu-inset px-4 py-2.5 text-[15px] text-slack-primary outline-none focus:ring-2 focus:ring-slack-btn/40 mb-3"
        />
        {teammates.length === 0 ? (
          <p className="text-center text-slack-hint py-4">No users found</p>
        ) : (
          <div className="max-h-[300px] overflow-y-auto space-y-1">
            {teammates.map((u) => {
              const isSelf = u.id === currentUser?.id;
              const picked = isSelected(u);
              return (
                <div key={u.id} className={cn('flex items-center rounded-xl', picked ? 'bg-slack-highlight' : 'hover:bg-white')}>
                  <button
                    onClick={() => onSelectUser(u)}
                    className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left"
                  >
                    <Avatar
                      src={u.avatar ?? undefined}
                      alt={u.name}
                      fallback={u.name}
                      size="md"
                    />
                    <p className="truncate text-[14px] font-medium text-slack-primary">
                      {u.name}{isSelf && <span className="text-slack-hint font-normal"> (you)</span>}
                    </p>
                  </button>
                  {!isSelf && (
                    <button
                      type="button"
                      onClick={() => toggle(u)}
                      aria-pressed={picked}
                      aria-label="Add to group"
                      title={picked ? 'Remove from group' : 'Add to group'}
                      className={cn(
                        'mr-2 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full transition-colors',
                        picked ? 'bg-slack-btn text-white' : 'text-slack-secondary hover:bg-slack-active-tab'
                      )}
                    >
                      {picked ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {groupError && <p className="mt-2 text-[13px] text-slack-error" role="alert">{groupError}</p>}
        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          {selected.length > 0 && (
            <Button data-testid="start-group-button" onClick={handleStart} disabled={isStarting}>
              {selected.length === 1 ? `Message ${selected[0].name}` : `Start group (${selected.length + 1} people)`}
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
