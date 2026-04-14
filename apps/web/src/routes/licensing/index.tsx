/**
 * Licensing Hub — Browse and manage IP licenses + merchandise
 *
 * Tabs:
 *   Licenses   — all licenses the user has created or received
 *   Merch      — user's created merchandise items + orders
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import {
  Scale,
  Plus,
  Loader2,
  FileText,
  ShoppingBag,
  Clock,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Banknote,
  Shield,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { useMyMerch, useMerchOrders } from '@/hooks/useRevenue';
import { useWalletAuth } from '@/lib/wallet-auth';
import { useIsAutoConnecting } from 'thirdweb/react';
import { formatEther } from 'viem';
import { useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';

export const Route = createFileRoute('/licensing/')({
  component: LicensingHubPage,
});

const LICENSE_TYPE_LABELS: Record<string, string> = {
  STREAMING: 'Streaming',
  MERCH: 'Merchandise',
  GAMING: 'Gaming',
  COMIC: 'Comic / Print',
  AUDIO: 'Audio',
  OTHER: 'Other',
};

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  PROPOSED: {
    label: 'Proposed',
    color: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    icon: <Clock className="w-3 h-3" />,
  },
  ACTIVE: {
    label: 'Active',
    color: 'bg-green-500/10 text-green-400 border-green-500/20',
    icon: <CheckCircle2 className="w-3 h-3" />,
  },
  REVOKED: {
    label: 'Revoked',
    color: 'bg-red-500/10 text-red-400 border-red-500/20',
    icon: <XCircle className="w-3 h-3" />,
  },
  EXPIRED: {
    label: 'Expired',
    color: 'bg-muted text-muted-foreground border-border',
    icon: <Clock className="w-3 h-3" />,
  },
};

type Tab = 'licenses' | 'merch';

function LicensingHubPage() {
  const { isConnected, address: uid } = useWalletAuth();
  const [tab, setTab] = useState<Tab>('licenses');

  // Fetch all licenses where the user is the licensor
  // We use a "my licenses" approach — the server groups by proposer/licensor
  const { data: myMerch, isLoading: merchLoading } = useMyMerch();
  const { data: merchOrders, isLoading: ordersLoading } = useMerchOrders();

  // For licenses, we need a custom query since there's no "myLicenses" endpoint
  // We'll show a prompt to navigate to universe-specific licensing
  const { data: myCollabsForLicenses } = useQuery({
    queryKey: ['my-licenses-all'],
    queryFn: () => trpcClient.collabs.myCollabs.query(), // placeholder for discovering universes
    enabled: isConnected,
  });

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="bg-gradient-to-b from-primary/10 to-background px-4 pt-6 pb-4">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-1">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Scale className="w-6 h-6 text-primary" />
                IP Licensing
              </h1>
              <p className="text-sm text-muted-foreground">
                License your universe IP and sell merchandise
              </p>
            </div>
            {isConnected && (
              <Link to="/licensing/new">
                <Button size="sm" className="gap-1">
                  <Plus className="w-4 h-4" />
                  New License
                </Button>
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4">
        {/* Tabs */}
        <div className="flex gap-1 mb-5 border-b">
          {(['licenses', 'merch'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-sm font-medium capitalize border-b-2 -mb-px transition-colors ${
                tab === t
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t === 'licenses' ? 'Licenses' : 'Merchandise'}
              {t === 'merch' && (myMerch?.length ?? 0) > 0 && (
                <Badge variant="secondary" className="ml-1.5 text-xs px-1.5 py-0">
                  {myMerch!.length}
                </Badge>
              )}
            </button>
          ))}
        </div>

        {tab === 'licenses' && <LicensesTab isConnected={isConnected} />}
        {tab === 'merch' && (
          <MerchTab
            merch={myMerch ?? []}
            orders={merchOrders ?? []}
            isLoading={merchLoading || ordersLoading}
            isConnected={isConnected}
          />
        )}
      </div>
    </div>
  );
}

function LicensesTab({ isConnected }: { isConnected: boolean }) {
  const isAutoConnecting = useIsAutoConnecting();

  if (isAutoConnecting) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <Scale className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="font-medium">Connect your wallet</p>
        <p className="text-sm mt-1">to view and manage your IP licenses</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* How it works */}
      <Card className="bg-primary/5 border-primary/20">
        <CardHeader className="pb-2 pt-4 px-4">
          <h3 className="text-sm font-semibold">How IP Licensing Works</h3>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="space-y-2.5">
            {[
              {
                icon: <FileText className="w-4 h-4" />,
                text: 'Create a license for your universe IP — streaming, gaming, merch, etc.',
              },
              {
                icon: <Banknote className="w-4 h-4" />,
                text: 'Set upfront fees and ongoing royalty percentages',
              },
              {
                icon: <Shield className="w-4 h-4" />,
                text: 'Terms are recorded and enforced via smart contract',
              },
              {
                icon: <CheckCircle2 className="w-4 h-4" />,
                text: 'Track royalty payments and manage license lifecycle',
              },
            ].map((step, i) => (
              <div key={i} className="flex items-start gap-2.5 text-sm">
                <div className="shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                  {step.icon}
                </div>
                <span className="text-muted-foreground pt-0.5">{step.text}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* License types showcase */}
      <section>
        <h2 className="font-semibold mb-3">License Types</h2>
        <div className="grid grid-cols-2 gap-3">
          {Object.entries(LICENSE_TYPE_LABELS).map(([key, label]) => (
            <Card key={key}>
              <CardContent className="p-3">
                <div className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full border mb-2 bg-primary/10 text-primary border-primary/20">
                  <FileText className="w-3 h-3" />
                  {label}
                </div>
                <p className="text-xs text-muted-foreground">
                  {key === 'STREAMING' && 'Stream your universe on external platforms'}
                  {key === 'MERCH' && 'Physical or digital merchandise rights'}
                  {key === 'GAMING' && 'Adapt universe IP for games'}
                  {key === 'COMIC' && 'Print or digital comic adaptations'}
                  {key === 'AUDIO' && 'Podcast, audiobook, or music rights'}
                  {key === 'OTHER' && 'Custom licensing arrangement'}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <div className="mt-6 p-4 rounded-xl border border-dashed text-center text-sm text-muted-foreground">
        <Scale className="w-8 h-8 mx-auto mb-2 opacity-30" />
        <p className="font-medium mb-1">Create licenses from universe shops</p>
        <p className="text-xs mb-3">
          Visit any universe's storefront to manage its licenses and merchandise.
        </p>
        <Link to="/licensing/new">
          <Button variant="outline" size="sm" className="gap-1">
            Create a License
            <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </Link>
      </div>
    </div>
  );
}

function MerchTab({
  merch,
  orders,
  isLoading,
  isConnected,
}: {
  merch: any[];
  orders: any[];
  isLoading: boolean;
  isConnected: boolean;
}) {
  const isAutoConnecting = useIsAutoConnecting();

  if (isAutoConnecting) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <ShoppingBag className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="font-medium">Connect your wallet</p>
        <p className="text-sm mt-1">to view your merchandise</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {merch.length > 0 && (
        <section>
          <h2 className="font-semibold mb-3 flex items-center gap-1.5">
            <ShoppingBag className="w-4 h-4 text-primary" />
            My Merchandise
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {merch.map((item: any) => (
              <Card key={item.id}>
                <CardContent className="p-3">
                  {item.imageUrl && (
                    <div className="aspect-square rounded-lg bg-muted overflow-hidden mb-2">
                      <img
                        src={item.imageUrl}
                        alt={item.name}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}
                  <p className="text-sm font-medium truncate">{item.name}</p>
                  <p className="text-xs text-muted-foreground">{item.category}</p>
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-xs text-primary font-semibold">
                      {formatEther(BigInt(item.price))} ETH
                    </span>
                    <span className="text-xs text-muted-foreground">{item.sold} sold</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {orders.length > 0 && (
        <section>
          <h2 className="font-semibold mb-3 flex items-center gap-1.5">
            <Clock className="w-4 h-4" />
            My Orders
          </h2>
          <div className="space-y-2">
            {orders.map((order: any) => (
              <Card key={order.id}>
                <CardContent className="p-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Order #{order.id.slice(0, 8)}</p>
                    <p className="text-xs text-muted-foreground">Qty: {order.quantity}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-primary">
                      {formatEther(BigInt(order.totalPrice))} ETH
                    </p>
                    <Badge variant="secondary" className="text-xs">
                      {order.status}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {merch.length === 0 && orders.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <ShoppingBag className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No merchandise yet</p>
          <p className="text-sm mt-1 mb-4">Create merch for your universes in their shops</p>
          <Link to="/market">
            <Button variant="outline" size="sm">
              Browse Universes
            </Button>
          </Link>
        </div>
      )}
    </div>
  );
}
