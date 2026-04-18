/**
 * Seller Earnings — snapshot of revenue and activity
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft, TrendingUp, Package, Coins, BarChart3, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useSellerStats } from '@/hooks/useListings';
import { useWalletAuth } from '@/lib/wallet-auth';
import { useVocab } from '@/hooks/use-vocab';

export const Route = createFileRoute('/sell/earnings')({
  component: SellerEarningsPage,
});

function SellerEarningsPage() {
  const { isAuthenticated, isAuthenticating } = useWalletAuth();
  const v = useVocab();
  const { data: stats, isLoading } = useSellerStats();

  if (!isAuthenticated && !isAuthenticating) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 px-4">
        <p className="text-muted-foreground">Connect your wallet to view earnings</p>
        <Link to="/login">
          <Button>{v('connect-wallet')}</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-sm border-b px-4 py-3 flex items-center gap-3">
        <Link to="/sell">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <h1 className="font-bold">Earnings</h1>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-6 space-y-4">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-3">
              <StatCard
                icon={<Coins className="w-5 h-5 text-primary" />}
                label="Total Earnings"
                value={
                  stats?.totalEarnings
                    ? `${parseFloat(stats.totalEarnings).toFixed(4)} ETH`
                    : '0 ETH'
                }
              />
              <StatCard
                icon={<TrendingUp className="w-5 h-5 text-green-500" />}
                label="Total Sold"
                value={String(stats?.totalSold ?? 0)}
              />
              <StatCard
                icon={<Package className="w-5 h-5 text-blue-500" />}
                label="Active Listings"
                value={String(stats?.activeListings ?? 0)}
              />
              <StatCard
                icon={<BarChart3 className="w-5 h-5 text-yellow-500" />}
                label="Drafts"
                value={String(stats?.draftListings ?? 0)}
              />
            </div>

            {/* Recent orders */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Recent Sales</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {(stats?.recentOrders ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No sales yet</p>
                ) : (
                  <div className="space-y-3">
                    {((stats?.recentOrders as any[]) ?? []).map((order: any) => (
                      <div key={order.id} className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0 overflow-hidden">
                          {order.thumbnailUrl ? (
                            <img
                              src={order.thumbnailUrl}
                              alt=""
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <Package className="w-4 h-4 text-muted-foreground opacity-30" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{order.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {order.productType?.replace(/_/g, ' ')} · qty {order.quantity}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold text-primary">
                            {order.price === '0' ? 'Free' : `${order.price} ${order.currency}`}
                          </p>
                          <Badge
                            variant={order.status === 'COMPLETED' ? 'default' : 'secondary'}
                            className="text-xs"
                          >
                            {order.status}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        {icon}
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="font-bold text-lg leading-tight">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
