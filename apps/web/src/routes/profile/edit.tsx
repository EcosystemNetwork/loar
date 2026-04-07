/**
 * Profile Editor
 *
 * Lets users customize their profile: display name, username, bio,
 * avatar, privacy settings, layout/theme, social links, and tags.
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';

import { WalletConnectButton } from '@/components/wallet-connect-button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { useState, useEffect } from 'react';
import { User, Palette, Globe, Lock, Eye, Save, Check, X, Plus, Link2 } from 'lucide-react';

export const Route = createFileRoute('/profile/edit')({
  component: ProfileEditor,
});

const THEMES = [
  { value: 'default', label: 'Default', desc: 'Clean and modern' },
  { value: 'minimal', label: 'Minimal', desc: 'Monospace, stripped-down' },
  { value: 'cinematic', label: 'Cinematic', desc: 'Dark gradient, dramatic' },
  { value: 'neon', label: 'Neon', desc: 'Vibrant accents' },
  { value: 'retro', label: 'Retro', desc: 'Serif, classic feel' },
];

const GRID_OPTIONS = [
  { value: '2', label: '2 Columns' },
  { value: '3', label: '3 Columns' },
  { value: '4', label: '4 Columns' },
];

function ProfileEditor() {
  const { isAuthenticated, isAuthenticating, address } = useWalletAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const isAuthed = isAuthenticated;
  const authLoading = isAuthenticating;

  const { data: profile, isLoading } = useQuery({
    queryKey: ['my-profile'],
    queryFn: () => trpcClient.profiles.me.query(),
    enabled: isAuthed,
  });

  // Form state
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('private');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [website, setWebsite] = useState('');
  const [twitter, setTwitter] = useState('');
  const [youtube, setYoutube] = useState('');
  const [discord, setDiscord] = useState('');
  const [theme, setTheme] = useState('default');
  const [accentColor, setAccentColor] = useState('#8b5cf6');
  const [bannerUrl, setBannerUrl] = useState('');
  const [showStats, setShowStats] = useState(true);
  const [gridColumns, setGridColumns] = useState('3');

  // Username availability check
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>(
    'idle'
  );

  useEffect(() => {
    if (profile) {
      const p = profile as any;
      setDisplayName(
        p.displayName || (address ? `${address.slice(0, 6)}...${address.slice(-4)}` : '')
      );
      setUsername(p.username || '');
      setBio(p.bio || '');
      setAvatarUrl(p.avatarUrl || '');
      setVisibility(p.visibility || 'private');
      setTags(p.tags || []);
      setWebsite(p.socialLinks?.website || '');
      setTwitter(p.socialLinks?.twitter || '');
      setYoutube(p.socialLinks?.youtube || '');
      setDiscord(p.socialLinks?.discord || '');
      setTheme(p.layout?.theme || 'default');
      setAccentColor(p.layout?.accentColor || '#8b5cf6');
      setBannerUrl(p.layout?.bannerUrl || '');
      setShowStats(p.layout?.showStats !== false);
      setGridColumns(p.layout?.gridColumns || '3');
    } else if (address) {
      setDisplayName(`${address.slice(0, 6)}...${address.slice(-4)}`);
    }
  }, [profile, address]);

  // Check username availability with debounce
  useEffect(() => {
    if (!username || username.length < 3) {
      setUsernameStatus('idle');
      return;
    }
    const existingUsername = (profile as any)?.username;
    if (username.toLowerCase() === existingUsername) {
      setUsernameStatus('available');
      return;
    }

    setUsernameStatus('checking');
    const timeout = setTimeout(async () => {
      try {
        const result = await trpcClient.profiles.checkUsername.query({ username });
        setUsernameStatus(result.available ? 'available' : 'taken');
      } catch {
        setUsernameStatus('idle');
      }
    }, 500);

    return () => clearTimeout(timeout);
  }, [username, profile]);

  const upsertMutation = useMutation({
    mutationFn: (data: any) => trpcClient.profiles.upsert.mutate(data),
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ['my-profile'] });
      toast.success('Profile saved!');
      navigate({ to: '/profile/$username', params: { username: result.username } });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to save profile');
    },
  });

  const handleSave = () => {
    if (!username || username.length < 3) {
      toast.error('Username must be at least 3 characters');
      return;
    }
    if (usernameStatus === 'taken') {
      toast.error('Username is already taken');
      return;
    }
    if (!displayName) {
      toast.error('Display name is required');
      return;
    }

    upsertMutation.mutate({
      displayName,
      username,
      bio,
      avatarUrl: avatarUrl || undefined,
      visibility,
      tags,
      socialLinks: {
        website: website || undefined,
        twitter: twitter || undefined,
        youtube: youtube || undefined,
        discord: discord || undefined,
      },
      layout: {
        theme,
        accentColor,
        bannerUrl: bannerUrl || undefined,
        showStats,
        gridColumns: gridColumns as '2' | '3' | '4',
        featuredContentIds: [],
      },
    });
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (t && tags.length < 10 && !tags.includes(t)) {
      setTags([...tags, t]);
      setTagInput('');
    }
  };

  if (authLoading || isLoading) {
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

  if (!isAuthed) {
    return (
      <div className="min-h-screen bg-background">
        <div
          className="flex flex-col items-center justify-center gap-4"
          style={{ minHeight: 'calc(100vh - 64px)' }}
        >
          <h2 className="text-xl font-semibold">Connect your wallet to create a profile</h2>
          <p className="text-muted-foreground">Sign in with your wallet or email to get started</p>
          <WalletConnectButton size="lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-6 py-8 max-w-4xl">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold">Edit Profile</h1>
            <p className="text-muted-foreground">Customize how others see you</p>
          </div>
          <div className="flex gap-2">
            {(profile as any)?.username && (
              <Button variant="outline" asChild>
                <a href={`/profile/${(profile as any).username}`}>
                  <Eye className="h-4 w-4 mr-2" /> Preview
                </a>
              </Button>
            )}
            <Button onClick={handleSave} disabled={upsertMutation.isPending}>
              <Save className="h-4 w-4 mr-2" />
              {upsertMutation.isPending ? 'Saving...' : 'Save Profile'}
            </Button>
          </div>
        </div>

        <Tabs defaultValue="basic" className="space-y-6">
          <TabsList className="w-full justify-start">
            <TabsTrigger value="basic" className="gap-1">
              <User className="h-4 w-4" /> Basic
            </TabsTrigger>
            <TabsTrigger value="design" className="gap-1">
              <Palette className="h-4 w-4" /> Design
            </TabsTrigger>
            <TabsTrigger value="social" className="gap-1">
              <Link2 className="h-4 w-4" /> Social
            </TabsTrigger>
            <TabsTrigger value="privacy" className="gap-1">
              <Lock className="h-4 w-4" /> Privacy
            </TabsTrigger>
          </TabsList>

          {/* Basic Info */}
          <TabsContent value="basic">
            <Card>
              <CardHeader>
                <CardTitle>Basic Information</CardTitle>
                <CardDescription>Your public identity on LOAR</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="displayName">Display Name</Label>
                    <Input
                      id="displayName"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Your name"
                      maxLength={50}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="username">Username</Label>
                    <div className="relative">
                      <Input
                        id="username"
                        value={username}
                        onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
                        placeholder="your-username"
                        maxLength={30}
                        className="pr-8"
                      />
                      <div className="absolute right-2 top-1/2 -translate-y-1/2">
                        {usernameStatus === 'checking' && (
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary" />
                        )}
                        {usernameStatus === 'available' && (
                          <Check className="h-4 w-4 text-green-500" />
                        )}
                        {usernameStatus === 'taken' && <X className="h-4 w-4 text-red-500" />}
                      </div>
                    </div>
                    {usernameStatus === 'taken' && (
                      <p className="text-xs text-red-500">This username is taken</p>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="bio">Bio</Label>
                  <Textarea
                    id="bio"
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    placeholder="Tell people about yourself and your work..."
                    maxLength={500}
                    rows={4}
                  />
                  <p className="text-xs text-muted-foreground">{bio.length}/500</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="avatarUrl">Avatar URL</Label>
                  <Input
                    id="avatarUrl"
                    value={avatarUrl}
                    onChange={(e) => setAvatarUrl(e.target.value)}
                    placeholder="https://..."
                  />
                </div>

                <div className="space-y-2">
                  <Label>Tags (up to 10)</Label>
                  <div className="flex gap-2">
                    <Input
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      placeholder="Add a tag..."
                      maxLength={20}
                      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={addTag}
                      disabled={tags.length >= 10}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {tags.map((tag) => (
                      <Badge
                        key={tag}
                        variant="secondary"
                        className="gap-1 cursor-pointer"
                        onClick={() => setTags(tags.filter((t) => t !== tag))}
                      >
                        {tag} <X className="h-3 w-3" />
                      </Badge>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Design */}
          <TabsContent value="design">
            <Card>
              <CardHeader>
                <CardTitle>Profile Design</CardTitle>
                <CardDescription>Customize the look of your profile page</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label>Theme</Label>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {THEMES.map((t) => (
                      <div
                        key={t.value}
                        onClick={() => setTheme(t.value)}
                        className={`p-3 rounded-lg border-2 cursor-pointer transition-colors ${
                          theme === t.value
                            ? 'border-primary bg-primary/5'
                            : 'border-muted hover:border-muted-foreground/30'
                        }`}
                      >
                        <p className="font-medium text-sm">{t.label}</p>
                        <p className="text-xs text-muted-foreground">{t.desc}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="accentColor">Accent Color</Label>
                    <div className="flex gap-2 items-center">
                      <input
                        type="color"
                        id="accentColor"
                        value={accentColor}
                        onChange={(e) => setAccentColor(e.target.value)}
                        className="w-10 h-10 rounded cursor-pointer border-0"
                      />
                      <Input
                        value={accentColor}
                        onChange={(e) => setAccentColor(e.target.value)}
                        className="flex-1"
                        placeholder="#8b5cf6"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Grid Columns</Label>
                    <Select value={gridColumns} onValueChange={setGridColumns}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {GRID_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="bannerUrl">Banner Image URL</Label>
                  <Input
                    id="bannerUrl"
                    value={bannerUrl}
                    onChange={(e) => setBannerUrl(e.target.value)}
                    placeholder="https://..."
                  />
                  {bannerUrl && (
                    <div className="h-24 rounded-md overflow-hidden">
                      <img
                        src={bannerUrl}
                        alt="Banner preview"
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="showStats"
                    checked={showStats}
                    onChange={(e) => setShowStats(e.target.checked)}
                    className="rounded"
                  />
                  <Label htmlFor="showStats">Show content stats on profile</Label>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Social */}
          <TabsContent value="social">
            <Card>
              <CardHeader>
                <CardTitle>Social Links</CardTitle>
                <CardDescription>Connect your other platforms</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="website">Website</Label>
                  <Input
                    id="website"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    placeholder="https://yoursite.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="twitter">X / Twitter handle</Label>
                  <Input
                    id="twitter"
                    value={twitter}
                    onChange={(e) => setTwitter(e.target.value)}
                    placeholder="username"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="youtube">YouTube</Label>
                  <Input
                    id="youtube"
                    value={youtube}
                    onChange={(e) => setYoutube(e.target.value)}
                    placeholder="https://youtube.com/@channel"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="discord">Discord</Label>
                  <Input
                    id="discord"
                    value={discord}
                    onChange={(e) => setDiscord(e.target.value)}
                    placeholder="username#1234"
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Privacy */}
          <TabsContent value="privacy">
            <Card>
              <CardHeader>
                <CardTitle>Privacy Settings</CardTitle>
                <CardDescription>Control who can see your profile and content</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div
                    onClick={() => setVisibility('public')}
                    className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                      visibility === 'public'
                        ? 'border-primary bg-primary/5'
                        : 'border-muted hover:border-muted-foreground/30'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <Globe className="h-5 w-5" />
                      <h3 className="font-semibold">Public</h3>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Your profile appears in the creator gallery. Anyone can view your portfolio
                      and public content.
                    </p>
                  </div>
                  <div
                    onClick={() => setVisibility('private')}
                    className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                      visibility === 'private'
                        ? 'border-primary bg-primary/5'
                        : 'border-muted hover:border-muted-foreground/30'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <Lock className="h-5 w-5" />
                      <h3 className="font-semibold">Private</h3>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Your profile is hidden from the gallery. Only your username and avatar are
                      visible to others.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
