import { useState, useEffect, useCallback, useRef } from 'react';
import { useWalletAuth, getSiweAddress } from '@/lib/wallet-auth';
import { useRouterState } from '@tanstack/react-router';
import { useAccount, useChainId, useBalance } from 'wagmi';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import {
  X,
  Bug,
  Database,
  Globe,
  Wallet,
  User,
  Trash2,
  RefreshCw,
  Copy,
  ChevronDown,
  ChevronUp,
  Shield,
  Activity,
  Gauge,
  HardDrive,
  Network,
  Clock,
  BarChart3,
  Eye,
  Zap,
  Film,
} from 'lucide-react';
import { AdminModelAnalytics } from './AdminModelAnalytics';
import { toast } from 'sonner';

// ── Admin gate ──────────────────────────────────────────────────
const ADMIN_ADDRESSES = (import.meta.env.VITE_ADMIN_ADDRESSES ?? '')
  .split(',')
  .map((a: string) => a.trim().toLowerCase())
  .filter(Boolean);

function isAdmin(address: string | null | undefined): boolean {
  if (!address) return false;
  if (ADMIN_ADDRESSES.length === 0) return true;
  return ADMIN_ADDRESSES.includes(address.toLowerCase());
}

// ── Types ───────────────────────────────────────────────────────
interface PerfMetrics {
  // Page load
  domContentLoaded: number | null;
  fullLoad: number | null;
  firstPaint: number | null;
  firstContentfulPaint: number | null;
  largestContentfulPaint: number | null;
  // Interactivity
  firstInputDelay: number | null;
  interactionToNextPaint: number | null;
  // Layout
  cumulativeLayoutShift: number | null;
  // Resources
  resourceCount: number;
  transferSize: number;
  domNodes: number;
  // JS heap
  jsHeapUsed: number | null;
  jsHeapTotal: number | null;
  jsHeapLimit: number | null;
}

interface NavEntry {
  path: string;
  timestamp: number;
  duration: number | null;
}

interface NetworkEntry {
  name: string;
  type: string;
  duration: number;
  size: number;
  status: 'ok' | 'slow' | 'error';
  timestamp: number;
}

// ── Helpers ─────────────────────────────────────────────────────
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatMs(ms: number | null): string {
  if (ms === null) return '—';
  return `${ms.toFixed(1)}ms`;
}

function metricColor(val: number | null, good: number, poor: number): string {
  if (val === null) return 'text-zinc-500';
  if (val <= good) return 'text-green-400';
  if (val <= poor) return 'text-yellow-400';
  return 'text-red-400';
}

function clsColor(val: number | null): string {
  if (val === null) return 'text-zinc-500';
  if (val <= 0.1) return 'text-green-400';
  if (val <= 0.25) return 'text-yellow-400';
  return 'text-red-400';
}

function getStorageUsage(): { local: number; session: number; cookies: number } {
  let local = 0;
  let session = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      local += key.length + (localStorage.getItem(key)?.length ?? 0);
    }
  } catch {
    /* ignore */
  }
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i)!;
      session += key.length + (sessionStorage.getItem(key)?.length ?? 0);
    }
  } catch {
    /* ignore */
  }
  const cookies = document.cookie.length;
  return { local: local * 2, session: session * 2, cookies: cookies * 2 }; // *2 for UTF-16
}

// ── Section toggle button ───────────────────────────────────────
function SectionToggle({
  label,
  icon: Icon,
  section,
  expanded,
  onToggle,
  badge,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  section: string;
  expanded: string | null;
  onToggle: (s: string) => void;
  badge?: React.ReactNode;
}) {
  return (
    <button
      onClick={() => onToggle(section)}
      className="flex items-center gap-2 w-full text-left text-xs py-1 hover:text-white text-zinc-400"
    >
      {expanded === section ? (
        <ChevronUp className="h-3 w-3" />
      ) : (
        <ChevronDown className="h-3 w-3" />
      )}
      <Icon className="h-3 w-3" />
      {label}
      {badge}
    </button>
  );
}

// ── Main Component ──────────────────────────────────────────────
export default function AdminToolbar() {
  const [open, setOpen] = useState(false);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [perf, setPerf] = useState<PerfMetrics | null>(null);
  const [navHistory, setNavHistory] = useState<NavEntry[]>([]);
  const [networkEntries, setNetworkEntries] = useState<NetworkEntry[]>([]);
  const [fps, setFps] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<'info' | 'analytics'>('analytics');
  const lastPathRef = useRef<string>('');
  const lastNavTimeRef = useRef<number>(Date.now());

  const { address: walletAddress, isAuthenticated } = useWalletAuth();
  const routerState = useRouterState();
  const { address, isConnected, connector } = useAccount();
  const chainId = useChainId();
  const { data: balance } = useBalance({ address });

  const toggle = useCallback(() => setOpen((o) => !o), []);

  // Keyboard shortcut
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey && e.shiftKey && e.key === 'A') {
        e.preventDefault();
        toggle();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggle]);

  // ── Collect performance metrics ──────────────────────────────
  useEffect(() => {
    if (!open) return;

    function collect() {
      const nav = performance.getEntriesByType('navigation')[0] as
        | PerformanceNavigationTiming
        | undefined;
      const paint = performance.getEntriesByType('paint');
      const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      const mem = (performance as any).memory;

      const fp = paint.find((p) => p.name === 'first-paint');
      const fcp = paint.find((p) => p.name === 'first-contentful-paint');

      const totalTransfer = resources.reduce((sum, r) => sum + (r.transferSize || 0), 0);

      setPerf({
        domContentLoaded: nav ? nav.domContentLoadedEventEnd - nav.startTime : null,
        fullLoad: nav ? nav.loadEventEnd - nav.startTime : null,
        firstPaint: fp ? fp.startTime : null,
        firstContentfulPaint: fcp ? fcp.startTime : null,
        largestContentfulPaint: null, // set by observer
        firstInputDelay: null,
        interactionToNextPaint: null,
        cumulativeLayoutShift: null,
        resourceCount: resources.length,
        transferSize: totalTransfer + (nav?.transferSize ?? 0),
        domNodes: document.querySelectorAll('*').length,
        jsHeapUsed: mem?.usedJSHeapSize ?? null,
        jsHeapTotal: mem?.totalJSHeapSize ?? null,
        jsHeapLimit: mem?.jsHeapSizeLimit ?? null,
      });
    }

    collect();
    const interval = setInterval(collect, 3000);
    return () => clearInterval(interval);
  }, [open]);

  // ── Web Vitals observers ─────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const observers: PerformanceObserver[] = [];

    try {
      const lcpObs = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1];
        if (last) setPerf((p) => (p ? { ...p, largestContentfulPaint: last.startTime } : p));
      });
      lcpObs.observe({ type: 'largest-contentful-paint', buffered: true });
      observers.push(lcpObs);
    } catch {
      /* ignore */
    }

    try {
      const fidObs = new PerformanceObserver((list) => {
        const entry = list.getEntries()[0] as PerformanceEventTiming;
        if (entry)
          setPerf((p) =>
            p ? { ...p, firstInputDelay: entry.processingStart - entry.startTime } : p
          );
      });
      fidObs.observe({ type: 'first-input', buffered: true });
      observers.push(fidObs);
    } catch {
      /* ignore */
    }

    try {
      let clsValue = 0;
      const clsObs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as any[]) {
          if (!entry.hadRecentInput) clsValue += entry.value;
        }
        setPerf((p) => (p ? { ...p, cumulativeLayoutShift: clsValue } : p));
      });
      clsObs.observe({ type: 'layout-shift', buffered: true });
      observers.push(clsObs);
    } catch {
      /* ignore */
    }

    try {
      const inpObs = new PerformanceObserver((list) => {
        let maxDur = 0;
        for (const entry of list.getEntries() as PerformanceEventTiming[]) {
          maxDur = Math.max(maxDur, entry.duration);
        }
        if (maxDur > 0) setPerf((p) => (p ? { ...p, interactionToNextPaint: maxDur } : p));
      });
      inpObs.observe({ type: 'event', buffered: true });
      observers.push(inpObs);
    } catch {
      /* ignore */
    }

    return () => observers.forEach((o) => o.disconnect());
  }, [open]);

  // ── FPS counter ──────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    let frames = 0;
    let lastTime = performance.now();
    let rafId: number;

    function loop(now: number) {
      frames++;
      if (now - lastTime >= 1000) {
        setFps(frames);
        frames = 0;
        lastTime = now;
      }
      rafId = requestAnimationFrame(loop);
    }
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [open]);

  // ── Navigation history ───────────────────────────────────────
  useEffect(() => {
    const path = routerState.location.pathname;
    if (path !== lastPathRef.current) {
      const now = Date.now();
      const duration = lastPathRef.current ? now - lastNavTimeRef.current : null;
      setNavHistory((prev) => [{ path, timestamp: now, duration }, ...prev].slice(0, 50));
      lastPathRef.current = path;
      lastNavTimeRef.current = now;
    }
  }, [routerState.location.pathname]);

  // ── Network observer ─────────────────────────────────────────
  useEffect(() => {
    if (!open) return;

    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries() as PerformanceResourceTiming[];
      const newEntries: NetworkEntry[] = entries.map((e) => {
        const url = new URL(e.name, window.location.origin);
        const shortName = url.pathname.split('/').pop() || url.pathname;
        return {
          name: shortName.length > 40 ? `${shortName.slice(0, 37)}...` : shortName,
          type: e.initiatorType,
          duration: e.duration,
          size: e.transferSize || 0,
          status: e.duration > 3000 ? 'error' : e.duration > 1000 ? 'slow' : 'ok',
          timestamp: Date.now(),
        };
      });
      setNetworkEntries((prev) => [...newEntries, ...prev].slice(0, 100));
    });

    try {
      observer.observe({ type: 'resource', buffered: true });
    } catch {
      /* ignore */
    }

    return () => observer.disconnect();
  }, [open]);

  // Don't render for non-admins
  if (!isAuthenticated || !isAdmin(walletAddress)) return null;

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`Copied ${label}`);
  };

  const clearQueryCache = () => {
    const queryClient = (window as any).__REACT_QUERY_DEVTOOLS_QUERY_CLIENT__;
    if (queryClient) {
      queryClient.clear();
      toast.success('Query cache cleared');
    } else {
      toast.info('Query client not available — try React Query devtools');
    }
  };

  const clearLocalStorage = () => {
    localStorage.clear();
    toast.success('localStorage cleared — reload to take effect');
  };

  const clearSessionStorage = () => {
    sessionStorage.clear();
    toast.success('sessionStorage cleared');
  };

  const toggleSection = (section: string) => {
    setExpandedSection((prev) => (prev === section ? null : section));
  };

  const envVars = {
    VITE_SERVER_URL: import.meta.env.VITE_SERVER_URL,
    VITE_PONDER_URL: import.meta.env.VITE_PONDER_URL,
    VITE_FIREBASE_PROJECT_ID: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    MODE: import.meta.env.MODE,
    DEV: import.meta.env.DEV ? 'true' : 'false',
    PROD: import.meta.env.PROD ? 'true' : 'false',
  };

  const storage = getStorageUsage();
  const fpsColor = fps >= 55 ? 'text-green-400' : fps >= 30 ? 'text-yellow-400' : 'text-red-400';

  // ── Closed state: small fab ──────────────────────────────────
  if (!open) {
    return (
      <button
        onClick={toggle}
        className="fixed bottom-4 right-4 z-[9999] bg-orange-600 hover:bg-orange-700 text-white rounded-full p-2 shadow-lg transition-all opacity-40 hover:opacity-100"
        title="Admin Toolbar (Ctrl+Shift+A)"
      >
        <Shield className="h-4 w-4" />
      </button>
    );
  }

  // ── Open state ───────────────────────────────────────────────
  return (
    <div className="fixed bottom-0 left-0 right-0 z-[9999] bg-zinc-950 border-t border-zinc-800 text-zinc-200 shadow-2xl max-h-[60vh] overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-orange-500" />
            <span className="text-sm font-semibold text-orange-500">Admin Toolbar</span>
            <Badge variant="outline" className="text-[10px] border-zinc-700 text-zinc-400">
              {import.meta.env.MODE}
            </Badge>
          </div>

          {/* Tab switcher */}
          <div className="flex items-center gap-1 bg-zinc-800 rounded-md p-0.5">
            <button
              onClick={() => setActiveTab('analytics')}
              className={`px-2 py-0.5 text-[10px] rounded ${activeTab === 'analytics' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              Analytics
            </button>
            <button
              onClick={() => setActiveTab('info')}
              className={`px-2 py-0.5 text-[10px] rounded ${activeTab === 'info' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              System Info
            </button>
          </div>

          {/* Live stats */}
          <div className="flex items-center gap-3 text-[10px]">
            <span className={fpsColor}>{fps} FPS</span>
            <span className="text-zinc-500">{perf?.domNodes ?? '—'} DOM</span>
            {perf?.jsHeapUsed && (
              <span className="text-zinc-500">{formatBytes(perf.jsHeapUsed)} heap</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-500">Ctrl+Shift+A</span>
          <button onClick={toggle} className="text-zinc-400 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Quick Info Bar */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-2 text-xs border-b border-zinc-800 bg-zinc-900/50">
        <div className="flex items-center gap-1.5">
          <User className="h-3 w-3 text-blue-400" />
          <span className="text-zinc-400">Wallet:</span>
          <span className="font-mono">
            {walletAddress ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : 'N/A'}
          </span>
          <button
            onClick={() => walletAddress && copyToClipboard(walletAddress, 'Address')}
            className="text-zinc-500 hover:text-zinc-300"
            title={`Address: ${walletAddress}`}
          >
            <Copy className="h-3 w-3" />
          </button>
        </div>
        <span className="text-zinc-700">|</span>
        <div className="flex items-center gap-1.5">
          <Globe className="h-3 w-3 text-green-400" />
          <span className="text-zinc-400">Route:</span>
          <span className="font-mono">{routerState.location.pathname}</span>
        </div>
        <span className="text-zinc-700">|</span>
        <div className="flex items-center gap-1.5">
          <Wallet className="h-3 w-3 text-purple-400" />
          <span className="text-zinc-400">Wallet:</span>
          {isConnected ? (
            <>
              <span className="font-mono">
                {address?.slice(0, 6)}...{address?.slice(-4)}
              </span>
              <button
                onClick={() => copyToClipboard(address ?? '', 'address')}
                className="text-zinc-500 hover:text-zinc-300"
              >
                <Copy className="h-3 w-3" />
              </button>
              <Badge variant="outline" className="text-[10px] border-zinc-700">
                Chain {chainId}
              </Badge>
              {balance && (
                <span className="text-zinc-400">
                  {parseFloat(balance.formatted).toFixed(4)} {balance.symbol}
                </span>
              )}
            </>
          ) : (
            <span className="text-zinc-500">Not connected</span>
          )}
        </div>
      </div>

      {/* ═══════════ ANALYTICS TAB ═══════════ */}
      {activeTab === 'analytics' && (
        <div className="px-4 py-2 space-y-1">
          {/* ── AI Generation Economics ── */}
          <SectionToggle
            label="AI Generation Economics"
            icon={Film}
            section="generation"
            expanded={expandedSection}
            onToggle={toggleSection}
            badge={
              <Badge variant="outline" className="text-[9px] border-amber-700 text-amber-400 ml-1">
                $LOAR
              </Badge>
            }
          />
          {expandedSection === 'generation' && (
            <div className="ml-5 pb-3">
              <AdminModelAnalytics />
            </div>
          )}

          {/* ── Core Web Vitals ── */}
          <SectionToggle
            label="Core Web Vitals"
            icon={Gauge}
            section="vitals"
            expanded={expandedSection}
            onToggle={toggleSection}
          />
          {expandedSection === 'vitals' && perf && (
            <div className="ml-5 pb-3">
              <div className="grid grid-cols-3 gap-4 text-[11px]">
                {/* LCP */}
                <div className="bg-zinc-900 rounded-md p-2">
                  <div className="text-zinc-500 mb-1">LCP (Largest Contentful Paint)</div>
                  <div
                    className={`text-lg font-mono font-bold ${metricColor(perf.largestContentfulPaint, 2500, 4000)}`}
                  >
                    {perf.largestContentfulPaint !== null
                      ? `${(perf.largestContentfulPaint / 1000).toFixed(2)}s`
                      : '—'}
                  </div>
                  <div className="text-zinc-600 text-[10px]">Good &lt; 2.5s</div>
                </div>
                {/* FID */}
                <div className="bg-zinc-900 rounded-md p-2">
                  <div className="text-zinc-500 mb-1">FID (First Input Delay)</div>
                  <div
                    className={`text-lg font-mono font-bold ${metricColor(perf.firstInputDelay, 100, 300)}`}
                  >
                    {formatMs(perf.firstInputDelay)}
                  </div>
                  <div className="text-zinc-600 text-[10px]">Good &lt; 100ms</div>
                </div>
                {/* CLS */}
                <div className="bg-zinc-900 rounded-md p-2">
                  <div className="text-zinc-500 mb-1">CLS (Cumulative Layout Shift)</div>
                  <div
                    className={`text-lg font-mono font-bold ${clsColor(perf.cumulativeLayoutShift)}`}
                  >
                    {perf.cumulativeLayoutShift !== null
                      ? perf.cumulativeLayoutShift.toFixed(4)
                      : '—'}
                  </div>
                  <div className="text-zinc-600 text-[10px]">Good &lt; 0.1</div>
                </div>
                {/* INP */}
                <div className="bg-zinc-900 rounded-md p-2">
                  <div className="text-zinc-500 mb-1">INP (Interaction to Next Paint)</div>
                  <div
                    className={`text-lg font-mono font-bold ${metricColor(perf.interactionToNextPaint, 200, 500)}`}
                  >
                    {formatMs(perf.interactionToNextPaint)}
                  </div>
                  <div className="text-zinc-600 text-[10px]">Good &lt; 200ms</div>
                </div>
                {/* FP */}
                <div className="bg-zinc-900 rounded-md p-2">
                  <div className="text-zinc-500 mb-1">First Paint</div>
                  <div
                    className={`text-lg font-mono font-bold ${metricColor(perf.firstPaint, 1000, 3000)}`}
                  >
                    {formatMs(perf.firstPaint)}
                  </div>
                </div>
                {/* FCP */}
                <div className="bg-zinc-900 rounded-md p-2">
                  <div className="text-zinc-500 mb-1">FCP (First Contentful Paint)</div>
                  <div
                    className={`text-lg font-mono font-bold ${metricColor(perf.firstContentfulPaint, 1800, 3000)}`}
                  >
                    {formatMs(perf.firstContentfulPaint)}
                  </div>
                  <div className="text-zinc-600 text-[10px]">Good &lt; 1.8s</div>
                </div>
              </div>
            </div>
          )}

          {/* ── Page Load Timing ── */}
          <SectionToggle
            label="Page Load Timing"
            icon={Clock}
            section="timing"
            expanded={expandedSection}
            onToggle={toggleSection}
          />
          {expandedSection === 'timing' && perf && (
            <div className="ml-5 pb-3">
              <div className="space-y-2 text-[11px]">
                {/* Timeline bar */}
                <div className="bg-zinc-900 rounded-md p-3">
                  <div className="space-y-1.5">
                    {[
                      {
                        label: 'DOM Content Loaded',
                        val: perf.domContentLoaded,
                        color: 'bg-blue-500',
                      },
                      { label: 'Full Page Load', val: perf.fullLoad, color: 'bg-green-500' },
                      { label: 'First Paint', val: perf.firstPaint, color: 'bg-yellow-500' },
                      {
                        label: 'First Contentful Paint',
                        val: perf.firstContentfulPaint,
                        color: 'bg-purple-500',
                      },
                    ].map(({ label, val, color }) => (
                      <div key={label} className="flex items-center gap-2">
                        <span className="text-zinc-500 w-40 shrink-0">{label}</span>
                        <div className="flex-1 bg-zinc-800 rounded-full h-2 overflow-hidden">
                          <div
                            className={`h-full ${color} rounded-full`}
                            style={{
                              width: `${Math.min(100, ((val ?? 0) / Math.max(perf.fullLoad ?? 1, 1)) * 100)}%`,
                            }}
                          />
                        </div>
                        <span className="font-mono text-zinc-300 w-16 text-right">
                          {formatMs(val)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex gap-4 text-zinc-400">
                  <span>
                    Resources: <strong className="text-zinc-200">{perf.resourceCount}</strong>
                  </span>
                  <span>
                    Transfer:{' '}
                    <strong className="text-zinc-200">{formatBytes(perf.transferSize)}</strong>
                  </span>
                  <span>
                    DOM Nodes: <strong className="text-zinc-200">{perf.domNodes}</strong>
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* ── Real-time Performance ── */}
          <SectionToggle
            label="Real-time Performance"
            icon={Activity}
            section="realtime"
            expanded={expandedSection}
            onToggle={toggleSection}
            badge={<span className={`text-[10px] ml-1 font-mono ${fpsColor}`}>{fps} FPS</span>}
          />
          {expandedSection === 'realtime' && (
            <div className="ml-5 pb-3">
              <div className="grid grid-cols-4 gap-3 text-[11px]">
                <div className="bg-zinc-900 rounded-md p-2 text-center">
                  <div className="text-zinc-500 mb-1">FPS</div>
                  <div className={`text-2xl font-mono font-bold ${fpsColor}`}>{fps}</div>
                </div>
                <div className="bg-zinc-900 rounded-md p-2 text-center">
                  <div className="text-zinc-500 mb-1">DOM Nodes</div>
                  <div className="text-2xl font-mono font-bold text-zinc-200">
                    {perf?.domNodes ?? '—'}
                  </div>
                </div>
                <div className="bg-zinc-900 rounded-md p-2 text-center">
                  <div className="text-zinc-500 mb-1">JS Heap</div>
                  <div className="text-lg font-mono font-bold text-zinc-200">
                    {perf?.jsHeapUsed ? formatBytes(perf.jsHeapUsed) : '—'}
                  </div>
                  {perf?.jsHeapTotal && perf.jsHeapUsed && (
                    <div className="mt-1">
                      <div className="bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="h-full bg-blue-500 rounded-full"
                          style={{ width: `${(perf.jsHeapUsed / perf.jsHeapTotal) * 100}%` }}
                        />
                      </div>
                      <div className="text-[10px] text-zinc-600 mt-0.5">
                        of {formatBytes(perf.jsHeapTotal)}
                      </div>
                    </div>
                  )}
                </div>
                <div className="bg-zinc-900 rounded-md p-2 text-center">
                  <div className="text-zinc-500 mb-1">Resources</div>
                  <div className="text-2xl font-mono font-bold text-zinc-200">
                    {perf?.resourceCount ?? '—'}
                  </div>
                  <div className="text-[10px] text-zinc-600">
                    {perf ? formatBytes(perf.transferSize) : '—'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Network Requests ── */}
          <SectionToggle
            label="Network Requests"
            icon={Network}
            section="network"
            expanded={expandedSection}
            onToggle={toggleSection}
            badge={
              <Badge variant="outline" className="text-[10px] border-zinc-700 text-zinc-500 ml-1">
                {networkEntries.length}
              </Badge>
            }
          />
          {expandedSection === 'network' && (
            <div className="ml-5 pb-3 max-h-48 overflow-y-auto">
              <table className="w-full text-[11px]">
                <thead className="text-zinc-500 sticky top-0 bg-zinc-950">
                  <tr>
                    <th className="text-left py-1 pr-2">Resource</th>
                    <th className="text-left py-1 pr-2">Type</th>
                    <th className="text-right py-1 pr-2">Size</th>
                    <th className="text-right py-1">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {networkEntries.slice(0, 50).map((entry, i) => (
                    <tr key={`${entry.name}-${i}`} className="border-t border-zinc-900">
                      <td className="py-0.5 pr-2 font-mono truncate max-w-[200px]">{entry.name}</td>
                      <td className="py-0.5 pr-2 text-zinc-500">{entry.type}</td>
                      <td className="py-0.5 pr-2 text-right text-zinc-400">
                        {entry.size ? formatBytes(entry.size) : '—'}
                      </td>
                      <td
                        className={`py-0.5 text-right font-mono ${
                          entry.status === 'error'
                            ? 'text-red-400'
                            : entry.status === 'slow'
                              ? 'text-yellow-400'
                              : 'text-green-400'
                        }`}
                      >
                        {formatMs(entry.duration)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {networkEntries.length === 0 && (
                <div className="text-zinc-500 text-center py-2">No requests captured yet</div>
              )}
            </div>
          )}

          {/* ── Navigation History ── */}
          <SectionToggle
            label="Navigation History"
            icon={Eye}
            section="navhistory"
            expanded={expandedSection}
            onToggle={toggleSection}
            badge={
              <Badge variant="outline" className="text-[10px] border-zinc-700 text-zinc-500 ml-1">
                {navHistory.length} pages
              </Badge>
            }
          />
          {expandedSection === 'navhistory' && (
            <div className="ml-5 pb-3 max-h-40 overflow-y-auto">
              {navHistory.map((entry, i) => (
                <div
                  key={`${entry.timestamp}-${i}`}
                  className="flex items-center gap-2 text-[11px] py-0.5"
                >
                  <span className="text-zinc-600 font-mono w-16 shrink-0">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                  <span className="font-mono">{entry.path}</span>
                  {entry.duration !== null && (
                    <span className="text-zinc-500 text-[10px]">
                      ({(entry.duration / 1000).toFixed(1)}s on prev)
                    </span>
                  )}
                </div>
              ))}
              {navHistory.length === 0 && (
                <div className="text-zinc-500 text-center py-2">No navigations yet</div>
              )}
            </div>
          )}

          {/* ── Storage Usage ── */}
          <SectionToggle
            label="Storage Usage"
            icon={HardDrive}
            section="storage"
            expanded={expandedSection}
            onToggle={toggleSection}
          />
          {expandedSection === 'storage' && (
            <div className="ml-5 pb-3">
              <div className="grid grid-cols-3 gap-3 text-[11px]">
                <div className="bg-zinc-900 rounded-md p-2">
                  <div className="text-zinc-500 mb-1">localStorage</div>
                  <div className="font-mono font-bold text-zinc-200">
                    {formatBytes(storage.local)}
                  </div>
                  <div className="text-[10px] text-zinc-600">{localStorage.length} keys</div>
                </div>
                <div className="bg-zinc-900 rounded-md p-2">
                  <div className="text-zinc-500 mb-1">sessionStorage</div>
                  <div className="font-mono font-bold text-zinc-200">
                    {formatBytes(storage.session)}
                  </div>
                  <div className="text-[10px] text-zinc-600">{sessionStorage.length} keys</div>
                </div>
                <div className="bg-zinc-900 rounded-md p-2">
                  <div className="text-zinc-500 mb-1">Cookies</div>
                  <div className="font-mono font-bold text-zinc-200">
                    {formatBytes(storage.cookies)}
                  </div>
                </div>
              </div>
              {/* localStorage keys breakdown */}
              <div className="mt-2 text-[10px]">
                <div className="text-zinc-500 mb-1">localStorage keys:</div>
                <div className="max-h-24 overflow-y-auto space-y-0.5">
                  {Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!).map(
                    (key) => (
                      <div key={key} className="flex justify-between font-mono">
                        <span className="text-zinc-400 truncate max-w-[200px]">{key}</span>
                        <span className="text-zinc-600">
                          {formatBytes((localStorage.getItem(key)?.length ?? 0) * 2)}
                        </span>
                      </div>
                    )
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══════════ SYSTEM INFO TAB ═══════════ */}
      {activeTab === 'info' && (
        <div className="px-4 py-2 space-y-1">
          {/* Environment Variables */}
          <SectionToggle
            label="Environment Variables"
            icon={Database}
            section="env"
            expanded={expandedSection}
            onToggle={toggleSection}
          />
          {expandedSection === 'env' && (
            <div className="ml-5 space-y-1 pb-2">
              {Object.entries(envVars).map(([key, val]) => (
                <div key={key} className="flex items-center gap-2 text-[11px] font-mono">
                  <span className="text-zinc-500">{key}:</span>
                  <span className="text-zinc-300">{val ?? '(not set)'}</span>
                </div>
              ))}
            </div>
          )}

          {/* Router State */}
          <SectionToggle
            label="Router State"
            icon={Globe}
            section="router"
            expanded={expandedSection}
            onToggle={toggleSection}
          />
          {expandedSection === 'router' && (
            <div className="ml-5 space-y-1 pb-2 text-[11px] font-mono">
              <div>
                <span className="text-zinc-500">pathname: </span>
                <span>{routerState.location.pathname}</span>
              </div>
              <div>
                <span className="text-zinc-500">search: </span>
                <span>{JSON.stringify(routerState.location.search)}</span>
              </div>
              <div>
                <span className="text-zinc-500">hash: </span>
                <span>{routerState.location.hash || '(none)'}</span>
              </div>
              <div>
                <span className="text-zinc-500">status: </span>
                <span>{routerState.status}</span>
              </div>
              <div>
                <span className="text-zinc-500">isLoading: </span>
                <span>{String(routerState.isLoading)}</span>
              </div>
            </div>
          )}

          {/* Auth Details */}
          <SectionToggle
            label="Auth Details"
            icon={User}
            section="auth"
            expanded={expandedSection}
            onToggle={toggleSection}
          />
          {expandedSection === 'auth' && (
            <div className="ml-5 space-y-1 pb-2 text-[11px] font-mono">
              <div>
                <span className="text-zinc-500">address: </span>
                <span>{walletAddress || '(not connected)'}</span>
              </div>
              <div>
                <span className="text-zinc-500">authenticated: </span>
                <span>{String(isAuthenticated)}</span>
              </div>
              <div>
                <span className="text-zinc-500">chain: </span>
                <span>{chainId}</span>
              </div>
              <div>
                <span className="text-zinc-500">connector: </span>
                <span>{connector?.name ?? 'unknown'}</span>
              </div>
              <div className="pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-[10px] bg-zinc-800 border-zinc-700"
                  onClick={() => {
                    const addr = getSiweAddress();
                    if (addr) copyToClipboard(addr, 'Wallet address');
                    else toast.info('No session found');
                  }}
                >
                  <Copy className="h-3 w-3 mr-1" />
                  Copy Address
                </Button>
              </div>
            </div>
          )}

          {/* Wallet Details */}
          {isConnected && (
            <>
              <SectionToggle
                label="Wallet Details"
                icon={Wallet}
                section="wallet"
                expanded={expandedSection}
                onToggle={toggleSection}
              />
              {expandedSection === 'wallet' && (
                <div className="ml-5 space-y-1 pb-2 text-[11px] font-mono">
                  <div>
                    <span className="text-zinc-500">address: </span>
                    <span>{address}</span>
                  </div>
                  <div>
                    <span className="text-zinc-500">connector: </span>
                    <span>{connector?.name ?? 'unknown'}</span>
                  </div>
                  <div>
                    <span className="text-zinc-500">chainId: </span>
                    <span>{chainId}</span>
                  </div>
                  {balance && (
                    <div>
                      <span className="text-zinc-500">balance: </span>
                      <span>
                        {balance.formatted} {balance.symbol}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* Browser Info */}
          <SectionToggle
            label="Browser Info"
            icon={Zap}
            section="browser"
            expanded={expandedSection}
            onToggle={toggleSection}
          />
          {expandedSection === 'browser' && (
            <div className="ml-5 space-y-1 pb-2 text-[11px] font-mono">
              <div>
                <span className="text-zinc-500">userAgent: </span>
                <span className="break-all">{navigator.userAgent}</span>
              </div>
              <div>
                <span className="text-zinc-500">language: </span>
                <span>{navigator.language}</span>
              </div>
              <div>
                <span className="text-zinc-500">cookieEnabled: </span>
                <span>{String(navigator.cookieEnabled)}</span>
              </div>
              <div>
                <span className="text-zinc-500">hardwareConcurrency: </span>
                <span>{navigator.hardwareConcurrency}</span>
              </div>
              <div>
                <span className="text-zinc-500">deviceMemory: </span>
                <span>{(navigator as any).deviceMemory ?? '—'} GB</span>
              </div>
              <div>
                <span className="text-zinc-500">connection: </span>
                <span>
                  {(navigator as any).connection
                    ? `${(navigator as any).connection.effectiveType} / ${(navigator as any).connection.downlink}Mbps`
                    : '—'}
                </span>
              </div>
              <div>
                <span className="text-zinc-500">screen: </span>
                <span>
                  {screen.width}x{screen.height} @ {devicePixelRatio}x
                </span>
              </div>
              <div>
                <span className="text-zinc-500">viewport: </span>
                <span>
                  {window.innerWidth}x{window.innerHeight}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Quick Actions */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-t border-zinc-800 bg-zinc-900/50">
        <span className="text-[10px] text-zinc-500 mr-1">Actions:</span>
        <Button
          variant="outline"
          size="sm"
          className="h-6 text-[10px] bg-zinc-800 border-zinc-700 hover:bg-zinc-700"
          onClick={clearQueryCache}
        >
          <RefreshCw className="h-3 w-3 mr-1" />
          Clear Query Cache
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-6 text-[10px] bg-zinc-800 border-zinc-700 hover:bg-zinc-700"
          onClick={clearLocalStorage}
        >
          <Trash2 className="h-3 w-3 mr-1" />
          Clear localStorage
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-6 text-[10px] bg-zinc-800 border-zinc-700 hover:bg-zinc-700"
          onClick={clearSessionStorage}
        >
          <Trash2 className="h-3 w-3 mr-1" />
          Clear sessionStorage
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-6 text-[10px] bg-zinc-800 border-zinc-700 hover:bg-zinc-700"
          onClick={() => {
            performance.clearResourceTimings();
            setNetworkEntries([]);
            toast.success('Performance entries cleared');
          }}
        >
          <BarChart3 className="h-3 w-3 mr-1" />
          Clear Perf Data
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-6 text-[10px] bg-zinc-800 border-zinc-700 hover:bg-zinc-700"
          onClick={() => window.location.reload()}
        >
          <RefreshCw className="h-3 w-3 mr-1" />
          Hard Reload
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-6 text-[10px] bg-zinc-800 border-zinc-700 hover:bg-zinc-700"
          onClick={() => {
            console.log({
              wallet: {
                address: walletAddress,
                authenticated: isAuthenticated,
                chainId,
                connector: connector?.name,
              },
              route: routerState.location,
              env: envVars,
              perf,
              storage,
              navHistory,
              networkEntries: networkEntries.slice(0, 20),
            });
            toast.success('Full state logged to console');
          }}
        >
          <Bug className="h-3 w-3 mr-1" />
          Dump to Console
        </Button>
      </div>
    </div>
  );
}
