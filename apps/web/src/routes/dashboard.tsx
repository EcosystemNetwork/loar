/**
 * Dashboard Route
 *
 * Authenticated user dashboard showing owned/available narrative universes,
 * an AI media generation section, and navigation to create new universes.
 * Redirects to /login when unauthenticated.
 */

import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Wallet, Copy, ExternalLink, Play, Users, Calendar, Plus, Wand2 } from 'lucide-react';
import { trpcClient } from '@/utils/trpc';
import { useQuery } from '@tanstack/react-query';
import { GenerativeMedia } from '@/components/GenerativeMedia';
import { QuestsPanel } from '@/components/QuestsPanel';
import { DailyCheckin } from '@/components/DailyCheckin';
import { MonetizationOverview } from '@/components/MonetizationOverview';

import { useWalletAuth } from '@/lib/wallet-auth';
import { useEffect } from 'react';

export const Route = createFileRoute('/dashboard')({
  component: RouteComponent,
});

function RouteComponent() {
  const { address, isConnected, isAuthenticated, isAuthenticating } = useWalletAuth();
  const navigate = Route.useNavigate();

  // Redirect unauthenticated users to login
  useEffect(() => {
    if (!isConnected && !isAuthenticating) {
      navigate({ to: '/login', search: { redirect: '/dashboard' } });
    }
  }, [isConnected, isAuthenticating, navigate]);

  // Fetch user's universes (by creator address)
  const { data: myUniverses, isLoading: isLoadingMine } = useQuery({
    queryKey: ['my-universes', address],
    queryFn: () => trpcClient.cinematicUniverses.getByCreator.query({ creator: address! }),
    enabled: !!address,
  });

  // Fetch all universes for discovery
  const { data: allUniverses, isLoading: isLoadingAll } = useQuery({
    queryKey: ['all-universes'],
    queryFn: () => trpcClient.cinematicUniverses.getAll.query(),
  });

  const isLoading = isLoadingMine || isLoadingAll;

  const selectUniverse = (universeId: string) => {
    navigate({
      to: '/universe/$id',
      params: { id: universeId },
    });
  };

  const createNewUniverse = () => {
    navigate({
      to: '/cinematicUniverseCreate',
    });
  };

  if (isAuthenticating || !isConnected) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p>Connecting...</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p>Loading universes...</p>
        </div>
      </div>
    );
  }

  const myUniverseList: any[] = (myUniverses as any)?.data ?? [];
  const allUniverseList: any[] = (allUniverses as any)?.data ?? [];
  const otherUniverses = allUniverseList.filter(
    (u: any) => !myUniverseList.some((m: any) => m.id === u.id)
  );
  const universes = [...myUniverseList, ...otherUniverses];

  return (
    <div className="min-h-screen bg-background">
      {/* Dashboard Header */}
      <div className="border-b bg-card">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">
                Welcome back{address ? `, ${address.slice(0, 6)}...${address.slice(-4)}` : ''}
              </h1>
              <p className="text-muted-foreground">Select a narrative universe to explore</p>
            </div>
            <Button onClick={createNewUniverse} className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Create Universe
            </Button>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-6 py-8 flex gap-8">
        {/* Main Content */}
        <div className="flex-1 min-w-0">
          {/* Featured Universe Section */}
          {universes.length > 0 && (
            <section className="mb-12">
              <h2 className="text-xl font-semibold mb-6">Featured Universe</h2>
              <div className="relative">
                <Card
                  className="cursor-pointer hover:shadow-lg transition-all duration-300 overflow-hidden h-64 bg-gradient-to-r from-blue-600 to-purple-600"
                  onClick={() => selectUniverse(universes[0].id)}
                >
                  <CardContent className="p-0 h-full relative">
                    <div className="absolute inset-0 bg-black/40" />
                    <div className="absolute bottom-0 left-0 right-0 p-6 text-white">
                      <h3 className="text-2xl font-bold mb-2">{universes[0].name}</h3>
                      <p className="text-sm opacity-90 mb-4">
                        {universes[0].description || 'A captivating narrative universe awaits'}
                      </p>
                      <Button
                        variant="secondary"
                        className="flex items-center gap-2"
                        onClick={(e) => {
                          e.stopPropagation();
                          selectUniverse(universes[0].id);
                        }}
                      >
                        <Play className="h-4 w-4" />
                        Enter Timeline
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </section>
          )}

          {/* Monetization Overview */}
          <MonetizationOverview />

          {/* AI Media Generation Section */}
          <section className="mb-12">
            <div className="flex items-center gap-2 mb-6">
              <Wand2 className="h-5 w-5" />
              <h2 className="text-xl font-semibold">AI Media Generation</h2>
            </div>
            <GenerativeMedia />
          </section>

          {/* Your Universes */}
          <section className="mb-12">
            <h2 className="text-xl font-semibold mb-6">Your Universes</h2>
            {myUniverseList.length === 0 ? (
              <div className="text-center py-12">
                <div className="mb-4">
                  <Users className="h-12 w-12 mx-auto text-muted-foreground" />
                </div>
                <h3 className="text-lg font-medium mb-2">No universes yet</h3>
                <p className="text-muted-foreground mb-4">
                  Create your first narrative universe to get started
                </p>
                <Button onClick={createNewUniverse} className="flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  Create Your First Universe
                </Button>
              </div>
            ) : (
              <UniverseGrid universes={myUniverseList} onSelect={selectUniverse} />
            )}
          </section>

          {/* Other Universes */}
          {otherUniverses.length > 0 && (
            <section>
              <h2 className="text-xl font-semibold mb-6">Explore All Universes</h2>
              <UniverseGrid universes={otherUniverses} onSelect={selectUniverse} />
            </section>
          )}
        </div>

        {/* Sidebar — Check-in + Quests & Rewards */}
        <aside className="hidden lg:block w-80 flex-shrink-0">
          <div className="sticky top-20 space-y-4">
            <DailyCheckin />
            <QuestsPanel />
          </div>
        </aside>
      </div>
    </div>
  );
}

function UniverseGrid({
  universes,
  onSelect,
}: {
  universes: any[];
  onSelect: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {universes.map((universe: any) => (
        <Card
          key={universe.id}
          className="cursor-pointer hover:shadow-lg transition-all duration-300 group overflow-hidden"
          onClick={() => onSelect(universe.id)}
        >
          <CardContent className="p-0">
            <div className="h-32 bg-gradient-to-br from-indigo-500 to-purple-600 relative">
              {universe.imageUrl && (
                <img
                  src={universe.imageUrl}
                  alt={universe.name}
                  className="absolute inset-0 w-full h-full object-cover"
                />
              )}
              <div className="absolute inset-0 bg-black/20" />
              <div className="absolute top-2 right-2">
                <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
                  <Calendar className="h-4 w-4 text-white" />
                </div>
              </div>
              <div className="absolute bottom-2 left-2">
                <div className="text-white text-xs bg-black/40 px-2 py-1 rounded">
                  Active Timeline
                </div>
              </div>
            </div>
            <div className="p-4">
              <h3 className="font-semibold truncate group-hover:text-primary transition-colors">
                {universe.name}
              </h3>
              <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                {universe.description || 'Explore this narrative universe'}
              </p>
              <div className="flex items-center justify-between mt-3">
                <span className="text-xs text-muted-foreground">
                  {universe.createdAt
                    ? `Created ${new Date(universe.createdAt).toLocaleDateString()}`
                    : ''}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(universe.id);
                  }}
                >
                  <Play className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
