/**
 * Public Profile Page
 *
 * Displays a user's public profile with their portfolio of content.
 * Shows different views for fun vs monetized content.
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import Header from '@/components/header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Globe,
  Lock,
  Play,
  Image as ImageIcon,
  Sparkles,
  DollarSign,
  ExternalLink,
  ArrowLeft,
} from 'lucide-react';

export const Route = createFileRoute('/profile/$username')({
  component: ProfilePage,
});

const THEME_CLASSES: Record<string, string> = {
  default: '',
  minimal: 'font-mono',
  cinematic: 'bg-gradient-to-b from-background to-zinc-950',
  neon: '',
  retro: 'font-serif',
};

function ProfilePage() {
  const { username } = Route.useParams();

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['profile', username],
    queryFn: () => trpcClient.profiles.getByUsername.query({ username }),
  });

  const { data: contentData, isLoading: contentLoading } = useQuery({
    queryKey: ['profile-content', profile?.id],
    queryFn: () =>
      trpcClient.content.getByCreator.query({ creatorUid: profile!.id, limit: 50 }),
    enabled: !!profile?.id && profile.visibility !== 'private',
  });

  if (profileLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="flex items-center justify-center" style={{ minHeight: 'calc(100vh - 64px)' }}>
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="flex flex-col items-center justify-center gap-4" style={{ minHeight: 'calc(100vh - 64px)' }}>
          <h2 className="text-xl font-semibold">Profile not found</h2>
          <p className="text-muted-foreground">The user @{username} doesn't exist.</p>
          <Button asChild variant="outline">
            <Link to="/discover">Browse Creators</Link>
          </Button>
        </div>
      </div>
    );
  }

  // Private profile — minimal view
  if (profile.visibility === 'private') {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="flex flex-col items-center justify-center gap-4" style={{ minHeight: 'calc(100vh - 64px)' }}>
          <Lock className="h-12 w-12 text-muted-foreground" />
          <h2 className="text-xl font-semibold">{profile.displayName}</h2>
          <p className="text-muted-foreground">This profile is private.</p>
          <Button asChild variant="outline">
            <Link to="/discover">Browse Creators</Link>
          </Button>
        </div>
      </div>
    );
  }

  const layout = (profile as any).layout || {};
  const themeClass = THEME_CLASSES[layout.theme || 'default'] || '';
  const accentColor = layout.accentColor || '#8b5cf6';
  const socialLinks = (profile as any).socialLinks || {};
  const tags = (profile as any).tags || [];
  const bio = (profile as any).bio || '';
  const items = contentData?.items || [];
  const funItems = items.filter((i: any) => i.classification === 'fun');
  const monetizedItems = items.filter((i: any) => i.classification === 'monetized');
  const gridCols = layout.gridColumns === '2' ? 'md:grid-cols-2' : layout.gridColumns === '4' ? 'md:grid-cols-2 lg:grid-cols-4' : 'md:grid-cols-2 lg:grid-cols-3';

  return (
    <div className={`min-h-screen bg-background ${themeClass}`}>
      <Header />

      {/* Banner */}
      <div
        className="h-48 md:h-64 relative"
        style={{
          background: layout.bannerUrl
            ? `url(${layout.bannerUrl}) center/cover`
            : `linear-gradient(135deg, ${accentColor}40, ${accentColor}10)`,
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-t from-background to-transparent" />
      </div>

      {/* Profile Info */}
      <div className="container mx-auto px-6 -mt-16 relative z-10">
        <div className="flex flex-col md:flex-row gap-6 items-start">
          {/* Avatar */}
          <div
            className="w-32 h-32 rounded-full border-4 border-background bg-muted flex items-center justify-center text-3xl font-bold overflow-hidden"
            style={{ borderColor: accentColor }}
          >
            {(profile as any).avatarUrl ? (
              <img src={(profile as any).avatarUrl} alt={profile.displayName} className="w-full h-full object-cover" />
            ) : (
              profile.displayName.charAt(0).toUpperCase()
            )}
          </div>

          {/* Info */}
          <div className="flex-1 pt-4">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold">{profile.displayName}</h1>
              <span className="text-muted-foreground">@{profile.username}</span>
              <Badge variant="outline" className="gap-1">
                <Globe className="h-3 w-3" /> Public
              </Badge>
            </div>

            {bio && <p className="mt-2 text-muted-foreground max-w-2xl">{bio}</p>}

            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
                {tags.map((tag: string) => (
                  <Badge key={tag} variant="secondary">{tag}</Badge>
                ))}
              </div>
            )}

            {/* Social Links */}
            <div className="flex gap-3 mt-3">
              {socialLinks.website && (
                <a href={socialLinks.website} target="_blank" rel="noopener noreferrer" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
                  <ExternalLink className="h-3 w-3" /> Website
                </a>
              )}
              {socialLinks.twitter && (
                <a href={`https://x.com/${socialLinks.twitter}`} target="_blank" rel="noopener noreferrer" className="text-sm text-muted-foreground hover:text-foreground">
                  @{socialLinks.twitter}
                </a>
              )}
              {socialLinks.youtube && (
                <a href={socialLinks.youtube} target="_blank" rel="noopener noreferrer" className="text-sm text-muted-foreground hover:text-foreground">
                  YouTube
                </a>
              )}
            </div>

            {/* Stats */}
            {layout.showStats !== false && (
              <div className="flex gap-6 mt-4 text-sm">
                <div>
                  <span className="font-semibold">{items.length}</span>
                  <span className="text-muted-foreground ml-1">works</span>
                </div>
                <div>
                  <span className="font-semibold">{funItems.length}</span>
                  <span className="text-muted-foreground ml-1">fun</span>
                </div>
                <div>
                  <span className="font-semibold">{monetizedItems.length}</span>
                  <span className="text-muted-foreground ml-1">monetized</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Content Tabs */}
        <Tabs defaultValue="all" className="mt-8 pb-12">
          <TabsList>
            <TabsTrigger value="all">All ({items.length})</TabsTrigger>
            <TabsTrigger value="fun" className="gap-1">
              <Sparkles className="h-3 w-3" /> Fun ({funItems.length})
            </TabsTrigger>
            <TabsTrigger value="monetized" className="gap-1">
              <DollarSign className="h-3 w-3" /> Monetized ({monetizedItems.length})
            </TabsTrigger>
          </TabsList>

          {['all', 'fun', 'monetized'].map((tab) => {
            const tabItems = tab === 'all' ? items : tab === 'fun' ? funItems : monetizedItems;
            return (
              <TabsContent key={tab} value={tab}>
                {tabItems.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    No {tab === 'all' ? '' : tab} content yet.
                  </div>
                ) : (
                  <div className={`grid grid-cols-1 ${gridCols} gap-4`}>
                    {tabItems.map((item: any) => (
                      <ContentCard key={item.id} item={item} accentColor={accentColor} />
                    ))}
                  </div>
                )}
              </TabsContent>
            );
          })}
        </Tabs>
      </div>
    </div>
  );
}

function ContentCard({ item, accentColor }: { item: any; accentColor: string }) {
  const isVideo = item.mediaType === 'video' || item.mediaType === 'ai-video';

  return (
    <Card className="overflow-hidden group cursor-pointer hover:shadow-lg transition-all duration-300">
      <CardContent className="p-0">
        {/* Thumbnail */}
        <div className="relative aspect-video bg-muted">
          {item.thumbnailUrl ? (
            <img src={item.thumbnailUrl} alt={item.title} className="w-full h-full object-cover" />
          ) : isVideo ? (
            <video src={item.mediaUrl} className="w-full h-full object-cover" muted preload="metadata" />
          ) : (
            <img src={item.mediaUrl} alt={item.title} className="w-full h-full object-cover" />
          )}
          {isVideo && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity">
              <Play className="h-10 w-10 text-white" />
            </div>
          )}
          {/* Classification badge */}
          <div className="absolute top-2 right-2">
            <Badge
              variant={item.classification === 'monetized' ? 'default' : 'secondary'}
              className="text-xs"
              style={item.classification === 'monetized' ? { backgroundColor: accentColor } : {}}
            >
              {item.classification === 'monetized' ? (
                <><DollarSign className="h-3 w-3 mr-0.5" /> Monetized</>
              ) : (
                <><Sparkles className="h-3 w-3 mr-0.5" /> Fun</>
              )}
            </Badge>
          </div>
          {/* Media type */}
          <div className="absolute bottom-2 left-2">
            <Badge variant="outline" className="text-xs bg-black/40 text-white border-0">
              {item.mediaType === 'ai-video' ? 'AI Video' : item.mediaType === 'ai-image' ? 'AI Image' : item.mediaType}
            </Badge>
          </div>
        </div>

        {/* Info */}
        <div className="p-3">
          <h3 className="font-medium truncate">{item.title}</h3>
          {item.description && (
            <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{item.description}</p>
          )}
          <div className="flex items-center justify-between mt-2">
            <div className="flex gap-2">
              {item.tags?.slice(0, 3).map((tag: string) => (
                <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
              ))}
            </div>
            <span className="text-xs text-muted-foreground">
              {item.views} views
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
