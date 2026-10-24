import { useAuthStore } from '@/stores/useAuthStore';
import { useChannelStore } from '@/stores/useChannelStore';
import type { Channel } from '@/lib/types';

const GROUP_DM_PREFIX = 'gdm-';

export function isGroupDMName(name: string) {
  return name.startsWith(GROUP_DM_PREFIX);
}

/** "Eve Johnson, Hank Torres" for a group DM (without the current user). */
export function groupDMLabel(channel: Pick<Channel, 'participants'>, currentUserId?: number) {
  const others = (channel.participants ?? []).filter((p) => p.id !== currentUserId);
  return others.length > 0 ? others.map((p) => p.name).join(', ') : 'Group conversation';
}

/**
 * Display name for a channel: "#name" style name for channels, participant
 * names for group DMs. Works for partial channel objects from search results,
 * unreads and bookmarks by looking the group up in the channel store.
 */
export function channelDisplayName(channel: { id: number; name: string }, withHash = false) {
  if (!isGroupDMName(channel.name)) return withHash ? `#${channel.name}` : channel.name;
  const known = useChannelStore.getState().channels.find((c) => c.id === channel.id);
  return groupDMLabel(known ?? {}, useAuthStore.getState().user?.id);
}
