/**
 * PrivateSection — Creator's Room parent container.
 *
 * Three-tab layout: Drafts | Vault | Notes
 * Wrapped by PrivateSectionGuard for access control.
 */
import { useState } from 'react';
import { usePrivateAccess, type AccessLevel } from '../../hooks/usePrivateAccess';
import { PrivateSectionGuard } from './PrivateSectionGuard';
import { DraftWorkspace } from './DraftWorkspace';
import { LoreVault } from './LoreVault';
import { PlotNotes } from './PlotNotes';

type Tab = 'drafts' | 'vault' | 'notes';

interface PrivateSectionProps {
  universeId: string;
}

const TABS: { id: Tab; label: string; icon: JSX.Element }[] = [
  {
    id: 'drafts',
    label: 'Drafts',
    icon: (
      <svg
        className="w-4 h-4"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"
        />
      </svg>
    ),
  },
  {
    id: 'vault',
    label: 'Vault',
    icon: (
      <svg
        className="w-4 h-4"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0 0 12 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75Z"
        />
      </svg>
    ),
  },
  {
    id: 'notes',
    label: 'Notes',
    icon: (
      <svg
        className="w-4 h-4"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
        />
      </svg>
    ),
  },
];

export function PrivateSection({ universeId }: PrivateSectionProps) {
  const { accessLevel, config, isLoading } = usePrivateAccess(universeId);
  const [activeTab, setActiveTab] = useState<Tab>('drafts');

  // Filter available tabs based on config
  const availableTabs = TABS.filter((tab) => {
    if (tab.id === 'vault' && config && !config.vaultEnabled) return false;
    if (tab.id === 'notes' && config && !config.notesEnabled) return false;
    return true;
  });

  // Token holders can only see the vault
  const visibleTabs =
    accessLevel === 'holders' ? availableTabs.filter((t) => t.id === 'vault') : availableTabs;

  return (
    <PrivateSectionGuard universeId={universeId}>
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <svg
              className="w-5 h-5 text-amber-400"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
              />
            </svg>
            <h2 className="text-white font-semibold">Creator's Room</h2>
            <span className="text-xs bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded">
              {accessLevel}
            </span>
          </div>
        </div>

        {/* Tab bar */}
        {visibleTabs.length > 1 && (
          <div className="flex border-b border-zinc-800">
            {visibleTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 ${
                  activeTab === tab.id
                    ? 'text-white border-violet-500'
                    : 'text-zinc-500 border-transparent hover:text-zinc-300'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'drafts' && accessLevel !== 'holders' && (
            <DraftWorkspace universeId={universeId} accessLevel={accessLevel} />
          )}
          {activeTab === 'vault' && <LoreVault universeId={universeId} accessLevel={accessLevel} />}
          {activeTab === 'notes' && accessLevel !== 'holders' && (
            <PlotNotes universeId={universeId} accessLevel={accessLevel} />
          )}
        </div>
      </div>
    </PrivateSectionGuard>
  );
}
