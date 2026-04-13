/**
 * Universe Sidebar
 *
 * Collapsible left sidebar on the timeline editor page. Shows universe metadata,
 * on-chain contract addresses, event/leaf counts, and action buttons for creating
 * events, refreshing the timeline, and opening governance. Expands on hover.
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
  Film,
  Activity,
  ExternalLink,
  Copy,
  CheckCircle,
  Loader2,
  GitBranch,
  ArrowRight,
  Sparkles,
  Vote,
  PanelLeftOpen,
  PanelLeftClose,
  X,
  Target,
  Vault,
} from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { useState, useEffect } from 'react';
import { useChainId } from 'wagmi';
import type { Node } from 'reactflow';
import type { TimelineNodeData } from '@/components/flow/TimelineNodes';
import { getExplorerAddressUrl } from '@/configs/chains';
import { TokenSwapWidget } from '@/components/TokenSwapWidget';
import { SubscribeDialog } from '@/components/SubscribeDialog';
import { UniverseAccessSettings } from '@/components/UniverseAccessSettings';
import { useIsUniverseAdmin } from '@/hooks/useIsUniverseAdmin';
import { Crown, Settings } from 'lucide-react';

interface UniverseSidebarProps {
  finalUniverse: any;
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
}: UniverseSidebarProps) {
  const chainId = useChainId();
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showSubscribe, setShowSubscribe] = useState(false);
  const [showAccessSettings, setShowAccessSettings] = useState(false);
  const { isAdmin } = useIsUniverseAdmin(
    finalUniverse?.address?.startsWith('0x') ? (finalUniverse.address as `0x${string}`) : undefined
  );

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
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const isBlockchainUniverse = finalUniverse?.address?.startsWith('0x');

  return (
    <>
      {/* Mobile toggle button - fixed position */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
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

      {/* Sidebar - hover on desktop, toggle on mobile */}
      <div
        className={`
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
          md:translate-x-0
          fixed md:relative z-40 md:z-auto
          w-72 md:w-16 md:hover:w-80
          group border-r bg-gradient-to-br from-slate-50 via-white to-slate-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 backdrop-blur-sm flex flex-col shadow-xl border-slate-200 dark:border-slate-700 transition-all duration-300 ease-in-out overflow-hidden
          h-full
        `}
      >
        {/* Mobile close button */}
        <button
          onClick={() => setMobileOpen(false)}
          className="md:hidden absolute top-3 right-3 z-10 p-1 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Collapsed state indicator - desktop only */}
        <div className="hidden md:flex absolute inset-0 flex-col items-center justify-center opacity-100 group-hover:opacity-0 transition-opacity duration-200 pointer-events-none">
          <div className="text-slate-400 dark:text-slate-500 mb-2">
            <ArrowRight className="h-4 w-4" />
          </div>
          <div className="flex flex-col items-center space-y-2">
            <div
              className={`w-2 h-2 rounded-full ${isLoadingAny ? 'bg-amber-500 animate-pulse' : nodes.length > 0 ? 'bg-emerald-500' : 'bg-slate-400'}`}
            />
            {isBlockchainUniverse && <Sparkles className="h-3 w-3 text-blue-500" />}
          </div>
        </div>

        <div className="flex-1 p-4 overflow-y-auto min-h-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-300 md:delay-150">
          <div className="space-y-4">
            {/* Enhanced Back Button */}
            <div>
              <Button
                variant="ghost"
                size="sm"
                asChild
                className="hover:bg-primary/10 hover:text-primary transition-all duration-300 group w-full justify-start"
              >
                <Link to="/">
                  <ArrowLeft className="h-4 w-4 mr-2 group-hover:-translate-x-1 transition-transform duration-300" />
                  Go Back Home
                </Link>
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
                    <div className="flex items-center gap-2 mb-1">
                      <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 truncate">
                        {finalUniverse?.name}
                      </h2>
                      {isBlockchainUniverse && (
                        <Badge
                          variant="secondary"
                          className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 border-blue-200 dark:border-blue-800"
                        >
                          <Sparkles className="h-3 w-3 mr-1" />
                          On-Chain
                        </Badge>
                      )}
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
                      onClick={() => copyToClipboard(finalUniverse.address)}
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
                  {isBlockchainUniverse && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full mt-2 h-7 text-xs border-violet-200 dark:border-violet-700 hover:bg-violet-100 dark:hover:bg-violet-900/50"
                      onClick={() =>
                        window.open(getExplorerAddressUrl(chainId, finalUniverse.address), '_blank')
                      }
                    >
                      <ExternalLink className="h-3 w-3 mr-1" />
                      View on Etherscan
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
                      onClick={() => copyToClipboard(finalUniverse.tokenAddress)}
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
                      window.open(
                        getExplorerAddressUrl(chainId, finalUniverse.tokenAddress),
                        '_blank'
                      )
                    }
                  >
                    <ExternalLink className="h-3 w-3 mr-1" />
                    View on Etherscan
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Token Swap Widget */}
            {isBlockchainUniverse && finalUniverse?.tokenAddress && finalUniverse?.address && (
              <TokenSwapWidget universeAddress={finalUniverse.address} compact />
            )}

            {/* Enhanced Action Buttons */}
            <div className="space-y-3">
              <Button
                onClick={() => handleAddEvent('after')}
                className="w-full bg-gradient-to-r from-primary via-primary to-primary/90 hover:from-primary/90 hover:via-primary/80 hover:to-primary/70 shadow-lg hover:shadow-xl transition-all duration-300 group h-10"
                size="sm"
              >
                <Plus className="h-4 w-4 mr-2 group-hover:rotate-90 transition-transform duration-300" />
                Create Event
              </Button>

              {/* Govern button - only show for blockchain universes with governance configured */}
              {isBlockchainUniverse &&
                onOpenGovernance &&
                finalUniverse?.governanceAddress &&
                finalUniverse?.tokenAddress && (
                  <Button
                    onClick={onOpenGovernance}
                    className="w-full bg-gradient-to-r from-violet-600 via-violet-600 to-violet-700 hover:from-violet-700 hover:via-violet-800 hover:to-violet-800 shadow-lg hover:shadow-xl transition-all duration-300 group h-10"
                    size="sm"
                  >
                    <Vote className="h-4 w-4 mr-2 group-hover:scale-110 transition-transform duration-300" />
                    Govern
                  </Button>
                )}

              {/* Subscribe button */}
              {isBlockchainUniverse && (
                <Button
                  onClick={() => setShowSubscribe(true)}
                  className="w-full bg-gradient-to-r from-amber-600 via-amber-600 to-amber-700 hover:from-amber-700 hover:via-amber-800 hover:to-amber-800 shadow-lg hover:shadow-xl transition-all duration-300 group h-10"
                  size="sm"
                >
                  <Crown className="h-4 w-4 mr-2 group-hover:scale-110 transition-transform duration-300" />
                  Subscribe
                </Button>
              )}

              {/* Access Settings button — admin only */}
              {isBlockchainUniverse && isAdmin && (
                <Button
                  onClick={() => setShowAccessSettings(true)}
                  variant="outline"
                  className="w-full border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all duration-300 group h-9"
                  size="sm"
                >
                  <Settings className="h-4 w-4 mr-2 group-hover:rotate-90 transition-transform duration-500" />
                  Access Settings
                </Button>
              )}

              {/* Gallery button */}
              <Link to={`/universe/${finalUniverse?.address || finalUniverse?.id}/gallery` as any}>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full bg-gradient-to-r from-pink-50 to-rose-50 dark:from-pink-950/30 dark:to-rose-950/30 hover:from-pink-100 hover:to-rose-100 dark:hover:from-pink-950/50 dark:hover:to-rose-950/50 border-pink-200 dark:border-pink-800 transition-all duration-300 group h-10"
                >
                  <Film className="h-4 w-4 mr-2 group-hover:scale-110 transition-transform duration-300 text-pink-600 dark:text-pink-400" />
                  Gallery
                </Button>
              </Link>

              {/* Gen Config button - only show for universe admin */}
              {isBlockchainUniverse && (
                <Link
                  to={`/universe/${finalUniverse?.address || finalUniverse?.id}/gen-config` as any}
                >
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full bg-gradient-to-r from-cyan-50 to-teal-50 dark:from-cyan-950/30 dark:to-teal-950/30 hover:from-cyan-100 hover:to-teal-100 dark:hover:from-cyan-950/50 dark:hover:to-teal-950/50 border-cyan-200 dark:border-cyan-800 transition-all duration-300 group h-10"
                  >
                    <Sparkles className="h-4 w-4 mr-2 group-hover:scale-110 transition-transform duration-300 text-cyan-600 dark:text-cyan-400" />
                    Gen Config
                  </Button>
                </Link>
              )}

              {/* Treasury button */}
              {isBlockchainUniverse && (
                <Link to={`/treasury/${finalUniverse?.address || finalUniverse?.id}` as any}>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full bg-gradient-to-r from-emerald-50 to-green-50 dark:from-emerald-950/30 dark:to-green-950/30 hover:from-emerald-100 hover:to-green-100 dark:hover:from-emerald-950/50 dark:hover:to-green-950/50 border-emerald-200 dark:border-emerald-800 transition-all duration-300 group h-10"
                  >
                    <Vault className="h-4 w-4 mr-2 group-hover:scale-110 transition-transform duration-300 text-emerald-600 dark:text-emerald-400" />
                    Treasury
                  </Button>
                </Link>
              )}

              {/* Bounties button */}
              <Link
                to="/bounties"
                search={{ universeId: finalUniverse?.address || finalUniverse?.id }}
              >
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full bg-gradient-to-r from-orange-50 to-amber-50 dark:from-orange-950/30 dark:to-amber-950/30 hover:from-orange-100 hover:to-amber-100 dark:hover:from-orange-950/50 dark:hover:to-amber-950/50 border-orange-200 dark:border-orange-800 transition-all duration-300 group h-10"
                >
                  <Target className="h-4 w-4 mr-2 group-hover:scale-110 transition-transform duration-300 text-orange-600 dark:text-orange-400" />
                  Bounties
                </Button>
              </Link>

              <Button
                onClick={handleRefreshTimeline}
                variant="outline"
                size="sm"
                className="w-full hover:bg-slate-50 dark:hover:bg-slate-800 transition-all duration-300 group h-9 border-slate-200 dark:border-slate-700"
                disabled={isLoadingAny}
              >
                <RefreshCw
                  className={`h-3 w-3 mr-2 group-hover:rotate-180 transition-transform duration-500 ${isLoadingAny ? 'animate-spin' : ''}`}
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
    </>
  );
}
