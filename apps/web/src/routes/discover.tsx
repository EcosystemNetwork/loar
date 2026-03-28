/**
 * Creator Gallery / Discover Page
 *
 * Browse public profiles and content. Search by name, tags, or content type.
 * Filter between fun (non-monetized) and monetized content.
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useState } from 'react';
import {
  Search,
  Users,
  Play,
  Sparkles,
  DollarSign,
  Image as ImageIcon,
  Film,
  Grid3X3,
  TrendingUp,
} from 'lucide-react';

export const Route = createFileRoute('/discover')({
  component: DiscoverPage,
});

function DiscoverPage() {
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('creators');
  const [contentFilter, setContentFilter] = useState<'all' | 'fan' | 'monetized'>('all');
  const [mediaFilter, setMediaFilter] = useState<string | undefined>();

  const { data: profilesData, isLoading: profilesLoading } = useQuery({
    queryKey: ['discover-profiles', search],
    queryFn: () => trpcClient.profiles.discover.query({ search: search || undefined, limit: 30 }),
  });

  const { data: contentData, isLoading: contentLoading } = useQuery({
    queryKey: ['discover-content', search, contentFilter, mediaFilter],
    queryFn: () =>
      trpcClient.content.feed.query({
        search: search || undefined,
        classification:
          contentFilter === 'all' || contentFilter === 'monetized' ? undefined : contentFilter,
        mediaType: mediaFilter as any,
        limit: 30,
      }),
  });

  const profiles = profilesData?.profiles || [];
  const contentItems = contentData?.items || [];

  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <div className="border-b bg-gradient-to-r from-primary/5 to-purple-500/5">
        <div className="container mx-auto px-6 py-12 text-center">
          <h1 className="text-4xl font-bold mb-3">Discover Creators</h1>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto mb-8">
            Explore portfolios from AI video creators. Find inspiration, follow your favorites, and
            see the difference between fun projects and commercial work.
          </p>

          {/* Search */}
          <div className="max-w-xl mx-auto relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search creators, tags, content..."
              className="pl-10 h-12 text-lg"
            />
          </div>
        </div>
      </div>

      <div className="container mx-auto px-6 py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
            <TabsList>
              <TabsTrigger value="creators" className="gap-1">
                <Users className="h-4 w-4" /> Creators
              </TabsTrigger>
              <TabsTrigger value="content" className="gap-1">
                <Grid3X3 className="h-4 w-4" /> Content
              </TabsTrigger>
            </TabsList>

            {/* Content sub-filters */}
            {activeTab === 'content' && (
              <div className="flex gap-2 flex-wrap">
                {(['all', 'fan', 'monetized'] as const).map((f) => (
                  <Button
                    key={f}
                    variant={contentFilter === f ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setContentFilter(f)}
                    className="gap-1"
                  >
                    {f === 'fan' && <Sparkles className="h-3 w-3" />}
                    {f === 'monetized' && <DollarSign className="h-3 w-3" />}
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </Button>
                ))}
                <div className="w-px bg-border mx-1" />
                {[
                  { value: undefined, label: 'All Types', icon: Grid3X3 },
                  { value: 'video', label: 'Video', icon: Film },
                  { value: 'ai-video', label: 'AI Video', icon: Play },
                  { value: 'image', label: 'Image', icon: ImageIcon },
                ].map((opt) => (
                  <Button
                    key={opt.label}
                    variant={mediaFilter === opt.value ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setMediaFilter(opt.value)}
                    className="gap-1"
                  >
                    <opt.icon className="h-3 w-3" />
                    {opt.label}
                  </Button>
                ))}
              </div>
            )}
          </div>

          {/* Creators Tab */}
          <TabsContent value="creators">
            {profilesLoading ? (
              <div className="flex justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : profiles.length === 0 ? (
              <div className="text-center py-16">
                <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No creators found</h3>
                <p className="text-muted-foreground">
                  {search
                    ? `No results for "${search}"`
                    : 'Be the first to create a public profile!'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {profiles.map((profile: any) => (
                  <CreatorCard key={profile.id} profile={profile} />
                ))}
              </div>
            )}
          </TabsContent>

          {/* Content Tab */}
          <TabsContent value="content">
            {contentLoading ? (
              <div className="flex justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : contentItems.length === 0 ? (
              <div className="text-center py-16">
                <Grid3X3 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No content found</h3>
                <p className="text-muted-foreground">
                  {search ? `No results for "${search}"` : 'No public content yet.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {contentItems.map((item: any) => (
                  <ContentFeedCard key={item.id} item={item} />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function CreatorCard({ profile }: { profile: any }) {
  const accentColor = profile.layout?.accentColor || '#8b5cf6';

  return (
    <Link to="/profile/$username" params={{ username: profile.username }}>
      <Card className="overflow-hidden hover:shadow-lg transition-all duration-300 group cursor-pointer">
        <CardContent className="p-0">
          {/* Mini banner */}
          <div
            className="h-20 relative"
            style={{ background: `linear-gradient(135deg, ${accentColor}60, ${accentColor}20)` }}
          >
            <div className="absolute -bottom-6 left-4">
              <div className="w-12 h-12 rounded-full border-2 border-background bg-muted flex items-center justify-center text-lg font-bold overflow-hidden">
                {profile.avatarUrl ? (
                  <img
                    src={profile.avatarUrl}
                    alt={profile.displayName}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  profile.displayName.charAt(0).toUpperCase()
                )}
              </div>
            </div>
          </div>

          <div className="p-4 pt-8">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold truncate group-hover:text-primary transition-colors">
                {profile.displayName}
              </h3>
            </div>
            <p className="text-sm text-muted-foreground">@{profile.username}</p>

            {profile.bio && (
              <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{profile.bio}</p>
            )}

            <div className="flex flex-wrap gap-1 mt-3">
              {profile.tags?.slice(0, 4).map((tag: string) => (
                <Badge key={tag} variant="outline" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>

            <div className="flex items-center justify-between mt-3 pt-3 border-t">
              <span className="text-xs text-muted-foreground">
                {profile.contentCount || 0} works
              </span>
              <Badge
                variant="secondary"
                className="text-xs"
                style={{ backgroundColor: `${accentColor}20`, color: accentColor }}
              >
                {profile.layout?.theme || 'default'}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function ContentFeedCard({ item }: { item: any }) {
  const isVideo = item.mediaType === 'video' || item.mediaType === 'ai-video';

  return (
    <Card className="overflow-hidden group cursor-pointer hover:shadow-lg transition-all duration-300">
      <CardContent className="p-0">
        <div className="relative aspect-video bg-muted">
          {item.thumbnailUrl ? (
            <img src={item.thumbnailUrl} alt={item.title} className="w-full h-full object-cover" />
          ) : isVideo ? (
            <video
              src={item.mediaUrl}
              className="w-full h-full object-cover"
              muted
              preload="metadata"
            />
          ) : (
            <img src={item.mediaUrl} alt={item.title} className="w-full h-full object-cover" />
          )}
          {isVideo && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity">
              <Play className="h-10 w-10 text-white" />
            </div>
          )}
          <div className="absolute top-2 right-2">
            <Badge
              variant={item.classification === 'monetized' ? 'default' : 'secondary'}
              className="text-xs"
            >
              {item.classification === 'monetized' ? (
                <>
                  <DollarSign className="h-3 w-3 mr-0.5" /> Monetized
                </>
              ) : (
                <>
                  <Sparkles className="h-3 w-3 mr-0.5" /> Fun
                </>
              )}
            </Badge>
          </div>
          <div className="absolute bottom-2 left-2">
            <Badge variant="outline" className="text-xs bg-black/40 text-white border-0">
              {item.mediaType === 'ai-video'
                ? 'AI Video'
                : item.mediaType === 'ai-image'
                  ? 'AI Image'
                  : item.mediaType}
            </Badge>
          </div>
        </div>

        <div className="p-3">
          <h3 className="font-medium truncate">{item.title}</h3>
          {item.description && (
            <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{item.description}</p>
          )}
          <div className="flex items-center justify-between mt-2">
            <div className="flex gap-1">
              {item.tags?.slice(0, 2).map((tag: string) => (
                <Badge key={tag} variant="outline" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
            <span className="text-xs text-muted-foreground">{item.views} views</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
