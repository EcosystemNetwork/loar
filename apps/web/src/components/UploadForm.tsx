import { useMutation, useQueryClient } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { ContentLaneBadge } from '@/components/ContentLaneBadge';
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
import { toast } from 'sonner';
import { useState, useRef, useCallback } from 'react';
import { getSiweToken } from '@/lib/wallet-auth';
import {
  Upload as UploadIcon,
  Sparkles,
  DollarSign,
  FileText,
  Shield,
  AlertTriangle,
  Info,
  Plus,
  X,
  Eye,
  EyeOff,
  Globe,
  CloudUpload,
  CheckCircle2,
  Loader2,
} from 'lucide-react';

const LICENSES = [
  { value: 'all-rights-reserved', label: 'All Rights Reserved', desc: 'Full copyright protection' },
  { value: 'cc-by', label: 'CC BY', desc: 'Attribution required' },
  { value: 'cc-by-sa', label: 'CC BY-SA', desc: 'Attribution + ShareAlike' },
  { value: 'cc-by-nc', label: 'CC BY-NC', desc: 'Attribution + Non-Commercial' },
  { value: 'cc0', label: 'CC0 (Public Domain)', desc: 'No restrictions' },
  { value: 'fan-work', label: 'Fan Work', desc: 'Derivative/fan content — Non-Commercial only' },
];

type ContentLane = 'fan' | 'original' | 'licensed';

interface UploadFormProps {
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function UploadForm({ onSuccess, onCancel }: UploadFormProps) {
  const queryClient = useQueryClient();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [mediaType, setMediaType] = useState<'video' | 'image' | 'ai-video' | 'ai-image'>(
    'ai-video'
  );

  const [uploadState, setUploadState] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [classification, setClassification] = useState<ContentLane>('fan');
  const [visibility, setVisibility] = useState<'public' | 'private' | 'unlisted'>('public');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);

  const [isOriginal, setIsOriginal] = useState(true);
  const [usesCopyrighted, setUsesCopyrighted] = useState(false);
  const [copyrightNotes, setCopyrightNotes] = useState('');
  const [license, setLicense] = useState('all-rights-reserved');

  const [licensorName, setLicensorName] = useState('');
  const [licenseType, setLicenseType] = useState<'exclusive' | 'non-exclusive' | 'sublicense'>(
    'non-exclusive'
  );
  const [territory, setTerritory] = useState('');
  const [termEnd, setTermEnd] = useState('');
  const [approvedUses, setApprovedUses] = useState<string[]>([]);
  const [royaltySplit, setRoyaltySplit] = useState(80);
  const [documentUrl, setDocumentUrl] = useState('');

  const createMutation = useMutation({
    mutationFn: (data: any) => trpcClient.content.create.mutate(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-content'] });
      queryClient.invalidateQueries({ queryKey: ['my-content-dashboard'] });
      toast.success('Content published!');
      onSuccess?.();
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to publish content');
    },
  });

  const uploadFile = useCallback(async (file: File) => {
    const ALLOWED = ['video/mp4', 'video/webm', 'image/png', 'image/jpeg', 'image/gif'];
    if (!ALLOWED.includes(file.type)) {
      setUploadError(`Unsupported type: ${file.type}`);
      setUploadState('error');
      return;
    }
    if (file.size > 200 * 1024 * 1024) {
      setUploadError('File too large (max 200MB)');
      setUploadState('error');
      return;
    }

    setUploadState('uploading');
    setUploadProgress(0);
    setUploadError('');

    if (file.type.startsWith('video/')) {
      setMediaType('video');
    } else if (file.type.startsWith('image/')) {
      setMediaType('image');
    }

    const formData = new FormData();
    formData.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${import.meta.env.VITE_SERVER_URL}/api/upload`);

    const token = getSiweToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
    };

    xhr.onload = () => {
      if (xhr.status === 200) {
        try {
          const { manifest } = JSON.parse(xhr.responseText);
          const url = manifest?.primaryUrl || manifest?.urls?.[0];
          if (url) {
            setMediaUrl(url);
            setUploadState('done');
          } else {
            setUploadError('Upload succeeded but no URL returned');
            setUploadState('error');
          }
        } catch {
          setUploadError('Invalid server response');
          setUploadState('error');
        }
      } else {
        try {
          const { message } = JSON.parse(xhr.responseText);
          setUploadError(message || 'Upload failed');
        } catch {
          setUploadError(`Upload failed (${xhr.status})`);
        }
        setUploadState('error');
      }
    };

    xhr.onerror = () => {
      setUploadError('Network error during upload');
      setUploadState('error');
    };

    xhr.send(formData);
  }, []);

  const handleFileDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) uploadFile(file);
    },
    [uploadFile]
  );

  const handleSubmit = () => {
    if (!title) return toast.error('Title is required');
    if (!mediaUrl) return toast.error('Media URL is required');
    if (classification === 'licensed') {
      if (!licensorName) return toast.error('Licensor name is required for Rights-Cleared content');
      if (!territory) return toast.error('Territory is required');
      if (approvedUses.length === 0) return toast.error('At least one approved use is required');
    }

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
        usesCopyrightedMaterial: usesCopyrighted,
        copyrightNotes: copyrightNotes || undefined,
        license,
      },
      licensingProof:
        classification === 'licensed'
          ? {
              licensorName,
              licenseType,
              territory,
              termEnd: termEnd || undefined,
              approvedUses,
              restrictedUses: [],
              royaltySplit,
              documentUrl: documentUrl || undefined,
            }
          : undefined,
    });
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (t && tags.length < 15 && !tags.includes(t)) {
      setTags([...tags, t]);
      setTagInput('');
    }
  };

  const toggleApprovedUse = (use: string) => {
    setApprovedUses((prev) =>
      prev.includes(use) ? prev.filter((u) => u !== use) : [...prev, use]
    );
  };

  const isMonetized = classification === 'original' || classification === 'licensed';
  const complianceWarnings: string[] = [];
  if (isMonetized) {
    if (usesCopyrighted)
      complianceWarnings.push('Monetized content cannot use copyrighted materials');
    if (!isOriginal) complianceWarnings.push('Monetized content must be original work');
    if (license === 'fan-work') complianceWarnings.push('Fan works cannot be monetized');
  }

  return (
    <div className="max-w-3xl">
      {/* Lane Selection */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" /> Content Classification
          </CardTitle>
          <CardDescription>
            Choose your lane. This determines IP rules and monetization eligibility.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div
              onClick={() => setClassification('fan')}
              className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                classification === 'fan'
                  ? 'border-amber-500 bg-amber-500/5'
                  : 'border-muted hover:border-muted-foreground/30'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="h-5 w-5 text-amber-500" />
                <h3 className="font-semibold">Non-Commercial</h3>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Fan work, parody, experiments, personal projects.
              </p>
              <div className="space-y-1 text-xs">
                <div className="text-green-500">+ Can use fan/copyrighted materials</div>
                <div className="text-green-500">+ No IP restrictions</div>
                <div className="text-muted-foreground">- Cannot be monetized</div>
              </div>
            </div>

            <div
              onClick={() => setClassification('original')}
              className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                classification === 'original'
                  ? 'border-blue-500 bg-blue-500/5'
                  : 'border-muted hover:border-muted-foreground/30'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="h-5 w-5 text-blue-500" />
                <h3 className="font-semibold">Creator-Owned</h3>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Original work you created. AI-generated content qualifies.
              </p>
              <div className="space-y-1 text-xs">
                <div className="text-green-500">+ Full monetization</div>
                <div className="text-green-500">+ NFT, subscribe, license</div>
                <div className="text-red-400">! Must be original IP</div>
              </div>
            </div>

            <div
              onClick={() => setClassification('licensed')}
              className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                classification === 'licensed'
                  ? 'border-green-500 bg-green-500/5'
                  : 'border-muted hover:border-muted-foreground/30'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <FileText className="h-5 w-5 text-green-500" />
                <h3 className="font-semibold">Rights-Cleared</h3>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Licensed from a rights holder. Requires documentation + review.
              </p>
              <div className="space-y-1 text-xs">
                <div className="text-green-500">+ Full monetization</div>
                <div className="text-amber-500">~ Requires manual review</div>
                <div className="text-red-400">! Upload license agreement</div>
              </div>
            </div>
          </div>

          {classification === 'fan' && (
            <div className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-400">
              <Info className="h-3.5 w-3.5 inline mr-1.5" />
              Non-Commercial content cannot be minted, sold, or licensed. Fan and parody use is
              permitted as a platform policy — this is not a legal opinion. Third-party rights
              holders may still object to specific content.
            </div>
          )}
          {classification === 'original' && (
            <div className="mt-4 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs text-blue-700 dark:text-blue-400">
              <Info className="h-3.5 w-3.5 inline mr-1.5" />
              LOAR treats you as the rights claimant for content you create here, subject to
              applicable law. AI-generated output is included. LOAR does not verify ownership
              declarations — you are responsible for any third-party rights claims.
            </div>
          )}
          {classification === 'licensed' && (
            <div className="mt-4 p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-xs text-green-700 dark:text-green-400">
              <Info className="h-3.5 w-3.5 inline mr-1.5" />
              Monetization is disabled until the LOAR team verifies your licensing documentation.
              Expect up to 5 business days for review.
            </div>
          )}

          {complianceWarnings.length > 0 && (
            <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <div className="flex items-center gap-2 text-red-500 font-medium text-sm mb-1">
                <AlertTriangle className="h-4 w-4" /> IP Compliance Issues
              </div>
              {complianceWarnings.map((w) => (
                <p key={w} className="text-xs text-red-400">
                  {w}
                </p>
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
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Give your work a title"
              maxLength={100}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe your work..."
              maxLength={2000}
              rows={4}
            />
          </div>

          {/* File Upload Zone */}
          <div className="space-y-2">
            <Label>Media File</Label>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleFileDrop}
              onClick={() => uploadState !== 'uploading' && fileInputRef.current?.click()}
              className={`relative rounded-lg border-2 border-dashed transition-colors cursor-pointer
                ${isDragging ? 'border-primary bg-primary/5' : uploadState === 'done' ? 'border-green-500 bg-green-500/5' : uploadState === 'error' ? 'border-red-500 bg-red-500/5' : 'border-muted-foreground/30 hover:border-primary/50 hover:bg-muted/30'}
                ${uploadState === 'uploading' ? 'cursor-not-allowed' : ''}
              `}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="video/mp4,video/webm,image/png,image/jpeg,image/gif"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadFile(f);
                }}
              />
              <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
                {uploadState === 'idle' && (
                  <>
                    <CloudUpload className="h-8 w-8 text-muted-foreground mb-2" />
                    <p className="text-sm font-medium">Drag &amp; drop or click to upload</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      MP4, WebM, PNG, JPEG, GIF — max 200MB
                    </p>
                  </>
                )}
                {uploadState === 'uploading' && (
                  <>
                    <Loader2 className="h-8 w-8 text-primary animate-spin mb-2" />
                    <p className="text-sm font-medium">Uploading... {uploadProgress}%</p>
                    <div className="w-full max-w-xs mt-3 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all duration-300"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                  </>
                )}
                {uploadState === 'done' && (
                  <>
                    <CheckCircle2 className="h-8 w-8 text-green-500 mb-2" />
                    <p className="text-sm font-medium text-green-500">Upload complete</p>
                    <p className="text-xs text-muted-foreground mt-1">Click to replace</p>
                  </>
                )}
                {uploadState === 'error' && (
                  <>
                    <AlertTriangle className="h-8 w-8 text-red-500 mb-2" />
                    <p className="text-sm font-medium text-red-500">{uploadError}</p>
                    <p className="text-xs text-muted-foreground mt-1">Click to retry</p>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="mediaUrl">Media URL</Label>
              <Input
                id="mediaUrl"
                value={mediaUrl}
                onChange={(e) => setMediaUrl(e.target.value)}
                placeholder="https://... (or upload above)"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="thumbnailUrl">Thumbnail URL (optional)</Label>
              <Input
                id="thumbnailUrl"
                value={thumbnailUrl}
                onChange={(e) => setThumbnailUrl(e.target.value)}
                placeholder="https://..."
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Media Type</Label>
              <Select value={mediaType} onValueChange={(v: any) => setMediaType(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
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
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">
                    <div className="flex items-center gap-2">
                      <Globe className="h-3 w-3" /> Public
                    </div>
                  </SelectItem>
                  <SelectItem value="unlisted">
                    <div className="flex items-center gap-2">
                      <Eye className="h-3 w-3" /> Unlisted
                    </div>
                  </SelectItem>
                  <SelectItem value="private">
                    <div className="flex items-center gap-2">
                      <EyeOff className="h-3 w-3" /> Private
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Tags (up to 15)</Label>
            <div className="flex gap-2">
              <Input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                placeholder="Add a tag..."
                maxLength={30}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
              />
              <Button type="button" variant="outline" onClick={addTag}>
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

      {/* IP Declaration */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" /> IP Declaration
          </CardTitle>
          <CardDescription className="flex items-center gap-2">
            <ContentLaneBadge classification={classification} size="sm" />
            {classification === 'fan'
              ? 'Non-Commercial content has relaxed IP rules.'
              : 'Monetized content requires originality declaration.'}
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
            <Label htmlFor="isOriginal">This is original work (or I have documented rights)</Label>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="usesCopyrighted"
              checked={usesCopyrighted}
              onChange={(e) => setUsesCopyrighted(e.target.checked)}
              className="rounded"
              disabled={isMonetized}
            />
            <Label htmlFor="usesCopyrighted" className={isMonetized ? 'text-muted-foreground' : ''}>
              Uses copyrighted materials (fan art, samples, etc.)
              {isMonetized && (
                <span className="text-red-400 ml-1">(not allowed for monetized lanes)</span>
              )}
            </Label>
          </div>
          {usesCopyrighted && (
            <div className="space-y-2 ml-6">
              <Label htmlFor="copyrightNotes">Copyright Notes</Label>
              <Textarea
                id="copyrightNotes"
                value={copyrightNotes}
                onChange={(e) => setCopyrightNotes(e.target.value)}
                placeholder="Describe the copyrighted materials and their sources..."
                maxLength={500}
                rows={3}
              />
            </div>
          )}
          <div className="space-y-2">
            <Label>License</Label>
            <Select value={license} onValueChange={setLicense}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LICENSES.map((l) => (
                  <SelectItem
                    key={l.value}
                    value={l.value}
                    disabled={isMonetized && l.value === 'fan-work'}
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
        </CardContent>
      </Card>

      {/* Licensing Proof (licensed lane only) */}
      {classification === 'licensed' && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" /> Licensing Proof
            </CardTitle>
            <CardDescription>
              Provide details of your licensing agreement. Monetization is enabled after manual
              approval.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="licensorName">Licensor Name *</Label>
                <Input
                  id="licensorName"
                  value={licensorName}
                  onChange={(e) => setLicensorName(e.target.value)}
                  placeholder="e.g. Acme Studios"
                  maxLength={200}
                />
              </div>
              <div className="space-y-2">
                <Label>License Type *</Label>
                <Select value={licenseType} onValueChange={(v: any) => setLicenseType(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="non-exclusive">Non-Exclusive</SelectItem>
                    <SelectItem value="exclusive">Exclusive</SelectItem>
                    <SelectItem value="sublicense">Sublicense</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="territory">Territory *</Label>
                <Input
                  id="territory"
                  value={territory}
                  onChange={(e) => setTerritory(e.target.value)}
                  placeholder="e.g. Worldwide, US only"
                  maxLength={200}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="termEnd">Term End Date</Label>
                <Input
                  id="termEnd"
                  value={termEnd}
                  onChange={(e) => setTermEnd(e.target.value)}
                  placeholder="Perpetual or YYYY-MM-DD"
                  maxLength={50}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Approved Uses *</Label>
              <div className="flex flex-wrap gap-2">
                {['nft', 'subscription', 'merch', 'licensing', 'ads'].map((use) => (
                  <button
                    key={use}
                    type="button"
                    onClick={() => toggleApprovedUse(use)}
                    className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                      approvedUses.includes(use)
                        ? 'bg-green-600 border-green-600 text-white'
                        : 'border-muted text-muted-foreground hover:border-foreground'
                    }`}
                  >
                    {use}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="royaltySplit">
                Creator Revenue Split: {royaltySplit}% (Licensor: {100 - royaltySplit}%)
              </Label>
              <input
                id="royaltySplit"
                type="range"
                min={0}
                max={100}
                value={royaltySplit}
                onChange={(e) => setRoyaltySplit(Number(e.target.value))}
                className="w-full"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="documentUrl">License Agreement URL (optional)</Label>
              <Input
                id="documentUrl"
                value={documentUrl}
                onChange={(e) => setDocumentUrl(e.target.value)}
                placeholder="https://... (link to agreement doc)"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Submit */}
      <div className="flex justify-end gap-3 pb-8">
        {onCancel && (
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          onClick={handleSubmit}
          disabled={createMutation.isPending || complianceWarnings.length > 0}
          className="gap-2"
        >
          <UploadIcon className="h-4 w-4" />
          {createMutation.isPending ? 'Publishing...' : 'Publish Content'}
        </Button>
      </div>
    </div>
  );
}
