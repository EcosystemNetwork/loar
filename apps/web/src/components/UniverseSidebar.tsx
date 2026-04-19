/**
 * Universe Sidebar
 *
 * Collapsible left sidebar on the timeline editor page. Shows universe metadata,
 * on-chain contract addresses, event/leaf counts, and action buttons for creating
 * events, refreshing the timeline, and opening governance. Can be pinned open or
 * collapsed on desktop; slides in on mobile.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft,
  Plus,
  RefreshCw,
  Users,
  Activity,
  ExternalLink,
  Copy,
  CheckCircle,
  Loader2,
  ArrowRight,
  Sparkles,
  PanelLeftOpen,
  PanelLeftClose,
  X,
  Target,
  Vault,
  BookPlus,
  Pin,
  PinOff,
  Image as ImageIcon,
  Play,
  Film,
  Music,
  Settings,
  Pencil,
  BookOpen,
  ChevronDown,
  ChevronRight,
  User,
  MapPin,
  Swords,
  Scroll,
  Cpu,
  Bug,
  Car,
  Building2,
  Calendar,
  Package,
  DollarSign,
  Palette,
  GitBranch,
} from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { useState, useEffect } from 'react';
import { useChainId } from 'wagmi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Node } from 'reactflow';
import type { TimelineNodeData } from '@/components/flow/TimelineNodes';
import { getExplorerAddressUrl, getExplorerName } from '@/configs/chains';
import { openExternal } from '@/utils/open-external';
import { TokenSwapWidget } from '@/components/TokenSwapWidget';
import { SubscribeDialog } from '@/components/SubscribeDialog';
import { UniverseAccessSettings } from '@/components/UniverseAccessSettings';
import { useIsUniverseAdmin } from '@/hooks/useIsUniverseAdmin';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { trpcClient } from '@/utils/trpc';
import { toast } from 'sonner';
import type { UniverseData } from '@/types/universe';
import { isBlockchainUniverse as checkBlockchain } from '@/types/universe';
import { resolveIpfsUrl } from '@/utils/ipfs-url';

interface UniverseSidebarProps {
  finalUniverse: UniverseData | null;
  graphData: {
    nodeIds: any[];
  };
  leavesData: any;
  nodes: Node<TimelineNodeData>[];
  isLoadingAny: boolean;
  selectedNode: Node<TimelineNodeData> | null;
  handleAddEvent: (type: 'after' | 'branch', nodeId?: string) => void;
  handleRefreshTimeline: () => void;
  onOpenGovernance?: () => void;
  onOpenGenerations?: () => void;
  onOpenMusicStudio?: () => void;
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function UniverseSidebar({
  finalUniverse,
  graphData,
  leavesData,
  nodes,
  isLoadingAny,
  selectedNode,
  handleAddEvent,
  handleRefreshTimeline,
  onOpenGovernance,
  onOpenGenerations,
  onOpenMusicStudio,
}: UniverseSidebarProps) {
  const chainId = useChainId();
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [showSubscribe, setShowSubscribe] = useState(false);
  const [showAccessSettings, setShowAccessSettings] = useState(false);
  const [showEditMetadata, setShowEditMetadata] = useState(false);
  const [editName, setEditName] = useState('');
  const [editImageUrl, setEditImageUrl] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [isSavingMetadata, setIsSavingMetadata] = useState(false);
  const queryClient = useQueryClient();
  const { isAdmin } = useIsUniverseAdmin(
    finalUniverse?.address?.startsWith('0x') ? (finalUniverse.address as `0x${string}`) : undefined
  );

  const isBlockchain = checkBlockchain(finalUniverse);
  const universeIdOrAddress = finalUniverse?.address || finalUniverse?.id;
  const explorerName = getExplorerName(chainId);

  // Close mobile sidebar on escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedAddress(text);
      setTimeout(() => setCopiedAddress(null), 2000);
    } catch {
      toast.error('Failed to copy — try selecting the address manually');
    }
  };

  return (
    <>
      {/* Mobile toggle button - fixed position */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-label={mobileOpen ? 'Close sidebar' : 'Open sidebar'}
        className="md:hidden fixed top-16 left-2 z-40 bg-background/90 backdrop-blur-sm border rounded-lg p-2 shadow-lg"
      >
        {mobileOpen ? (
          <PanelLeftClose className="h-5 w-5" />
        ) : (
          <PanelLeftOpen className="h-5 w-5" />
        )}
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-30 bg-black/50"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar - pinnable on desktop, toggle on mobile */}
      <div
        className={`
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
          md:translate-x-0
          fixed top-[57px] left-0 bottom-0 md:top-0
          md:relative z-40 md:z-auto
          w-72 ${pinned ? 'md:w-80' : 'md:w-16 md:hover:w-80'}
          shrink-0 group border-r bg-white dark:bg-slate-900 flex flex-col shadow-xl border-slate-200 dark:border-slate-700 transition-all duration-300 ease-in-out overflow-hidden
          md:h-full
        `}
      >
        {/* Mobile close button */}
        <button
          onClick={() => setMobileOpen(false)}
          aria-label="Close sidebar"
          className="md:hidden absolute top-3 right-3 z-10 p-1 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Collapsed state indicator - desktop only (hidden when pinned) */}
        {!pinned && (
          <div className="hidden md:flex absolute inset-0 flex-col items-center justify-center opacity-100 group-hover:opacity-0 transition-opacity duration-200 pointer-events-none">
            <div className="text-slate-400 dark:text-slate-500 mb-2">
              <ArrowRight className="h-4 w-4" />
            </div>
            <div className="flex flex-col items-center space-y-2">
              <div
                className={`w-2 h-2 rounded-full ${isLoadingAny ? 'bg-amber-500 animate-pulse' : nodes.length > 0 ? 'bg-emerald-500' : 'bg-slate-400'}`}
              />
              {isBlockchain && <Sparkles className="h-3 w-3 text-blue-500" />}
            </div>
          </div>
        )}

        <div
          className={`flex-1 p-4 overflow-y-auto min-h-0 ${pinned ? 'opacity-100' : 'opacity-100 md:opacity-0 md:group-hover:opacity-100'} transition-opacity duration-300 md:delay-150`}
        >
          <div className="space-y-4">
            {/* Back Button + Pin Toggle */}
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="sm"
                asChild
                className="hover:bg-primary/10 hover:text-primary transition-all duration-300 group/back"
              >
                <Link to="/">
                  <ArrowLeft className="h-4 w-4 mr-2 group-hover/back:-translate-x-1 transition-transform duration-300" />
                  Go Back Home
                </Link>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPinned(!pinned)}
                aria-label={pinned ? 'Unpin sidebar' : 'Pin sidebar open'}
                className="hidden md:flex h-7 w-7 p-0 hover:bg-primary/10"
              >
                {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
              </Button>
            </div>

            {/* Enhanced Universe Header */}
            <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border border-primary/20 p-4">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-50" />
              <div className="relative space-y-3">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 mt-1">
                    <div
                      className={`w-3 h-3 rounded-full ${isLoadingAny ? 'bg-amber-500 animate-pulse' : nodes.length > 0 ? 'bg-emerald-500' : 'bg-slate-400'} shadow-lg`}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 truncate">
                        {finalUniverse?.name}
                      </h2>
                      {isBlockchain && (
                        <Badge
                          variant="secondary"
                          className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 border-blue-200 dark:border-blue-800"
                        >
                          <Sparkles className="h-3 w-3 mr-1" />
                          On-Chain
                        </Badge>
                      )}
                      <UniverseTypeBadge
                        universeId={finalUniverse?.address || finalUniverse?.id}
                        initialType={finalUniverse?.universeType}
                        canEdit={isAdmin}
                      />
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed line-clamp-2">
                      {finalUniverse?.description}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Enhanced Stats Grid */}
            <div className="grid grid-cols-2 gap-3">
              <Card className="bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-950/20 dark:to-emerald-900/20 border-emerald-200 dark:border-emerald-800 hover:shadow-md transition-shadow duration-300">
                <CardContent className="p-3 text-center">
                  <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-300 mb-1">
                    {graphData.nodeIds.length}
                  </div>
                  <div className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    Events
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950/20 dark:to-blue-900/20 border-blue-200 dark:border-blue-800 hover:shadow-md transition-shadow duration-300">
                <CardContent className="p-3 text-center">
                  <div className="text-2xl font-bold text-blue-700 dark:text-blue-300 mb-1">
                    {leavesData ? (Array.isArray(leavesData) ? leavesData.length : 0) : 0}
                  </div>
                  <div className="text-xs font-medium text-blue-600 dark:text-blue-400">Leaves</div>
                </CardContent>
              </Card>
            </div>

            {/* Enhanced Contract Info */}
            {!finalUniverse?.isDefault && finalUniverse?.address && (
              <Card className="bg-gradient-to-br from-violet-50 to-violet-100 dark:from-violet-950/20 dark:to-violet-900/20 border-violet-200 dark:border-violet-800">
                <CardContent className="p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Activity className="h-3 w-3 text-violet-600 dark:text-violet-400" />
                      <span className="text-xs font-medium text-violet-700 dark:text-violet-300">
                        Timeline Contract
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyToClipboard(finalUniverse.address!)}
                      aria-label="Copy contract address"
                      className="h-6 w-6 p-0 hover:bg-violet-200 dark:hover:bg-violet-800"
                    >
                      {copiedAddress === finalUniverse.address ? (
                        <CheckCircle className="h-3 w-3 text-emerald-500" />
                      ) : (
                        <Copy className="h-3 w-3 text-violet-600 dark:text-violet-400" />
                      )}
                    </Button>
                  </div>
                  <code className="block text-xs bg-violet-100 dark:bg-violet-900/50 px-2 py-1 rounded font-mono text-violet-800 dark:text-violet-200">
                    {finalUniverse.address.slice(0, 8)}...{finalUniverse.address.slice(-8)}
                  </code>
                  {isBlockchain && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full mt-2 h-7 text-xs border-violet-200 dark:border-violet-700 hover:bg-violet-100 dark:hover:bg-violet-900/50"
                      onClick={() =>
                        openExternal(getExplorerAddressUrl(chainId, finalUniverse.address!))
                      }
                    >
                      <ExternalLink className="h-3 w-3 mr-1" />
                      View on {explorerName}
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Token Contract Info */}
            {!finalUniverse?.isDefault && finalUniverse?.tokenAddress && (
              <Card className="bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-950/20 dark:to-emerald-900/20 border-emerald-200 dark:border-emerald-800">
                <CardContent className="p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Users className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                      <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                        Governance Token
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyToClipboard(finalUniverse.tokenAddress!)}
                      aria-label="Copy token address"
                      className="h-6 w-6 p-0 hover:bg-emerald-200 dark:hover:bg-emerald-800"
                    >
                      {copiedAddress === finalUniverse.tokenAddress ? (
                        <CheckCircle className="h-3 w-3 text-emerald-500" />
                      ) : (
                        <Copy className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                      )}
                    </Button>
                  </div>
                  <code className="block text-xs bg-emerald-100 dark:bg-emerald-900/50 px-2 py-1 rounded font-mono text-emerald-800 dark:text-emerald-200">
                    {finalUniverse.tokenAddress.slice(0, 8)}...
                    {finalUniverse.tokenAddress.slice(-8)}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full mt-2 h-7 text-xs border-emerald-200 dark:border-emerald-700 hover:bg-emerald-100 dark:hover:bg-emerald-900/50"
                    onClick={() =>
                      openExternal(getExplorerAddressUrl(chainId, finalUniverse.tokenAddress!))
                    }
                  >
                    <ExternalLink className="h-3 w-3 mr-1" />
                    View on {explorerName}
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Token Swap Widget */}
            {isBlockchain && finalUniverse?.tokenAddress && finalUniverse?.address && (
              <TokenSwapWidget universeAddress={finalUniverse.address} compact />
            )}

            {/* Action Buttons — each wrapped in a div to ensure space-y gap */}
            <div className="space-y-3">
              <Button
                onClick={() => handleAddEvent('after')}
                className="w-full bg-gradient-to-r from-primary via-primary to-primary/90 hover:from-primary/90 hover:via-primary/80 hover:to-primary/70 shadow-lg hover:shadow-xl transition-all duration-300 group/btn h-10"
                size="sm"
              >
                <Plus className="h-4 w-4 mr-2 group-hover/btn:rotate-90 transition-transform duration-300" />
                Create Event
              </Button>

              {/* Play Timeline — immersive branching player */}
              {graphData.nodeIds.length > 0 && (
                <div>
                  <Link to="/play/$universeId" params={{ universeId: universeIdOrAddress || '' }}>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30 hover:from-emerald-100 hover:to-teal-100 dark:hover:from-emerald-950/50 dark:hover:to-teal-950/50 border-emerald-200 dark:border-emerald-800 transition-all duration-300 group/btn h-10"
                    >
                      <Play className="h-4 w-4 mr-2 group-hover/btn:scale-110 transition-transform duration-300 text-emerald-600 dark:text-emerald-400" />
                      Play Timeline ({graphData.nodeIds.length} nodes)
                    </Button>
                  </Link>
                </div>
              )}

              {/* Build World — open full create hub scoped to this universe */}
              <div>
                <Link to="/create" search={{ universe: universeIdOrAddress }}>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full bg-gradient-to-r from-indigo-50 to-violet-50 dark:from-indigo-950/30 dark:to-violet-950/30 hover:from-indigo-100 hover:to-violet-100 dark:hover:from-indigo-950/50 dark:hover:to-violet-950/50 border-indigo-200 dark:border-indigo-800 transition-all duration-300 group/btn h-10"
                  >
                    <BookPlus className="h-4 w-4 mr-2 group-hover/btn:scale-110 transition-transform duration-300 text-indigo-600 dark:text-indigo-400" />
                    Build World
                  </Button>
                </Link>
              </div>

              {/* Admin buttons — edit metadata + access settings */}
              {isBlockchain && isAdmin && (
                <>
                  <Button
                    onClick={() => {
                      setEditName(finalUniverse?.name || '');
                      setEditImageUrl(finalUniverse?.imageUrl || '');
                      setEditDescription(finalUniverse?.description || '');
                      setShowEditMetadata(true);
                    }}
                    variant="outline"
                    className="w-full border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all duration-300 group/btn h-9"
                    size="sm"
                  >
                    <Pencil className="h-4 w-4 mr-2 group-hover/btn:scale-110 transition-transform duration-300" />
                    Edit Universe
                  </Button>
                  <Button
                    onClick={() => setShowAccessSettings(true)}
                    variant="outline"
                    className="w-full border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all duration-300 group/btn h-9"
                    size="sm"
                  >
                    <Settings className="h-4 w-4 mr-2 group-hover/btn:rotate-90 transition-transform duration-500" />
                    Access Settings
                  </Button>
                </>
              )}

              {/* Generations panel button */}
              {onOpenGenerations && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onOpenGenerations}
                  className="w-full bg-gradient-to-r from-purple-50 to-violet-50 dark:from-purple-950/30 dark:to-violet-950/30 hover:from-purple-100 hover:to-violet-100 dark:hover:from-purple-950/50 dark:hover:to-violet-950/50 border-purple-200 dark:border-purple-800 transition-all duration-300 group/btn h-10"
                >
                  <Sparkles className="h-4 w-4 mr-2 group-hover/btn:scale-110 transition-transform duration-300 text-purple-600 dark:text-purple-400" />
                  Generations
                </Button>
              )}

              {/* Music Studio button */}
              {onOpenMusicStudio && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onOpenMusicStudio}
                  className="w-full bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 hover:from-amber-100 hover:to-orange-100 dark:hover:from-amber-950/50 dark:hover:to-orange-950/50 border-amber-200 dark:border-amber-800 transition-all duration-300 group/btn h-10"
                >
                  <Music className="h-4 w-4 mr-2 group-hover/btn:scale-110 transition-transform duration-300 text-amber-600 dark:text-amber-400" />
                  Music Studio
                </Button>
              )}

              {/* Gallery button */}
              <div>
                <Link to="/universe/$id/gallery" params={{ id: universeIdOrAddress || '' }}>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full bg-gradient-to-r from-pink-50 to-rose-50 dark:from-pink-950/30 dark:to-rose-950/30 hover:from-pink-100 hover:to-rose-100 dark:hover:from-pink-950/50 dark:hover:to-rose-950/50 border-pink-200 dark:border-pink-800 transition-all duration-300 group/btn h-10"
                  >
                    <ImageIcon className="h-4 w-4 mr-2 group-hover/btn:scale-110 transition-transform duration-300 text-pink-600 dark:text-pink-400" />
                    Gallery
                  </Button>
                </Link>
              </div>

              {/* Wiki Entities */}
              <WikiEntitiesSection universeAddress={universeIdOrAddress} />

              {/* Gen Config button */}
              {isBlockchain && (
                <div>
                  <Link to="/universe/$id/gen-config" params={{ id: universeIdOrAddress || '' }}>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full bg-gradient-to-r from-cyan-50 to-teal-50 dark:from-cyan-950/30 dark:to-teal-950/30 hover:from-cyan-100 hover:to-teal-100 dark:hover:from-cyan-950/50 dark:hover:to-teal-950/50 border-cyan-200 dark:border-cyan-800 transition-all duration-300 group/btn h-10"
                    >
                      <Sparkles className="h-4 w-4 mr-2 group-hover/btn:scale-110 transition-transform duration-300 text-cyan-600 dark:text-cyan-400" />
                      Gen Config
                    </Button>
                  </Link>
                </div>
              )}

              {/* Lineage & Analytics button */}
              {isBlockchain && (
                <div>
                  <Link to="/universe/$id/lineage" params={{ id: universeIdOrAddress || '' }}>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full bg-gradient-to-r from-violet-50 to-fuchsia-50 dark:from-violet-950/30 dark:to-fuchsia-950/30 hover:from-violet-100 hover:to-fuchsia-100 dark:hover:from-violet-950/50 dark:hover:to-fuchsia-950/50 border-violet-200 dark:border-violet-800 transition-all duration-300 group/btn h-10"
                    >
                      <GitBranch className="h-4 w-4 mr-2 group-hover/btn:scale-110 transition-transform duration-300 text-violet-600 dark:text-violet-400" />
                      Lineage
                    </Button>
                  </Link>
                </div>
              )}

              {/* Treasury button */}
              {isBlockchain && (
                <div>
                  <Link
                    to="/treasury/$universeId"
                    params={{ universeId: universeIdOrAddress || '' }}
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full bg-gradient-to-r from-emerald-50 to-green-50 dark:from-emerald-950/30 dark:to-green-950/30 hover:from-emerald-100 hover:to-green-100 dark:hover:from-emerald-950/50 dark:hover:to-green-950/50 border-emerald-200 dark:border-emerald-800 transition-all duration-300 group/btn h-10"
                    >
                      <Vault className="h-4 w-4 mr-2 group-hover/btn:scale-110 transition-transform duration-300 text-emerald-600 dark:text-emerald-400" />
                      Treasury
                    </Button>
                  </Link>
                </div>
              )}

              {/* Bounties button */}
              <div>
                <Link to="/bounties" search={{ universeId: universeIdOrAddress }}>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full bg-gradient-to-r from-orange-50 to-amber-50 dark:from-orange-950/30 dark:to-amber-950/30 hover:from-orange-100 hover:to-amber-100 dark:hover:from-orange-950/50 dark:hover:to-amber-950/50 border-orange-200 dark:border-orange-800 transition-all duration-300 group/btn h-10"
                  >
                    <Target className="h-4 w-4 mr-2 group-hover/btn:scale-110 transition-transform duration-300 text-orange-600 dark:text-orange-400" />
                    Bounties
                  </Button>
                </Link>
              </div>

              <Button
                onClick={handleRefreshTimeline}
                variant="outline"
                size="sm"
                className="w-full hover:bg-slate-50 dark:hover:bg-slate-800 transition-all duration-300 group/btn h-9 border-slate-200 dark:border-slate-700"
                disabled={isLoadingAny}
              >
                <RefreshCw
                  className={`h-3 w-3 mr-2 group-hover/btn:rotate-180 transition-transform duration-500 ${isLoadingAny ? 'animate-spin' : ''}`}
                />
                {isLoadingAny ? 'Refreshing...' : 'Refresh Timeline'}
              </Button>
            </div>

            {/* Enhanced Selected Event */}
            {selectedNode && selectedNode.data.nodeType === 'scene' && (
              <Card className="bg-gradient-to-br from-amber-50 via-orange-50 to-amber-50 dark:from-amber-950/20 dark:via-orange-950/20 dark:to-amber-950/20 border-amber-200 dark:border-amber-800 shadow-lg">
                <CardHeader className="pb-2 pt-3">
                  <CardTitle className="flex items-center gap-2 text-sm text-amber-800 dark:text-amber-200">
                    <Film className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    Selected Event {selectedNode.data.eventId}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 pb-3">
                  <div className="space-y-2">
                    <div className="text-sm font-semibold text-amber-900 dark:text-amber-100 line-clamp-1">
                      {selectedNode.data.label}
                    </div>
                    <div className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed line-clamp-3 bg-amber-100/50 dark:bg-amber-900/20 p-2 rounded">
                      {typeof selectedNode.data.description === 'object' &&
                      selectedNode.data.description !== null &&
                      'description' in selectedNode.data.description
                        ? String((selectedNode.data.description as any).description)
                        : String(selectedNode.data.description || '')}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* Subscribe Dialog */}
      {showSubscribe && (
        <SubscribeDialog
          universeId={finalUniverse?.address || ''}
          universeName={finalUniverse?.name || finalUniverse?.universeName || ''}
          onClose={() => setShowSubscribe(false)}
        />
      )}

      {showAccessSettings && (
        <UniverseAccessSettings
          universeId={finalUniverse?.address || ''}
          onClose={() => setShowAccessSettings(false)}
        />
      )}

      {/* Edit Universe Metadata Dialog */}
      {showEditMetadata && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card rounded-2xl border w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Edit Universe</h2>
              <button
                onClick={() => setShowEditMetadata(false)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Close edit dialog"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">Name</Label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Universe name"
                maxLength={200}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">Image URL</Label>
              <Input
                value={editImageUrl}
                onChange={(e) => setEditImageUrl(e.target.value)}
                placeholder="https://..."
              />
              {editImageUrl && !isValidUrl(editImageUrl) && (
                <p className="text-xs text-destructive">
                  Must be a valid URL starting with https:// or http://
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">Description</Label>
              <Textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Describe your universe..."
                rows={4}
                maxLength={1000}
              />
              <p className="text-xs text-muted-foreground text-right">
                {editDescription.length}/1000
              </p>
            </div>

            <div className="flex gap-3 pt-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setShowEditMetadata(false)}
                disabled={isSavingMetadata}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                disabled={isSavingMetadata || (!!editImageUrl && !isValidUrl(editImageUrl))}
                onClick={async () => {
                  const universeId = finalUniverse?.address;
                  if (!universeId) return;
                  setIsSavingMetadata(true);
                  try {
                    const updates: {
                      universeId: string;
                      name?: string;
                      imageUrl?: string;
                      description?: string;
                    } = { universeId };
                    if (editName) updates.name = editName;
                    if (editImageUrl) updates.imageUrl = editImageUrl;
                    if (editDescription) updates.description = editDescription;
                    await trpcClient.universes.updateMetadata.mutate(updates);
                    toast.success('Universe updated');
                    queryClient.invalidateQueries({ queryKey: ['universe-metadata', universeId] });
                    setShowEditMetadata(false);
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : 'Failed to update');
                  } finally {
                    setIsSavingMetadata(false);
                  }
                }}
              >
                {isSavingMetadata ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Save
              </Button>
            </div>

            <p className="text-xs text-muted-foreground text-center">
              On-chain values remain unchanged. This updates the off-chain display metadata.
            </p>
          </div>
        </div>
      )}
    </>
  );
}

// ── Kind icons + labels ─────────────────────────────────────────────

const KIND_CONFIG: Record<string, { icon: typeof User; label: string; color: string }> = {
  person: { icon: User, label: 'Characters', color: 'text-blue-500' },
  place: { icon: MapPin, label: 'Places', color: 'text-emerald-500' },
  faction: { icon: Swords, label: 'Factions', color: 'text-red-500' },
  lore: { icon: Scroll, label: 'Lore', color: 'text-amber-500' },
  event: { icon: Calendar, label: 'Events', color: 'text-orange-500' },
  technology: { icon: Cpu, label: 'Technology', color: 'text-cyan-500' },
  species: { icon: Bug, label: 'Species', color: 'text-green-500' },
  thing: { icon: Package, label: 'Items', color: 'text-violet-500' },
  vehicle: { icon: Car, label: 'Vehicles', color: 'text-slate-500' },
  organization: { icon: Building2, label: 'Organizations', color: 'text-indigo-500' },
};

const KIND_ORDER = [
  'person',
  'place',
  'faction',
  'lore',
  'event',
  'technology',
  'species',
  'thing',
  'vehicle',
  'organization',
];

interface WikiEntity {
  id: string;
  name: string;
  kind: string;
  description?: string;
  imageUrl?: string | null;
}

function WikiEntitiesSection({ universeAddress }: { universeAddress?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [expandedKinds, setExpandedKinds] = useState<Set<string>>(new Set(['person', 'place']));

  const { data, isLoading } = useQuery({
    queryKey: ['sidebar-entities', universeAddress],
    queryFn: async () => {
      if (!universeAddress) return { entities: [] };
      return trpcClient.entities.list.query({ universeAddress });
    },
    enabled: !!universeAddress,
    staleTime: 60_000,
  });

  const entities: WikiEntity[] = data?.entities ?? [];

  if (!universeAddress) return null;

  // Group by kind
  const byKind = new Map<string, WikiEntity[]>();
  for (const entity of entities) {
    const list = byKind.get(entity.kind) || [];
    list.push(entity);
    byKind.set(entity.kind, list);
  }

  const toggleKind = (kind: string) => {
    setExpandedKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  };

  return (
    <div className="border border-blue-200 dark:border-blue-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2.5 bg-gradient-to-r from-blue-50 to-sky-50 dark:from-blue-950/30 dark:to-sky-950/30 hover:from-blue-100 hover:to-sky-100 dark:hover:from-blue-950/50 dark:hover:to-sky-950/50 transition-all duration-300"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-blue-700 dark:text-blue-300">
          <BookOpen className="h-4 w-4" />
          Wiki
          {entities.length > 0 && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
              {entities.length}
            </Badge>
          )}
        </span>
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-blue-500" />
        ) : (
          <ChevronRight className="h-4 w-4 text-blue-500" />
        )}
      </button>

      {expanded && (
        <div className="max-h-[50vh] overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : entities.length === 0 ? (
            <div className="text-center py-4 px-3">
              <p className="text-xs text-muted-foreground mb-2">No entities yet</p>
              <Link to="/create" search={{ universe: universeAddress }}>
                <Button size="sm" variant="outline" className="text-xs h-7">
                  <Plus className="h-3 w-3 mr-1" />
                  Create
                </Button>
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {KIND_ORDER.filter((k) => byKind.has(k)).map((kind) => {
                const config = KIND_CONFIG[kind] || {
                  icon: Package,
                  label: kind,
                  color: 'text-muted-foreground',
                };
                const Icon = config.icon;
                const kindEntities = byKind.get(kind)!;
                const isOpen = expandedKinds.has(kind);

                return (
                  <div key={kind}>
                    <button
                      onClick={() => toggleKind(kind)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-muted/50 transition-colors text-left"
                    >
                      {isOpen ? (
                        <ChevronDown className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                      ) : (
                        <ChevronRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                      )}
                      <Icon className={`h-3.5 w-3.5 ${config.color} flex-shrink-0`} />
                      <span className="text-xs font-medium flex-1">{config.label}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {kindEntities.length}
                      </span>
                    </button>

                    {isOpen && (
                      <div className="pb-1">
                        {kindEntities.map((entity) => (
                          <Link
                            key={entity.id}
                            to="/wiki/entity/$id"
                            params={{ id: entity.id }}
                            className="flex items-center gap-2 px-3 pl-8 py-1 hover:bg-muted/40 transition-colors group"
                          >
                            {entity.imageUrl ? (
                              <img
                                src={resolveIpfsUrl(entity.imageUrl)}
                                alt={entity.name}
                                className="h-6 w-6 rounded object-cover flex-shrink-0 border border-border"
                                loading="lazy"
                              />
                            ) : (
                              <div className="h-6 w-6 rounded bg-muted flex items-center justify-center flex-shrink-0 border border-border">
                                <Icon className={`h-3 w-3 ${config.color}`} />
                              </div>
                            )}
                            <span className="text-xs truncate group-hover:text-foreground text-muted-foreground">
                              {entity.name}
                            </span>
                          </Link>
                        ))}
                        <Link
                          to="/create/$kind"
                          params={{ kind }}
                          search={{ universe: universeAddress }}
                          className="flex items-center gap-2 px-3 pl-8 py-1 hover:bg-muted/40 transition-colors"
                        >
                          <div className="h-6 w-6 rounded border border-dashed border-muted-foreground/40 flex items-center justify-center flex-shrink-0">
                            <Plus className="h-3 w-3 text-muted-foreground" />
                          </div>
                          <span className="text-xs text-muted-foreground italic">
                            Add {config.label.toLowerCase()}...
                          </span>
                        </Link>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Add new kind */}
              <div className="px-3 py-2">
                <Link to="/create" search={{ universe: universeAddress }}>
                  <Button size="sm" variant="ghost" className="w-full text-xs h-7">
                    <Plus className="h-3 w-3 mr-1" />
                    Add Entity
                  </Button>
                </Link>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function UniverseTypeBadge({
  universeId,
  initialType,
  canEdit,
}: {
  universeId?: string;
  initialType?: 'fun' | 'monetized';
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const enabled = !!universeId;

  const { data } = useQuery({
    queryKey: ['universe-type', universeId],
    queryFn: () => trpcClient.universes.getUniverseType.query({ universeId: universeId! }),
    enabled,
    initialData: initialType ? { universeType: initialType } : undefined,
  });

  const [pending, setPending] = useState(false);
  const universeType = (data?.universeType as 'fun' | 'monetized') || initialType || 'monetized';
  const isFun = universeType === 'fun';

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canEdit || !universeId || pending) return;
    const next: 'fun' | 'monetized' = isFun ? 'monetized' : 'fun';
    setPending(true);
    try {
      await trpcClient.universes.setUniverseType.mutate({ universeId, universeType: next });
      queryClient.invalidateQueries({ queryKey: ['universe-type', universeId] });
      queryClient.invalidateQueries({ queryKey: ['universe-metadata', universeId] });
      toast.success(`Marked as ${next === 'fun' ? 'Fun' : 'Monetized'}`);
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to update universe type');
    } finally {
      setPending(false);
    }
  };

  const className = `text-xs px-2 py-0.5 ${
    isFun
      ? 'bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300 border-pink-200 dark:border-pink-800'
      : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
  } ${canEdit ? 'cursor-pointer hover:opacity-80' : ''}`;

  return (
    <Badge
      variant="secondary"
      className={className}
      onClick={canEdit ? handleToggle : undefined}
      title={
        canEdit
          ? `Click to switch to ${isFun ? 'Monetized' : 'Fun'}`
          : isFun
            ? 'Sandbox / no monetization'
            : 'Revenue-bearing universe'
      }
    >
      {isFun ? (
        <>
          <Palette className="h-3 w-3 mr-1" />
          Fun
        </>
      ) : (
        <>
          <DollarSign className="h-3 w-3 mr-1" />
          Monetized
        </>
      )}
    </Badge>
  );
}
