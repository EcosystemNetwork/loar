/**
 * CreatePollDialog — Modal form for creating a new poll in a universe.
 *
 * Supports configurable poll types, dynamic option list (2-10),
 * duration presets, token-weighted voting, and multiple selection toggles.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { X, Plus, Loader2, Trash2 } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { trpc, queryClient } from '@/utils/trpc';
import { toast } from 'sonner';

interface CreatePollDialogProps {
  universeAddress: string;
  isOpen: boolean;
  onClose: () => void;
  onCreated?: () => void;
}

const POLL_TYPES = [
  { value: 'story_direction', label: 'Story Direction' },
  { value: 'character_fate', label: 'Character Fate' },
  { value: 'world_event', label: 'World Event' },
  { value: 'general', label: 'General' },
  { value: 'canon_submission', label: 'Canon Submission' },
];

const DURATIONS = [
  { value: '1d', label: '1 Day' },
  { value: '3d', label: '3 Days' },
  { value: '1w', label: '1 Week' },
  { value: '2w', label: '2 Weeks' },
];

export function CreatePollDialog({
  universeAddress,
  isOpen,
  onClose,
  onCreated,
}: CreatePollDialogProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<
    'general' | 'story_direction' | 'character_fate' | 'world_event' | 'canon_submission'
  >('story_direction');
  const [options, setOptions] = useState(['', '']);
  const [duration, setDuration] = useState('3d');
  const [tokenWeighted, setTokenWeighted] = useState(false);
  const [allowMultiple, setAllowMultiple] = useState(false);

  const createMutation = useMutation(
    trpc.polls.create.mutationOptions({
      onSuccess: () => {
        toast.success('Poll created!');
        queryClient.invalidateQueries({ queryKey: [['polls']] });
        resetForm();
        onCreated?.();
        onClose();
      },
      onError: (err: any) => {
        toast.error(err.message || 'Failed to create poll');
      },
    })
  );

  function resetForm() {
    setTitle('');
    setDescription('');
    setType('story_direction');
    setOptions(['', '']);
    setDuration('3d');
    setTokenWeighted(false);
    setAllowMultiple(false);
  }

  function addOption() {
    if (options.length >= 10) return;
    setOptions([...options, '']);
  }

  function removeOption(index: number) {
    if (options.length <= 2) return;
    setOptions(options.filter((_, i) => i !== index));
  }

  function updateOption(index: number, value: string) {
    const updated = [...options];
    updated[index] = value;
    setOptions(updated);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const trimmedTitle = title.trim();
    const trimmedOptions = options.map((o) => o.trim()).filter(Boolean);

    if (!trimmedTitle) {
      toast.error('Title is required');
      return;
    }
    if (trimmedOptions.length < 2) {
      toast.error('At least 2 options are required');
      return;
    }

    // Convert duration shorthand to ISO datetime
    const durationMs: Record<string, number> = {
      '1h': 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
      '3d': 3 * 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
    };
    const endsAt = new Date(Date.now() + (durationMs[duration] || durationMs['3d'])).toISOString();

    createMutation.mutate({
      universeAddress,
      title: trimmedTitle,
      description: description.trim() || undefined,
      type,
      options: trimmedOptions,
      endsAt,
      tokenWeighted,
      allowMultiple,
    });
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border border-border p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-foreground">Create Poll</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-foreground transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="poll-title" className="text-foreground/80">
              Title
            </Label>
            <Input
              id="poll-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What should happen next?"
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              maxLength={200}
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="poll-description" className="text-foreground/80">
              Description <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Textarea
              id="poll-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Provide context for voters..."
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground min-h-[80px]"
              maxLength={1000}
            />
          </div>

          {/* Type */}
          <div className="space-y-2">
            <Label className="text-foreground/80">Poll Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
              <SelectTrigger className="bg-muted border-border text-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-muted border-border">
                {POLL_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value} className="text-foreground">
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Options */}
          <div className="space-y-2">
            <Label className="text-foreground/80">Options</Label>
            <div className="space-y-2">
              {options.map((option, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    value={option}
                    onChange={(e) => updateOption(index, e.target.value)}
                    placeholder={`Option ${index + 1}`}
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground flex-1"
                    maxLength={200}
                  />
                  {options.length > 2 && (
                    <button
                      type="button"
                      onClick={() => removeOption(index)}
                      className="text-muted-foreground hover:text-red-400 transition-colors p-1"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {options.length < 10 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addOption}
                className="mt-2 border-zinc-700 text-zinc-400 hover:text-foreground hover:border-zinc-600"
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                Add Option
              </Button>
            )}
            <p className="text-xs text-muted-foreground">{options.length}/10 options</p>
          </div>

          {/* Duration */}
          <div className="space-y-2">
            <Label className="text-foreground/80">Duration</Label>
            <Select value={duration} onValueChange={setDuration}>
              <SelectTrigger className="bg-muted border-border text-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-muted border-border">
                {DURATIONS.map((d) => (
                  <SelectItem key={d.value} value={d.value} className="text-foreground">
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Toggles */}
          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={tokenWeighted}
                onChange={(e) => setTokenWeighted(e.target.checked)}
                className="w-4 h-4 rounded border-muted-foreground/30 bg-muted text-violet-500 focus:ring-violet-500 focus:ring-offset-0"
              />
              <div>
                <span className="text-sm text-foreground">Token-weighted voting</span>
                <p className="text-xs text-muted-foreground">
                  Vote power scales with token holdings
                </p>
              </div>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={allowMultiple}
                onChange={(e) => setAllowMultiple(e.target.checked)}
                className="w-4 h-4 rounded border-muted-foreground/30 bg-muted text-violet-500 focus:ring-violet-500 focus:ring-offset-0"
              />
              <div>
                <span className="text-sm text-foreground">Allow multiple selections</span>
                <p className="text-xs text-muted-foreground">
                  Voters can pick more than one option
                </p>
              </div>
            </label>
          </div>

          {/* Submit */}
          <div className="flex items-center gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="flex-1 border-zinc-700 text-zinc-400 hover:text-foreground"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createMutation.isPending}
              className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Create Poll
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
