import { Users } from 'lucide-react';
import type { Channel } from '@/lib/types';
import { groupDMLabel } from '@/lib/channelName';
import { SidebarItem } from './SidebarItem';

interface GroupDMItemProps {
  channel: Channel;
  currentUserId?: number;
  isActive: boolean;
  onClick: () => void;
}

export function GroupDMItem({ channel, currentUserId, isActive, onClick }: GroupDMItemProps) {
  const others = (channel.participants ?? []).filter((p) => p.id !== currentUserId);

  return (
    <SidebarItem
      data-testid="group-dm-list-item"
      isActive={isActive}
      hasUnread={channel.unreadCount > 0}
      unreadCount={channel.unreadCount}
      onClick={onClick}
      leftSlot={
        <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-semibold">
          {others.length > 0 ? others.length : <Users className="h-3 w-3" />}
        </span>
      }
      label={groupDMLabel(channel, currentUserId)}
    />
  );
}
