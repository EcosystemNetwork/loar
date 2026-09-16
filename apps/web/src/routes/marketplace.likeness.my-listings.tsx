/**
 * /marketplace/likeness/my-listings — Seller dashboard for the Likeness
 * Marketplace. Wires up the backend procedures that already existed
 * (`myListings`, `mySales`, `myPurchases`, `updateListing`,
 * `deactivateListing`, `reactivateListing`) but had no frontend caller
 * anywhere in the app, plus the new `startVerification` (Phase 4 KYC).
 */

import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { formatEther } from 'viem';
import {
  Loader2,
  Mic,
  Sparkles,
  UserCircle2,
  Pause,
  Play,
  Pencil,
  ShieldAlert,
  ShieldCheck,
  ExternalLink,
  AlertTriangle,
} from 'lucide-react';
import { useWalletAuth } from '@/lib/wallet-auth';
import { trpcClient } from '@/utils/trpc';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { safeParseEther } from '@/components/likeness-marketplace/consent-pricing-steps';
import { LIKENESS_USE_CASE_LABELS, type LikenessUseCase } from '@/hooks/useEntities';

export const Route = createFileRoute('/marketplace/likeness/my-listings')({
  component: MyListingsPage,
});

interface MyListing {
  id: string;
  entityId: string;
  entityKind: 'voice' | 'likeness' | 'persona';
  title: string;
  description: string;
  thumbnailUrl: string | null;
  buyPriceWei: string;
  leasePricePerDayWei: string;
  licenseFeeWei: string;
  active: boolean;
  pendingVerification: boolean;
  verified: boolean;
  onChainContentHash: string | null;
  totalSales: number;
  totalRevenueWei: string;
}

interface MyDeal {
  id: string;
  listingId: string;
  entityId: string;
  dealType: 'BUY' | 'LEASE' | 'LICENSE';
  sellerAddress: string;
  buyerAddress: string;
  pricePaidWei: string;
  declaredUseCase: string;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
  startTime: string;
}

function weiToEthInput(wei: string): string {
  if (wei === '0') return '';
  try {
    return formatEther(BigInt(wei));
  } catch {
    return '';
  }
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function kindIcon(kind: MyListing['entityKind']) {
  if (kind === 'voice') return <Mic className="size-4" />;
  if (kind === 'persona') return <UserCircle2 className="size-4" />;
  return <Sparkles className="size-4" />;
}

function MyListingsPage() {
  const { isAuthenticated } = useWalletAuth();

  if (!isAuthenticated) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-16 text-center">
        <UserCircle2 className="size-12 mx-auto mb-4 text-muted-foreground" />
        <h1 className="text-xl font-bold mb-2">Connect a wallet to continue</h1>
        <p className="text-sm text-muted-foreground">
          Managing your likeness listings requires a connected wallet.
        </p>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">My Listings</h1>
        <p className="text-muted-foreground mt-2">
          Manage what you've listed on the Likeness Marketplace — pricing, pause/resume, and
          identity verification.
        </p>
      </header>

      <Tabs defaultValue="listings">
        <TabsList>
          <TabsTrigger value="listings">Listings</TabsTrigger>
          <TabsTrigger value="sales">Sales</TabsTrigger>
          <TabsTrigger value="purchases">Purchases</TabsTrigger>
        </TabsList>

        <TabsContent value="listings">
          <ListingsTab />
        </TabsContent>
        <TabsContent value="sales">
          <DealsTab kind="sales" />
        </TabsContent>
        <TabsContent value="purchases">
          <DealsTab kind="purchases" />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ListingsTab() {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['likenessMarketplace', 'myListings'],
    queryFn: () =>
      trpcClient.likenessMarketplace.myListings.query({ includeInactive: true, limit: 100 }),
  });
  const listings = (data ?? []) as MyListing[];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['likenessMarketplace'] });

  const toggleActiveMutation = useMutation({
    mutationFn: async (listing: MyListing) =>
      listing.active
        ? trpcClient.likenessMarketplace.deactivateListing.mutate({ listingId: listing.id })
        : trpcClient.likenessMarketplace.reactivateListing.mutate({ listingId: listing.id }),
    onSuccess: () => {
      invalidate();
      refetch();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const verifyMutation = useMutation({
    mutationFn: (listing: MyListing) =>
      trpcClient.likenessMarketplace.startVerification.mutate({
        entityId: listing.entityId,
        returnUrl: window.location.href,
      }),
    onSuccess: (result) => {
      window.location.href = result.url;
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) {
    return <Loader2 className="size-6 animate-spin text-muted-foreground mt-8" />;
  }

  if (isError) {
    return (
      <Card className="mt-4">
        <CardContent className="py-12 text-center">
          <AlertTriangle className="size-8 mx-auto mb-3 text-destructive" />
          <p className="text-sm text-muted-foreground mb-4">
            Couldn't load your listings — {error instanceof Error ? error.message : 'unknown error'}
            .
          </p>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (listings.length === 0) {
    return (
      <Card className="mt-4">
        <CardContent className="py-12 text-center">
          <p className="text-sm text-muted-foreground mb-4">
            You haven't listed anything on the Likeness Marketplace yet.
          </p>
          <Button asChild size="sm">
            <Link to="/create/likeness">List your likeness</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3 mt-4">
      {listings.map((listing) =>
        editingId === listing.id ? (
          <EditListingCard
            key={listing.id}
            listing={listing}
            onCancel={() => setEditingId(null)}
            onSaved={() => {
              setEditingId(null);
              invalidate();
              refetch();
            }}
          />
        ) : (
          <Card key={listing.id}>
            <CardContent className="p-4 flex items-start gap-3">
              <div className="size-14 rounded-md overflow-hidden bg-muted shrink-0 flex items-center justify-center">
                {listing.thumbnailUrl ? (
                  <img src={listing.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  kindIcon(listing.entityKind)
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Link
                    to="/marketplace/likeness/$listingId"
                    params={{ listingId: listing.id }}
                    className="font-semibold text-sm hover:underline"
                  >
                    {listing.title}
                  </Link>
                  {listing.pendingVerification ? (
                    <Badge
                      variant="outline"
                      className="text-[10px] border-amber-500 text-amber-600"
                    >
                      <ShieldAlert className="size-2.5 mr-1" />
                      Verification pending
                    </Badge>
                  ) : listing.active ? (
                    <Badge variant="secondary" className="text-[10px]">
                      Active
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px]">
                      Paused
                    </Badge>
                  )}
                  {listing.verified && (
                    <Badge variant="default" className="text-[10px]">
                      <ShieldCheck className="size-2.5 mr-1" />
                      Verified
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {listing.totalSales} sale{listing.totalSales === 1 ? '' : 's'} ·{' '}
                  {formatEther(BigInt(listing.totalRevenueWei || '0'))} ETH earned
                </p>
                <div className="flex flex-wrap gap-1 mt-2">
                  {listing.buyPriceWei !== '0' && (
                    <Badge variant="outline" className="text-[10px]">
                      Buy {formatEther(BigInt(listing.buyPriceWei))} ETH
                    </Badge>
                  )}
                  {listing.leasePricePerDayWei !== '0' && (
                    <Badge variant="outline" className="text-[10px]">
                      Lease {formatEther(BigInt(listing.leasePricePerDayWei))} ETH/d
                    </Badge>
                  )}
                  {listing.licenseFeeWei !== '0' && (
                    <Badge variant="outline" className="text-[10px]">
                      License {formatEther(BigInt(listing.licenseFeeWei))} ETH
                    </Badge>
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-1.5 shrink-0">
                {listing.pendingVerification && (
                  <Button
                    size="sm"
                    onClick={() => verifyMutation.mutate(listing)}
                    disabled={verifyMutation.isPending}
                  >
                    {verifyMutation.isPending ? (
                      <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <ShieldAlert className="size-3.5 mr-1.5" />
                    )}
                    Verify identity
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => setEditingId(listing.id)}>
                  <Pencil className="size-3.5 mr-1.5" />
                  Edit
                </Button>
                {!listing.pendingVerification && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => toggleActiveMutation.mutate(listing)}
                    disabled={toggleActiveMutation.isPending}
                  >
                    {listing.active ? (
                      <>
                        <Pause className="size-3.5 mr-1.5" />
                        Pause
                      </>
                    ) : (
                      <>
                        <Play className="size-3.5 mr-1.5" />
                        Resume
                      </>
                    )}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )
      )}
    </div>
  );
}

function EditListingCard({
  listing,
  onCancel,
  onSaved,
}: {
  listing: MyListing;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(listing.title);
  const [description, setDescription] = useState(listing.description);
  const [buyPriceEth, setBuyPriceEth] = useState(weiToEthInput(listing.buyPriceWei));
  const [leasePerDayEth, setLeasePerDayEth] = useState(weiToEthInput(listing.leasePricePerDayWei));
  const [licenseFeeEth, setLicenseFeeEth] = useState(weiToEthInput(listing.licenseFeeWei));
  const isOnChain = !!listing.onChainContentHash;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const buyWei = safeParseEther(buyPriceEth);
      const leaseWei = safeParseEther(leasePerDayEth);
      const licenseWei = safeParseEther(licenseFeeEth);
      if (buyWei < 0n || leaseWei < 0n || licenseWei < 0n) {
        throw new Error('One of the prices is not a valid ETH amount.');
      }
      return trpcClient.likenessMarketplace.updateListing.mutate({
        listingId: listing.id,
        title: title.trim(),
        description: description.trim(),
        ...(isOnChain
          ? {}
          : {
              buyPriceWei: buyWei.toString(),
              leasePricePerDayWei: leaseWei.toString(),
              licenseFeeWei: licenseWei.toString(),
            }),
      });
    },
    onSuccess: () => {
      toast.success('Listing updated');
      onSaved();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        {isOnChain && (
          <p className="text-xs text-amber-600 flex items-center gap-1.5">
            <AlertTriangle className="size-3.5" />
            Published on-chain — prices are fixed in ContentLicensing.sol and can't be edited here.
          </p>
        )}
        <div className="space-y-1.5">
          <Label htmlFor={`title-${listing.id}`} className="text-xs">
            Title
          </Label>
          <Input
            id={`title-${listing.id}`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`desc-${listing.id}`} className="text-xs">
            Description
          </Label>
          <Textarea
            id={`desc-${listing.id}`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Buy (ETH)</Label>
            <Input
              value={buyPriceEth}
              onChange={(e) => setBuyPriceEth(e.target.value)}
              placeholder="0"
              disabled={isOnChain}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Lease/day (ETH)</Label>
            <Input
              value={leasePerDayEth}
              onChange={(e) => setLeasePerDayEth(e.target.value)}
              placeholder="0"
              disabled={isOnChain}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">License (ETH)</Label>
            <Input
              value={licenseFeeEth}
              onChange={(e) => setLicenseFeeEth(e.target.value)}
              placeholder="0"
              disabled={isOnChain}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={saveMutation.isPending}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || title.trim().length === 0}
          >
            {saveMutation.isPending && <Loader2 className="size-3.5 mr-1.5 animate-spin" />}
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function DealsTab({ kind }: { kind: 'sales' | 'purchases' }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['likenessMarketplace', kind],
    queryFn: () =>
      kind === 'sales'
        ? trpcClient.likenessMarketplace.mySales.query({ limit: 50 })
        : trpcClient.likenessMarketplace.myPurchases.query({ limit: 50 }),
  });
  const deals = (data ?? []) as MyDeal[];

  if (isLoading) {
    return <Loader2 className="size-6 animate-spin text-muted-foreground mt-8" />;
  }

  if (isError) {
    return (
      <Card className="mt-4">
        <CardContent className="py-12 text-center">
          <AlertTriangle className="size-8 mx-auto mb-3 text-destructive" />
          <p className="text-sm text-muted-foreground mb-4">
            Couldn't load {kind} — {error instanceof Error ? error.message : 'unknown error'}.
          </p>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (deals.length === 0) {
    return (
      <p className="text-sm text-muted-foreground mt-4">
        {kind === 'sales' ? 'No sales yet.' : 'No purchases yet.'}
      </p>
    );
  }

  return (
    <div className="space-y-2 mt-4">
      {deals.map((deal) => (
        <Card key={deal.id}>
          <CardContent className="p-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <Badge variant="outline" className="text-[10px]">
                  {deal.dealType}
                </Badge>
                <Badge
                  variant={deal.status === 'ACTIVE' ? 'secondary' : 'outline'}
                  className="text-[10px]"
                >
                  {deal.status}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {LIKENESS_USE_CASE_LABELS[deal.declaredUseCase as LikenessUseCase] ??
                    deal.declaredUseCase}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {kind === 'sales' ? 'Buyer' : 'Seller'}{' '}
                {shortAddr(kind === 'sales' ? deal.buyerAddress : deal.sellerAddress)} ·{' '}
                {new Date(deal.startTime).toLocaleDateString()}
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-sm font-semibold">
                {formatEther(BigInt(deal.pricePaidWei))} ETH
              </span>
              <Link
                to="/marketplace/likeness/$listingId"
                params={{ listingId: deal.listingId }}
                className="text-muted-foreground hover:text-foreground"
              >
                <ExternalLink className="size-4" />
              </Link>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
