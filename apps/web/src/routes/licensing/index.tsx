/**
 * Licensing Hub — Browse and manage IP licenses + merchandise
 *
 * Tabs:
 *   Licenses   — all licenses the user has created
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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  useMyMerch,
  useMerchOrders,
  useMyLicenses,
  useRevokeLicense,
  useActivateLicense,
} from '@/hooks/useRevenue';
import { useWalletAuth } from '@/lib/wallet-auth';
import { useIsAutoConnecting } from 'thirdweb/react';
import { formatEther } from 'viem';
import { useWriteContract } from '@/hooks/useThirdwebWrite';
import { useChainId } from 'wagmi';
import { getEvmAddresses } from '@/configs/addresses';
import { licensingRegistryAbi } from '@loar/abis/generated';
import { toast } from 'sonner';

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
  const { isConnected } = useWalletAuth();
  const [tab, setTab] = useState<Tab>('licenses');

  const { data: myLicenses, isLoading: licensesLoading } = useMyLicenses();
  const { data: myMerch, isLoading: merchLoading } = useMyMerch();
  const { data: merchOrders, isLoading: ordersLoading } = useMerchOrders();

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
              {t === 'licenses' && (myLicenses as any[])?.length > 0 && (
                <Badge variant="secondary" className="ml-1.5 text-xs px-1.5 py-0">
                  {(myLicenses as any[]).length}
                </Badge>
              )}
              {t === 'merch' && (myMerch as any[])?.length > 0 && (
                <Badge variant="secondary" className="ml-1.5 text-xs px-1.5 py-0">
                  {(myMerch as any[]).length}
                </Badge>
              )}
            </button>
          ))}
        </div>

        {tab === 'licenses' && (
          <LicensesTab
            licenses={(myLicenses as any[]) ?? []}
            isLoading={licensesLoading}
            isConnected={isConnected}
          />
        )}
        {tab === 'merch' && (
          <MerchTab
            merch={(myMerch as any[]) ?? []}
            orders={(merchOrders as any[]) ?? []}
            isLoading={merchLoading || ordersLoading}
            isConnected={isConnected}
          />
        )}
      </div>
    </div>
  );
}

function LicensesTab({
  licenses,
  isLoading,
  isConnected,
}: {
  licenses: any[];
  isLoading: boolean;
  isConnected: boolean;
}) {
  const isAutoConnecting = useIsAutoConnecting();
  const revokeLicense = useRevokeLicense();
  const activateLicense = useActivateLicense();
  const { writeContractAsync, isPending: isTxPending } = useWriteContract();
  const chainId = useChainId();
  const addresses = getEvmAddresses(chainId);

  async function handleActivate(lic: any) {
    try {
      let txHash: string | undefined;

      // Submit on-chain activation if the contract is deployed
      if (addresses?.licensingRegistry) {
        toast.info('Confirm the activation transaction in your wallet...');
        txHash = await writeContractAsync({
          address: addresses.licensingRegistry,
          abi: licensingRegistryAbi,
          functionName: 'activateLicense',
          args: [BigInt(lic.onChainLicenseId ?? 0)],
          value: lic.upfrontFee ? BigInt(lic.upfrontFee) : 0n,
        });
        toast.info('Transaction submitted, activating license...');
      }

      await activateLicense.mutateAsync({
        licenseId: lic.id,
        txHash: txHash ?? '0x0000000000000000000000000000000000000000000000000000000000000000',
      });
      toast.success('License activated!');
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to activate license');
    }
  }

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

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (licenses.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <Scale className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="font-medium">No licenses yet</p>
        <p className="text-sm mt-1 mb-4">
          Create IP licenses for your universes — streaming, gaming, merch, and more.
        </p>
        <Link to="/licensing/new">
          <Button variant="outline" size="sm" className="gap-1">
            Create a License
            <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {licenses.map((lic: any) => {
        const status = STATUS_CONFIG[lic.status] ?? STATUS_CONFIG.PROPOSED;
        const typeLabel = LICENSE_TYPE_LABELS[lic.licenseType] ?? lic.licenseType;
        const royaltyPct = lic.royaltyBps ? (lic.royaltyBps / 100).toFixed(1) : '0';

        return (
          <Card key={lic.id}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-primary" />
                  <span className="font-medium text-sm">{typeLabel}</span>
                </div>
                <Badge className={`text-xs ${status.color}`}>
                  <span className="mr-1">{status.icon}</span>
                  {status.label}
                </Badge>
              </div>

              <div className="text-xs text-muted-foreground space-y-1">
                <div className="flex justify-between">
                  <span>Licensee</span>
                  <span className="font-medium text-foreground">{lic.licensee}</span>
                </div>
                <div className="flex justify-between">
                  <span>Upfront Fee</span>
                  <span className="font-medium text-foreground flex items-center gap-1">
                    <Banknote className="w-3 h-3" />
                    {lic.upfrontFee && BigInt(lic.upfrontFee) > 0n
                      ? `${formatEther(BigInt(lic.upfrontFee))} ETH`
                      : 'None'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Royalty</span>
                  <span className="font-medium text-foreground">{royaltyPct}%</span>
                </div>
                <div className="flex justify-between">
                  <span>Duration</span>
                  <span className="font-medium text-foreground">{lic.durationDays} days</span>
                </div>
                {lic.totalRoyalties && BigInt(lic.totalRoyalties) > 0n && (
                  <div className="flex justify-between">
                    <span>Total Royalties</span>
                    <span className="font-medium text-primary">
                      {formatEther(BigInt(lic.totalRoyalties))} ETH
                    </span>
                  </div>
                )}
              </div>

              {lic.status === 'PROPOSED' && (
                <Button
                  size="sm"
                  className="w-full mt-3 h-7 text-xs"
                  onClick={() => handleActivate(lic)}
                  disabled={activateLicense.isPending || isTxPending}
                >
                  {activateLicense.isPending || isTxPending ? (
                    <Loader2 className="w-3 h-3 animate-spin mr-1" />
                  ) : (
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                  )}
                  {isTxPending ? 'Confirming...' : 'Activate License'}
                </Button>
              )}

              {lic.status === 'ACTIVE' && (
                <Button
                  variant="destructive"
                  size="sm"
                  className="w-full mt-3 h-7 text-xs"
                  onClick={() => revokeLicense.mutate({ licenseId: lic.id })}
                  disabled={revokeLicense.isPending}
                >
                  {revokeLicense.isPending ? (
                    <Loader2 className="w-3 h-3 animate-spin mr-1" />
                  ) : (
                    <XCircle className="w-3 h-3 mr-1" />
                  )}
                  Revoke License
                </Button>
              )}
            </CardContent>
          </Card>
        );
      })}
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
