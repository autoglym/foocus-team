import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Hash, Lock, Star, MoreVertical, LogOut, Menu, Search, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getChannelMembers, type ChannelMember } from '@/lib/api';
import { useChannelStore } from '@/stores/useChannelStore';
import type { Channel } from '@/lib/types';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { HeaderSearch } from './HeaderSearch';
import { HeaderNotifications } from './HeaderNotifications';
import { HeaderTabs } from './HeaderTabs';
import { MobileSearchOverlay } from './MobileSearchOverlay';
import { useMobileStore } from '@/stores/useMobileStore';
import { ChannelDetailsDialog } from './ChannelDetailsDialog';
import { useAuthStore } from '@/stores/useAuthStore';
import { groupDMLabel } from '@/lib/channelName';

interface MessageHeaderProps {
  channel: Channel;
  showMembers?: boolean;
  onToggleMembers?: () => void;
  onTogglePins?: () => void;
  showPins?: boolean;
  onToggleFiles?: () => void;
  showFiles?: boolean;
  readOnly?: boolean;
}

export function MessageHeader({ channel, showMembers, onToggleMembers, onTogglePins, showPins, onToggleFiles, showFiles, readOnly }: MessageHeaderProps) {
  const navigate = useNavigate();
  const openSidebar = useMobileStore((s) => s.openSidebar);
  const toggleStar = useChannelStore((s) => s.toggleStar);
  const leaveChannel = useChannelStore((s) => s.leaveChannel);
  const [showMenu, setShowMenu] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [previewMembers, setPreviewMembers] = useState<ChannelMember[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close channel menu when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    }
    if (showMenu) {
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }
  }, [showMenu]);

  // Fetch up to 3 member avatars for preview in the header
  useEffect(() => {
    let cancelled = false;
    getChannelMembers(channel.id)
      .then((data) => {
        if (!cancelled) setPreviewMembers(data.slice(0, 3));
      })
      .catch(() => { /* Non-critical preview — header still usable without avatars */ });
    return () => {
      cancelled = true;
    };
  }, [channel.id]);

  const [leaveError, setLeaveError] = useState<string | null>(null);
  const [showMobileSearch, setShowMobileSearch] = useState(false);

  const handleLeaveChannel = async () => {
    setShowMenu(false);
    setLeaveError(null);
    try {
      const nextChannelId = await leaveChannel(channel.id);
      if (nextChannelId) {
        navigate(`/c/${nextChannelId}`);
      } else {
        navigate('/');
      }
    } catch {
      setLeaveError('Cannot leave channel — you are the last member.');
    }
  };

  return (
    <header className="relative z-10 flex flex-col flex-shrink-0 bg-slack-surface shadow-[0_1px_0_rgba(15,17,24,0.06)] pt-[env(safe-area-inset-top)]">
      {/* Top Row - Channel name and actions */}
      <div className="flex h-[49px] items-center justify-between px-4">
        {/* Left Section */}
        <div className="flex min-w-0 items-center gap-1">
          <button
            onClick={openSidebar}
            className="mr-1 flex h-8 w-8 items-center justify-center rounded hover:bg-slack-hover md:hidden"
          >
            <Menu className="h-5 w-5 text-slack-secondary" />
          </button>
          <button
            type="button"
            data-testid="channel-name-button"
            onClick={() => setShowDetails(true)}
            title="Channel details"
            className="flex items-center gap-1 rounded-lg px-1.5 py-0.5 hover:bg-slack-hover"
          >
            {channel.isGroupDM
              ? <Users className="h-[16px] w-[16px] text-slack-secondary" />
              : channel.isPrivate ? <Lock className="h-[16px] w-[16px] text-slack-secondary" /> : <Hash className="h-[16px] w-[16px] text-slack-secondary" />}
            <span className="max-w-[360px] truncate font-heading text-[18px] font-bold tracking-tight text-slack-primary">
              {channel.isGroupDM ? groupDMLabel(channel, currentUserId) : channel.name}
            </span>
          </button>
          {!readOnly && (
            <Button
              variant="toolbar"
              size="icon-xs"
              data-testid="star-channel-button"
              onClick={() => toggleStar(channel.id)}
              title={channel.isStarred ? 'Remove from Starred' : 'Add to Starred'}
            >
              <Star className={cn('h-4 w-4', channel.isStarred ? 'fill-yellow-400 text-yellow-400' : 'text-slack-secondary')} />
            </Button>
          )}
          {(channel.topic || !readOnly) && (
            <button
              type="button"
              data-testid="channel-topic"
              onClick={() => setShowDetails(true)}
              title={channel.topic ?? 'Add a topic'}
              className={cn(
                'ml-1 hidden min-w-0 max-w-[420px] truncate rounded-lg px-2 py-0.5 text-left text-[13px] hover:bg-slack-hover md:block',
                channel.topic ? 'text-slack-secondary' : 'text-slack-hint'
              )}
            >
              {channel.topic || 'Add a topic'}
            </button>
          )}
        </div>

        {/* Right Section */}
        <div className="flex items-center gap-2">
          <button
            data-testid="member-avatars-button"
            onClick={onToggleMembers}
            className={cn(
              'flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[13px] hover:bg-slack-hover',
              showMembers ? 'text-slack-link bg-slack-highlight' : 'text-slack-secondary'
            )}
          >
            {previewMembers.length > 0 ? (
              <div className="flex items-center -space-x-1.5">
                {previewMembers.map((member, index) => (
                  <Avatar
                    key={member.user.id}
                    src={member.user.avatar ?? undefined}
                    alt={member.user.name}
                    fallback={member.user.name}
                    size="sm"
                    className="h-[18px] w-[18px] ring-1 ring-white"
                    style={{ zIndex: previewMembers.length - index }}
                  />
                ))}
              </div>
            ) : null}
            <span>{channel.memberCount}</span>
          </button>
          <div className="hidden sm:block h-4 w-px bg-slack-border" />
          <HeaderNotifications excludeChannelId={channel.id} />
          <div className="hidden sm:block h-4 w-px bg-slack-border" />
          <div className="hidden sm:block">
            <HeaderSearch />
          </div>
          <button
            onClick={() => setShowMobileSearch(true)}
            className="flex h-8 w-8 items-center justify-center rounded hover:bg-slack-hover sm:hidden"
            data-testid="mobile-search-button"
          >
            <Search className="h-4 w-4 text-slack-secondary" />
          </button>
          {!readOnly && (
            <div className="relative" ref={menuRef}>
              <Button
                variant="toolbar"
                size="icon-xs"
                data-testid="channel-header-menu"
                onClick={() => setShowMenu((v) => !v)}
              >
                <MoreVertical className="h-4 w-4 text-slack-secondary" />
              </Button>
              {showMenu && (
                <div className="absolute right-0 top-7 z-50 min-w-[160px] rounded-lg border border-slack-border bg-white shadow-lg py-1">
                  <Button
                    variant="menu-item-danger"
                    onClick={handleLeaveChannel}
                  >
                    <LogOut className="h-4 w-4" />
                    Leave channel
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Leave channel error banner */}
      {leaveError && (
        <div data-testid="leave-error" className="flex items-center justify-between bg-red-50 border-b border-red-200 px-4 py-2 text-sm text-red-700">
          <span>{leaveError}</span>
          <button onClick={() => setLeaveError(null)} className="ml-2 text-red-500 hover:text-red-700 font-medium">Dismiss</button>
        </div>
      )}

      {/* Tabs Row */}
      <HeaderTabs
        showPins={showPins}
        showFiles={showFiles}
        onTogglePins={onTogglePins}
        onToggleFiles={onToggleFiles}
      />

      {/* Mobile search overlay */}
      {showMobileSearch && (
        <MobileSearchOverlay onClose={() => setShowMobileSearch(false)} />
      )}
      <ChannelDetailsDialog
        channel={channel}
        open={showDetails}
        readOnly={readOnly}
        onClose={() => setShowDetails(false)}
      />
    </header>
  );
}
