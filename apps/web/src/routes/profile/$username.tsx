/**
 * Public Profile Page
 *
 * Displays a user's public profile with their portfolio of content.
 * Shows different views for fan / original / licensed content.
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { trpcClient } from '@/utils/trpc';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Globe,
  Lock,
  Play,
  Sparkles,
  DollarSign,
  ExternalLink,
  Users,
  ShieldCheck,
} from 'lucide-react';
import { useWalletAuth } from '@/lib/wallet-auth';

export const Route = createFileRoute('/profile/$username')({
  component: ProfilePage,
});

/** Platform display config: label, URL builder */
const SOCIAL_PLATFORMS: Record<string, { label: string; url: (v: string) => string }> = {
  twitter: { label: 'X', url: (v) => `https://x.com/${encodeURIComponent(v)}` },
  instagram: { label: 'Instagram', url: (v) => `https://instagram.com/${encodeURIComponent(v)}` },
  tiktok: { label: 'TikTok', url: (v) => `https://tiktok.com/@${encodeURIComponent(v)}` },
  youtube: {
    label: 'YouTube',
    url: (v) => (v.startsWith('http') ? v : `https://youtube.com/@${encodeURIComponent(v)}`),
  },
  twitch: { label: 'Twitch', url: (v) => `https://twitch.tv/${encodeURIComponent(v)}` },
  discord: { label: 'Discord', url: (v) => `https://discord.com/users/${encodeURIComponent(v)}` },
  telegram: { label: 'Telegram', url: (v) => `https://t.me/${encodeURIComponent(v)}` },
  bluesky: { label: 'Bluesky', url: (v) => `https://bsky.app/profile/${encodeURIComponent(v)}` },
  farcaster: { label: 'Farcaster', url: (v) => `https://warpcast.com/${encodeURIComponent(v)}` },
  lens: { label: 'Lens', url: (v) => `https://hey.xyz/u/${encodeURIComponent(v)}` },
  github: { label: 'GitHub', url: (v) => `https://github.com/${encodeURIComponent(v)}` },
  linkedin: {
    label: 'LinkedIn',
    url: (v) => (v.startsWith('http') ? v : `https://linkedin.com/in/${encodeURIComponent(v)}`),
  },
  spotify: {
    label: 'Spotify',
    url: (v) =>
      v.startsWith('http') ? v : `https://open.spotify.com/artist/${encodeURIComponent(v)}`,
  },
  soundcloud: {
    label: 'SoundCloud',
    url: (v) => (v.startsWith('http') ? v : `https://soundcloud.com/${encodeURIComponent(v)}`),
  },
};

const THEME_CLASSES: Record<string, string> = {
  default: '',
  minimal: 'font-mono',
  cinematic: 'bg-gradient-to-b from-background to-zinc-950',
  neon: '',
  retro: 'font-serif',
};

function ProfilePage() {
  const { username } = Route.useParams();
  const { isAuthenticated, address } = useWalletAuth();

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['profile', username],
    queryFn: () => trpcClient.profiles.getByUsername.query({ username }) as Promise<any>,
  });

  const isOwnProfile = !!(address && profile?.id === address.toLowerCase());

  const { data: contentData } = useQuery({
    queryKey: ['profile-content', profile?.id],
    queryFn: () => trpcClient.content.getByCreator.query({ creatorUid: profile!.id, limit: 50 }),
    enabled: !!profile?.id && profile.visibility !== 'private',
  });

  const { data: followData } = useQuery({
    queryKey: ['is-following', profile?.id],
    queryFn: () => trpcClient.social.isFollowing.query({ targetUid: profile!.id }),
    enabled: isAuthenticated && !!profile?.id && !isOwnProfile,
  });

  if (profileLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div
          className="flex items-center justify-center"
          style={{ minHeight: 'calc(100vh - 64px)' }}
        >
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-background">
        <div
          className="flex flex-col items-center justify-center gap-4"
          style={{ minHeight: 'calc(100vh - 64px)' }}
        >
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
        <div
          className="flex flex-col items-center justify-center gap-4"
          style={{ minHeight: 'calc(100vh - 64px)' }}
        >
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

  const safeUrl = (url: string | undefined): string | null => {
    if (!url) return null;
    try {
      const parsed = new URL(url);
      return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : null;
    } catch {
      return null;
    }
  };

  const safeHexColor = (color: string | undefined, fallback = '#8b5cf6'): string => {
    if (!color) return fallback;
    return /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(color) ? color : fallback;
  };

  const layout = (profile as any).layout || {};
  const themeClass = THEME_CLASSES[layout.theme || 'default'] || '';
  const accentColor = safeHexColor(layout.accentColor);
  const socialLinks = (profile as any).socialLinks || {};
  const customLinks: { label: string; url: string }[] = ((profile as any).customLinks || []).filter(
    (link: { url: string }) => {
      try {
        return ['http:', 'https:'].includes(new URL(link.url).protocol);
      } catch {
        return false;
      }
    }
  );
  const tags = (profile as any).tags || [];
  const bio = (profile as any).bio || '';
  const followers = (profile as any).followers || 0;
  const following = (profile as any).following || 0;
  const items = contentData?.items || [];
  const fanItems = items.filter((i: any) => i.classification === 'fan');
  const originalItems = items.filter((i: any) => i.classification === 'original');
  const licensedItems = items.filter((i: any) => i.classification === 'licensed');
  const gridCols =
    layout.gridColumns === '2'
      ? 'md:grid-cols-2'
      : layout.gridColumns === '4'
        ? 'md:grid-cols-2 lg:grid-cols-4'
        : 'md:grid-cols-2 lg:grid-cols-3';

  return (
    <div className={`min-h-screen bg-background ${themeClass}`}>
      {/* Banner */}
      <div
        className="h-48 md:h-64 relative"
        style={{
          background: safeUrl(layout.bannerUrl)
            ? `url(${safeUrl(layout.bannerUrl)}) center/cover`
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
            {safeUrl((profile as any).avatarUrl) ? (
              <img
                src={safeUrl((profile as any).avatarUrl)!}
                alt={profile.displayName}
                className="w-full h-full object-cover"
              />
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
                  <Badge key={tag} variant="secondary">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}

            {/* Social Links */}
            {(socialLinks.website ||
              Object.keys(SOCIAL_PLATFORMS).some((k) => socialLinks[k]) ||
              customLinks.length > 0) && (
              <div className="flex flex-wrap gap-2 mt-3">
                {socialLinks.website &&
                  (() => {
                    try {
                      return ['http:', 'https:'].includes(new URL(socialLinks.website).protocol);
                    } catch {
                      return false;
                    }
                  })() && (
                    <a
                      href={socialLinks.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted/60 text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                      <Globe className="h-3.5 w-3.5" /> Website
                    </a>
                  )}
                {Object.entries(SOCIAL_PLATFORMS).map(([key, platform]) => {
                  const value = socialLinks[key];
                  if (!value) return null;
                  return (
                    <a
                      key={key}
                      href={platform.url(value)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted/60 text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                      {platform.label}
                    </a>
                  );
                })}
                {customLinks.map((link, i) => (
                  <a
                    key={`custom-${i}`}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted/60 text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {link.label}
                  </a>
                ))}
              </div>
            )}

            {/* Stats */}
            {layout.showStats !== false && (
              <div className="flex gap-6 mt-4 text-sm">
                <div>
                  <span className="font-semibold">{followers}</span>
                  <span className="text-muted-foreground ml-1">followers</span>
                </div>
                <div>
                  <span className="font-semibold">{following}</span>
                  <span className="text-muted-foreground ml-1">following</span>
                </div>
                <div>
                  <span className="font-semibold">{items.length}</span>
                  <span className="text-muted-foreground ml-1">works</span>
                </div>
              </div>
            )}

            {/* Follow button */}
            {isAuthenticated && !isOwnProfile && (
              <FollowButton
                targetUid={profile.id}
                isFollowing={followData?.following ?? false}
                accentColor={accentColor}
              />
            )}
          </div>
        </div>

        {/* Content Tabs */}
        <Tabs defaultValue="all" className="mt-8 pb-12">
          <TabsList>
            <TabsTrigger value="all">All ({items.length})</TabsTrigger>
            <TabsTrigger value="fan" className="gap-1">
              <Sparkles className="h-3 w-3" /> Non-Commercial ({fanItems.length})
            </TabsTrigger>
            <TabsTrigger value="original" className="gap-1">
              <DollarSign className="h-3 w-3" /> Creator-Owned ({originalItems.length})
            </TabsTrigger>
            <TabsTrigger value="licensed" className="gap-1">
              <ShieldCheck className="h-3 w-3" /> Rights-Cleared ({licensedItems.length})
            </TabsTrigger>
          </TabsList>

          {(['all', 'fan', 'original', 'licensed'] as const).map((tab) => {
            const tabItems =
              tab === 'all'
                ? items
                : tab === 'fan'
                  ? fanItems
                  : tab === 'original'
                    ? originalItems
                    : licensedItems;
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
          {/* Classification badge */}
          <div className="absolute top-2 right-2">
            <Badge
              variant={item.classification === 'fan' ? 'secondary' : 'default'}
              className="text-xs"
              style={item.classification !== 'fan' ? { backgroundColor: accentColor } : {}}
            >
              {item.classification === 'original' ? (
                <>
                  <DollarSign className="h-3 w-3 mr-0.5" /> Creator-Owned
                </>
              ) : item.classification === 'licensed' ? (
                <>
                  <ShieldCheck className="h-3 w-3 mr-0.5" /> Rights-Cleared
                </>
              ) : (
                <>
                  <Sparkles className="h-3 w-3 mr-0.5" /> Non-Commercial
                </>
              )}
            </Badge>
          </div>
          {/* Media type */}
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

        {/* Info */}
        <div className="p-3">
          <h3 className="font-medium truncate">{item.title}</h3>
          {item.description && (
            <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{item.description}</p>
          )}
          <div className="flex items-center justify-between mt-2">
            <div className="flex gap-2">
              {Array.isArray(item.tags) &&
                item.tags.slice(0, 3).map((tag: string) => (
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

function FollowButton({
  targetUid,
  isFollowing: initialFollowing,
  accentColor,
}: {
  targetUid: string;
  isFollowing: boolean;
  accentColor: string;
}) {
  const queryClient = useQueryClient();
  const [optimisticFollowing, setOptimisticFollowing] = useState(initialFollowing);

  useEffect(() => {
    setOptimisticFollowing(initialFollowing);
  }, [initialFollowing]);

  const followMutation = useMutation({
    mutationFn: () =>
      optimisticFollowing
        ? trpcClient.social.unfollow.mutate({ targetUid })
        : trpcClient.social.follow.mutate({ targetUid }),
    onMutate: () => setOptimisticFollowing(!optimisticFollowing),
    onError: () => setOptimisticFollowing(optimisticFollowing),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['is-following', targetUid] });
      queryClient.invalidateQueries({ queryKey: ['followers-count', targetUid] });
      queryClient.invalidateQueries({ queryKey: ['profile', targetUid] });
    },
  });

  return (
    <Button
      variant={optimisticFollowing ? 'outline' : 'default'}
      size="sm"
      className="mt-3"
      style={!optimisticFollowing ? { backgroundColor: accentColor } : {}}
      onClick={() => followMutation.mutate()}
      disabled={followMutation.isPending}
    >
      <Users className="h-4 w-4 mr-1" />
      {optimisticFollowing ? 'Following' : 'Follow'}
    </Button>
  );
}
