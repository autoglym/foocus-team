import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { UnreadBadge } from './UnreadBadge';

interface SidebarItemProps {
  isActive: boolean;
  hasUnread: boolean;
  unreadCount: number;
  onClick: () => void;
  leftSlot: ReactNode;
  label: ReactNode;
  'data-testid'?: string;
}

export function SidebarItem({
  isActive,
  hasUnread,
  unreadCount,
  onClick,
  leftSlot,
  label,
  'data-testid': testId,
}: SidebarItemProps) {
  return (
    <button
      onClick={onClick}
      data-active={isActive}
      data-testid={testId}
      className={cn(
        'flex w-full items-center gap-2 h-[30px] text-[15px] transition-colors duration-150 rounded-[10px] text-left',
        'mx-2 w-[calc(100%-16px)] px-3',
        isActive
          ? 'bg-slack-sidebar neu-navy-inset text-[#9CCBEA] font-semibold'
          : hasUnread
            ? 'text-white font-semibold hover:bg-white/[0.06]'
            : 'text-white/65 font-normal hover:bg-white/[0.06] hover:text-white/90'
      )}
    >
      {leftSlot}
      <span className="truncate">{label}</span>
      <UnreadBadge count={unreadCount} isActive={isActive} />
    </button>
  );
}
