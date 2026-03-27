/**
 * Content Upload Page
 *
 * Upload content with clear classification between:
 * - Fun: Non-monetized, can use copyrighted/fan materials
 * - Monetized: Commercial use, strict IP protection required
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';
import Header from '@/components/header';
import { WalletConnectButton } from '@/components/wallet-connect-button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { useState } from 'react';
import {
  Upload as UploadIcon,
  Sparkles,
  DollarSign,
  Shield,
  AlertTriangle,
  Info,
  Plus,
  X,
  Eye,
  EyeOff,
  Globe,
} from 'lucide-react';

export const Route = createFileRoute('/upload')({
  component: UploadPage,
});

const LICENSES = [
  { value: 'all-rights-reserved', label: 'All Rights Reserved', desc: 'Full copyright protection' },
  { value: 'cc-by', label: 'CC BY', desc: 'Attribution required' },
  { value: 'cc-by-sa', label: 'CC BY-SA', desc: 'Attribution + ShareAlike' },
  { value: 'cc-by-nc', label: 'CC BY-NC', desc: 'Attribution + Non-Commercial' },
  { value: 'cc0', label: 'CC0 (Public Domain)', desc: 'No restrictions' },
  { value: 'fan-work', label: 'Fan Work', desc: 'Derivative/fan content — Fun only' },
];

function UploadPage() {
  const { isAuthenticated, isAuthenticating } = useWalletAuth();
  const isAuthed = isAuthenticated;
  const authLoading = isAuthenticating;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [mediaType, setMediaType] = useState<'video' | 'image' | 'ai-video' | 'ai-image'>('ai-video');
  const [classification, setClassification] = useState<'fun' | 'monetized'>('fun');
  const [visibility, setVisibility] = useState<'public' | 'private' | 'unlisted'>('public');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);

  // IP declaration
  const [isOriginal, setIsOriginal] = useState(true);
  const [usesCopyrighted, setUsesCopyrighted] = useState(false);
  const [copyrightNotes, setCopyrightNotes] = useState('');
  const [license, setLicense] = useState('all-rights-reserved');

  const createMutation = useMutation({
    mutationFn: (data: any) => trpcClient.content.create.mutate(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-content'] });
      toast.success('Content published!');
      navigate({ to: '/dashboard' });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to publish content');
    },
  });

  const handleSubmit = () => {
    if (!title) return toast.error('Title is required');
    if (!mediaUrl) return toast.error('Media URL is required');

    createMutation.mutate({
      title,
      description,
      mediaUrl,
      thumbnailUrl: thumbnailUrl || undefined,
      mediaType,
      classification,
      visibility,
      tags,
      ipDeclaration: {
        isOriginal,
        usescopyrightedMaterial: usesCopyrighted,
        copyrightNotes: copyrightNotes || undefined,
        license,
      },
    });
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (t && tags.length < 15 && !tags.includes(t)) {
      setTags([...tags, t]);
      setTagInput('');
    }
  };

  // Validation warnings for monetized content
  const monetizedWarnings: string[] = [];
  if (classification === 'monetized') {
    if (usesCopyrighted) monetizedWarnings.push('Monetized content cannot use copyrighted materials');
    if (!isOriginal) monetizedWarnings.push('Monetized content must be original work');
    if (license === 'fan-work') monetizedWarnings.push('Fan works cannot be monetized');
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="flex items-center justify-center" style={{ minHeight: 'calc(100vh - 64px)' }}>
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      </div>
    );
  }

  if (!isAuthed) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="flex flex-col items-center justify-center gap-4" style={{ minHeight: 'calc(100vh - 64px)' }}>
          <h2 className="text-xl font-semibold">Connect your wallet to upload content</h2>
          <p className="text-muted-foreground">Sign in with your wallet or email to get started</p>
          <WalletConnectButton size="lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="container mx-auto px-6 py-8 max-w-3xl">
        <h1 className="text-2xl font-bold mb-2">Upload Content</h1>
        <p className="text-muted-foreground mb-8">Share your work with the community</p>

        {/* Classification Selection — This is the KEY distinction */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" /> Content Classification
            </CardTitle>
            <CardDescription>
              Choose how your content is categorized. This affects IP rules and monetization eligibility.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Fun */}
              <div
                onClick={() => setClassification('fun')}
                className={`p-5 rounded-lg border-2 cursor-pointer transition-all ${
                  classification === 'fun'
                    ? 'border-amber-500 bg-amber-500/5'
                    : 'border-muted hover:border-muted-foreground/30'
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="h-6 w-6 text-amber-500" />
                  <h3 className="text-lg font-semibold">Fun</h3>
                </div>
                <p className="text-sm text-muted-foreground mb-3">
                  Non-monetized creative work. Perfect for experiments, fan content, and passion projects.
                </p>
                <div className="space-y-1 text-xs">
                  <div className="flex items-center gap-1 text-green-500">
                    <span>+</span> Can use copyrighted/fan materials
                  </div>
                  <div className="flex items-center gap-1 text-green-500">
                    <span>+</span> No IP restrictions
                  </div>
                  <div className="flex items-center gap-1 text-green-500">
                    <span>+</span> Fan art, remixes, parodies welcome
                  </div>
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <span>-</span> Cannot be monetized
                  </div>
                </div>
              </div>

              {/* Monetized */}
              <div
                onClick={() => setClassification('monetized')}
                className={`p-5 rounded-lg border-2 cursor-pointer transition-all ${
                  classification === 'monetized'
                    ? 'border-green-500 bg-green-500/5'
                    : 'border-muted hover:border-muted-foreground/30'
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <DollarSign className="h-6 w-6 text-green-500" />
                  <h3 className="text-lg font-semibold">Monetized</h3>
                </div>
                <p className="text-sm text-muted-foreground mb-3">
                  Commercial content eligible for revenue. Requires original work with strict IP compliance.
                </p>
                <div className="space-y-1 text-xs">
                  <div className="flex items-center gap-1 text-green-500">
                    <span>+</span> Eligible for monetization
                  </div>
                  <div className="flex items-center gap-1 text-green-500">
                    <span>+</span> Full IP protection
                  </div>
                  <div className="flex items-center gap-1 text-red-400">
                    <span>!</span> Must be 100% original work
                  </div>
                  <div className="flex items-center gap-1 text-red-400">
                    <span>!</span> No copyrighted materials allowed
                  </div>
                </div>
              </div>
            </div>

            {monetizedWarnings.length > 0 && (
              <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                <div className="flex items-center gap-2 text-red-500 font-medium text-sm mb-1">
                  <AlertTriangle className="h-4 w-4" /> IP Compliance Issues
                </div>
                {monetizedWarnings.map((w) => (
                  <p key={w} className="text-xs text-red-400">{w}</p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Content Details */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Content Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Give your work a title" maxLength={100} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe your work..." maxLength={2000} rows={4} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="mediaUrl">Media URL</Label>
                <Input id="mediaUrl" value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)} placeholder="https://..." />
              </div>
              <div className="space-y-2">
                <Label htmlFor="thumbnailUrl">Thumbnail URL (optional)</Label>
                <Input id="thumbnailUrl" value={thumbnailUrl} onChange={(e) => setThumbnailUrl(e.target.value)} placeholder="https://..." />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Media Type</Label>
                <Select value={mediaType} onValueChange={(v: any) => setMediaType(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ai-video">AI Generated Video</SelectItem>
                    <SelectItem value="video">Video</SelectItem>
                    <SelectItem value="ai-image">AI Generated Image</SelectItem>
                    <SelectItem value="image">Image</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Visibility</Label>
                <Select value={visibility} onValueChange={(v: any) => setVisibility(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="public"><div className="flex items-center gap-2"><Globe className="h-3 w-3" /> Public</div></SelectItem>
                    <SelectItem value="unlisted"><div className="flex items-center gap-2"><Eye className="h-3 w-3" /> Unlisted</div></SelectItem>
                    <SelectItem value="private"><div className="flex items-center gap-2"><EyeOff className="h-3 w-3" /> Private</div></SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Tags (up to 15)</Label>
              <div className="flex gap-2">
                <Input value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder="Add a tag..." maxLength={30} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())} />
                <Button type="button" variant="outline" onClick={addTag}><Plus className="h-4 w-4" /></Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="gap-1 cursor-pointer" onClick={() => setTags(tags.filter((t) => t !== tag))}>
                    {tag} <X className="h-3 w-3" />
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* IP Declaration */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" /> IP Declaration
            </CardTitle>
            <CardDescription>
              {classification === 'monetized'
                ? 'Monetized content requires strict IP compliance. You must declare originality.'
                : 'Fun content has relaxed IP rules. Be honest about your sources for community trust.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="isOriginal"
                checked={isOriginal}
                onChange={(e) => setIsOriginal(e.target.checked)}
                className="rounded"
              />
              <Label htmlFor="isOriginal">This is original work</Label>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="usesCopyrighted"
                checked={usesCopyrighted}
                onChange={(e) => setUsesCopyrighted(e.target.checked)}
                className="rounded"
                disabled={classification === 'monetized'}
              />
              <Label htmlFor="usesCopyrighted" className={classification === 'monetized' ? 'text-muted-foreground' : ''}>
                Uses copyrighted materials (fan art, samples, etc.)
                {classification === 'monetized' && <span className="text-red-400 ml-1">(not allowed for monetized)</span>}
              </Label>
            </div>

            {usesCopyrighted && (
              <div className="space-y-2 ml-6">
                <Label htmlFor="copyrightNotes">Copyright Notes</Label>
                <Textarea
                  id="copyrightNotes"
                  value={copyrightNotes}
                  onChange={(e) => setCopyrightNotes(e.target.value)}
                  placeholder="Describe what copyrighted materials are used and their sources..."
                  maxLength={500}
                  rows={3}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label>License</Label>
              <Select value={license} onValueChange={setLicense}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LICENSES.map((l) => (
                    <SelectItem
                      key={l.value}
                      value={l.value}
                      disabled={classification === 'monetized' && l.value === 'fan-work'}
                    >
                      <div>
                        <span className="font-medium">{l.label}</span>
                        <span className="text-muted-foreground ml-2 text-xs">{l.desc}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {classification === 'fun' && usesCopyrighted && (
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <div className="flex items-start gap-2">
                  <Info className="h-4 w-4 text-amber-500 mt-0.5" />
                  <div className="text-xs text-amber-600 dark:text-amber-400">
                    <p className="font-medium">Fun Content with Copyrighted Materials</p>
                    <p className="mt-1">This content is clearly marked as non-commercial fan work. It cannot be monetized. The original copyright holders retain their rights.</p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Submit */}
        <div className="flex justify-end gap-3 pb-8">
          <Button variant="outline" onClick={() => navigate({ to: '/dashboard' })}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={createMutation.isPending || monetizedWarnings.length > 0}
            className="gap-2"
          >
            <UploadIcon className="h-4 w-4" />
            {createMutation.isPending ? 'Publishing...' : 'Publish Content'}
          </Button>
        </div>
      </div>
    </div>
  );
}
