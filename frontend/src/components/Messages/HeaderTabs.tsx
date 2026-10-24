import { FileText, MessageSquare, NotebookText, Pin } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';

const headerTabs = [
  { id: 'files' as const, label: 'Files', icon: FileText },
  { id: 'pins' as const, label: 'Pins', icon: Pin },
];

interface HeaderTabsProps {
  showPins?: boolean;
  showFiles?: boolean;
  onTogglePins?: () => void;
  onToggleFiles?: () => void;
  testIdPrefix?: string;
  /** Channel views: messages or the channel's documents (only for channels) */
  channelId?: number;
  view?: 'messages' | 'docs';
}

export function HeaderTabs({ showPins, showFiles, onTogglePins, onToggleFiles, testIdPrefix = '', channelId, view = 'messages' }: HeaderTabsProps) {
  const prefix = testIdPrefix ? `${testIdPrefix}-` : '';
  const navigate = useNavigate();

  return (
    <div className="flex items-center gap-0.5 px-4 pb-[6px]">
      {channelId !== undefined && (
        <div className="mr-2 flex items-center gap-0.5 rounded-full neu-inset-sm p-[3px]" role="tablist" aria-label="Channel view">
          {([
            { id: 'messages', label: 'Messages', icon: MessageSquare, to: `/c/${channelId}` },
            { id: 'docs', label: 'Docs', icon: NotebookText, to: `/c/${channelId}/docs` },
          ] as const).map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={view === tab.id}
              data-testid={`${prefix}view-tab-${tab.id}`}
              onClick={() => view !== tab.id && navigate(tab.to)}
              className={cn(
                'flex items-center gap-1 rounded-full px-3 py-[3px] text-[13px] transition-all',
                view === tab.id ? 'neu-raised-sm font-medium text-slack-primary' : 'text-slack-secondary hover:text-slack-primary'
              )}
            >
              <tab.icon className="h-[14px] w-[14px]" />
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      )}
      {headerTabs.map((tab) => (
        <button
          key={tab.id}
          data-testid={`${prefix}header-tab-${tab.id}`}
          onClick={() => {
            if (tab.id === 'pins') onTogglePins?.();
            if (tab.id === 'files') onToggleFiles?.();
          }}
          className={cn(
            'flex items-center gap-1 rounded px-2 py-[3px] text-[13px] transition-colors',
            (tab.id === 'pins' && showPins) || (tab.id === 'files' && showFiles)
              ? 'bg-slack-active-tab text-slack-primary font-medium'
              : 'text-slack-secondary hover:bg-slack-hover hover:text-slack-primary'
          )}
        >
          <tab.icon className="h-[14px] w-[14px]" />
          <span>{tab.label}</span>
        </button>
      ))}
    </div>
  );
}
