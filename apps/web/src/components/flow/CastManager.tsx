/**
 * Cast Manager — Universe Character Identity Panel
 *
 * Drawer/sidebar for managing the universe's persistent cast of characters.
 * Each cast member has a name, description, and up to 10 reference images
 * used for identity conditioning during AI generation.
 *
 * Feature 3 of the Node Editor Expansion PRD.
 */

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Upload, X, Users, ImagePlus } from 'lucide-react';
import { trpcClient } from '@/utils/trpc';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

interface CastManagerProps {
  universeId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function CastManager({ universeId, isOpen, onClose }: CastManagerProps) {
  const queryClient = useQueryClient();
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);

  // Fetch cast members
  const { data: castMembers, isLoading } = useQuery({
    queryKey: ['cast', universeId],
    queryFn: () => trpcClient.cast.list.query({ universeId }),
    enabled: isOpen,
    retry: false,
  });

  // Create cast member mutation
  const createMutation = useMutation({
    mutationFn: (input: { name: string; description: string }) =>
      trpcClient.cast.create.mutate({ universeId, ...input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cast', universeId] });
      setIsCreating(false);
      setNewName('');
      setNewDescription('');
    },
  });

  // Delete cast member mutation
  const deleteMutation = useMutation({
    mutationFn: (castId: string) => trpcClient.cast.delete.mutate({ castId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cast', universeId] });
    },
  });

  // Add reference image mutation
  const addImageMutation = useMutation({
    mutationFn: (input: { castId: string; imageHash: string; imageUrl: string }) =>
      trpcClient.cast.addReferenceImage.mutate(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cast', universeId] });
      setUploadingFor(null);
    },
  });

  // Handle file upload for reference image
  const handleImageUpload = useCallback(
    async (castId: string, file: File) => {
      setUploadingFor(castId);
      try {
        const arrayBuffer = await file.arrayBuffer();
        const base64 = btoa(
          new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
        );

        const manifest = await trpcClient.storage.uploadDirect.mutate({
          data: base64,
          filename: `cast-ref-${castId}-${Date.now()}.png`,
          mimeType: file.type,
        });

        const imageUrl = manifest.uploads[0]?.url;
        const imageHash = manifest.contentHash;

        if (imageUrl && imageHash) {
          await addImageMutation.mutateAsync({ castId, imageHash, imageUrl });
        }
      } catch (err) {
        console.error('Failed to upload reference image:', err);
        alert('Failed to upload image. Please try again.');
        setUploadingFor(null);
      }
    },
    [addImageMutation]
  );

  if (!isOpen) return null;

  return (
    <div className="w-[380px] border-l border-zinc-800 bg-zinc-950 overflow-hidden flex flex-col shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-pink-400" />
          <span className="text-sm font-medium">Universe Cast</span>
          {castMembers && (
            <Badge variant="secondary" className="text-xs">
              {castMembers.length}
            </Badge>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="h-7 w-7 p-0">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
          </div>
        ) : (
          <>
            {/* Existing cast members */}
            {castMembers?.map((member: any) => (
              <Card key={member.id} className="bg-zinc-900 border-zinc-800">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span>{member.name}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                      onClick={() => {
                        if (confirm(`Delete cast member "${member.name}"?`)) {
                          deleteMutation.mutate(member.id);
                        }
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {member.description && (
                    <p className="text-xs text-muted-foreground">{member.description}</p>
                  )}

                  {/* Reference images grid */}
                  <div className="flex flex-wrap gap-1.5">
                    {member.referenceImageUrls?.map((url: string, i: number) => (
                      <div key={i} className="relative group">
                        <img
                          src={url}
                          alt={`${member.name} ref ${i + 1}`}
                          className="w-14 h-14 rounded object-cover border border-zinc-700"
                        />
                      </div>
                    ))}

                    {/* Add reference image button */}
                    {(member.referenceImageUrls?.length || 0) < 10 && (
                      <label className="w-14 h-14 rounded border-2 border-dashed border-zinc-700 hover:border-pink-500/50 cursor-pointer flex items-center justify-center transition-colors">
                        {uploadingFor === member.id ? (
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-pink-400" />
                        ) : (
                          <ImagePlus className="h-4 w-4 text-zinc-500" />
                        )}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleImageUpload(member.id, file);
                          }}
                          disabled={uploadingFor === member.id}
                        />
                      </label>
                    )}
                  </div>

                  <p className="text-[10px] text-muted-foreground">
                    {member.referenceImageUrls?.length || 0}/10 reference images
                  </p>
                </CardContent>
              </Card>
            ))}

            {/* Create new cast member form */}
            {isCreating ? (
              <Card className="bg-zinc-900 border-pink-500/30">
                <CardContent className="pt-4 space-y-3">
                  <div>
                    <Label className="text-xs">Character Name</Label>
                    <Input
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="e.g. Captain Nova"
                      className="mt-1 h-8 text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Description</Label>
                    <textarea
                      value={newDescription}
                      onChange={(e) => setNewDescription(e.target.value)}
                      placeholder="Physical traits, outfit, personality..."
                      rows={3}
                      className="mt-1 w-full text-sm rounded-md border border-input bg-background px-3 py-2 resize-none"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1 text-xs"
                      disabled={!newName.trim() || createMutation.isPending}
                      onClick={() =>
                        createMutation.mutate({
                          name: newName.trim(),
                          description: newDescription.trim(),
                        })
                      }
                    >
                      {createMutation.isPending ? 'Creating...' : 'Create Character'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs"
                      onClick={() => {
                        setIsCreating(false);
                        setNewName('');
                        setNewDescription('');
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Button
                variant="outline"
                className="w-full text-xs border-dashed"
                onClick={() => setIsCreating(true)}
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Add Cast Member
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
