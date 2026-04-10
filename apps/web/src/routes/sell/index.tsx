/**
 * Seller Studio — My listings management
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import {
  Plus,
  BarChart3,
  Package,
  Edit,
  Trash2,
  Loader2,
  Store,
  CheckCircle,
  Clock,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useMyListings, useDelistListing } from '@/hooks/useListings';
import { useWalletAuth } from '@/lib/wallet-auth';
import { toast } from 'sonner';
import { useVocab } from '@/hooks/use-vocab';

export const Route = createFileRoute('/sell/')({
  component: SellPage,
});

const STATUS_ICONS: Record<string, React.ReactNode> = {
  ACTIVE: <CheckCircle className="w-3 h-3 text-green-500" />,
  DRAFT: <Clock className="w-3 h-3 text-yellow-500" />,
  SOLD_OUT: <XCircle className="w-3 h-3 text-muted-foreground" />,
  DELISTED: <XCircle className="w-3 h-3 text-destructive" />,
};

function SellPage() {
  const { isConnected } = useWalletAuth();
  const v = useVocab();
  const { data: active = [], isLoading: loadingActive } = useMyListings('ACTIVE');
  const { data: drafts = [], isLoading: loadingDrafts } = useMyListings('DRAFT');
  const { data: sold = [], isLoading: loadingSold } = useMyListings('SOLD_OUT');
  const delist = useDelistListing();

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 px-4">
        <Store className="w-12 h-12 text-muted-foreground opacity-30" />
        <p className="font-semibold">{v('connect-wallet-to-sell')}</p>
        <Link to="/login">
          <Button>{v('connect-wallet')}</Button>
        </Link>
      </div>
    );
  }

  async function handleDelist(listingId: string) {
    try {
      await delist.mutateAsync(listingId);
      toast.success('Listing removed');
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to delist');
    }
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-sm border-b px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <h1 className="text-lg font-bold flex items-center gap-2">
            <Store className="w-5 h-5" />
            Seller Studio
          </h1>
          <div className="flex gap-2">
            <Link to="/sell/earnings">
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <BarChart3 className="w-4 h-4" />
              </Button>
            </Link>
            <Link to="/sell/new">
              <Button size="sm" className="gap-1">
                <Plus className="w-4 h-4" />
                New
              </Button>
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-4">
        <Tabs defaultValue="active">
          <TabsList className="w-full mb-4">
            <TabsTrigger value="active" className="flex-1">
              Active {(active as any[]).length > 0 && `(${(active as any[]).length})`}
            </TabsTrigger>
            <TabsTrigger value="drafts" className="flex-1">
              Drafts {(drafts as any[]).length > 0 && `(${(drafts as any[]).length})`}
            </TabsTrigger>
            <TabsTrigger value="sold" className="flex-1">
              Sold Out
            </TabsTrigger>
          </TabsList>

          {/* Active */}
          <TabsContent value="active">
            {loadingActive ? (
              <LoadingState />
            ) : (active as any[]).length === 0 ? (
              <EmptyState
                label="No active listings"
                cta="Create your first listing"
                href="/sell/new"
              />
            ) : (
              <div className="space-y-3">
                {(active as any[]).map((l: any) => (
                  <SellerListingRow key={l.id} listing={l} onDelist={handleDelist} />
                ))}
              </div>
            )}
          </TabsContent>

          {/* Drafts */}
          <TabsContent value="drafts">
            {loadingDrafts ? (
              <LoadingState />
            ) : (drafts as any[]).length === 0 ? (
              <EmptyState label="No drafts" cta="Start a new listing" href="/sell/new" />
            ) : (
              <div className="space-y-3">
                {(drafts as any[]).map((l: any) => (
                  <SellerListingRow key={l.id} listing={l} onDelist={handleDelist} isDraft />
                ))}
              </div>
            )}
          </TabsContent>

          {/* Sold out */}
          <TabsContent value="sold">
            {loadingSold ? (
              <LoadingState />
            ) : (sold as any[]).length === 0 ? (
              <EmptyState label="No sold out listings" />
            ) : (
              <div className="space-y-3">
                {(sold as any[]).map((l: any) => (
                  <SellerListingRow key={l.id} listing={l} onDelist={handleDelist} />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function SellerListingRow({
  listing,
  onDelist,
  isDraft = false,
}: {
  listing: any;
  onDelist: (id: string) => void;
  isDraft?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex gap-3">
          <div className="w-14 h-14 rounded-lg bg-muted flex items-center justify-center shrink-0 overflow-hidden">
            {listing.thumbnailUrl ? (
              <img
                src={listing.thumbnailUrl}
                alt={listing.title}
                className="w-full h-full object-cover"
              />
            ) : (
              <Package className="w-6 h-6 text-muted-foreground opacity-30" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              {STATUS_ICONS[listing.status]}
              <p className="font-medium text-sm truncate">{listing.title}</p>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {listing.productType?.replace(/_/g, ' ')} ·{' '}
              {listing.price === '0' ? 'Free' : `${listing.price} ${listing.currency}`}
            </p>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-xs text-muted-foreground">{listing.sold ?? 0} sold</span>
              {listing.supply > 0 && (
                <span className="text-xs text-muted-foreground">
                  {listing.supply - listing.sold} left
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            {isDraft && (
              <Badge variant="outline" className="text-xs">
                Draft
              </Badge>
            )}
            <div className="flex gap-1 mt-auto">
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <Edit className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-destructive hover:text-destructive"
                onClick={() => onDelist(listing.id)}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function LoadingState() {
  return (
    <div className="flex justify-center py-10">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
    </div>
  );
}

function EmptyState({ label, cta, href }: { label: string; cta?: string; href?: string }) {
  return (
    <div className="text-center py-10 text-muted-foreground">
      <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
      <p className="text-sm">{label}</p>
      {cta && href && (
        <Link to={href as any}>
          <Button variant="outline" size="sm" className="mt-3">
            {cta}
          </Button>
        </Link>
      )}
    </div>
  );
}
