/**
 * CollaborativeEntityEditor — Real-time collaborative editing form.
 *
 * Wraps entity fields with field-level locking, live presence indicators,
 * debounced updates, and optimistic local state.
 */
import { useState, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Lock, History, Users } from 'lucide-react';
import { ActiveEditorsBadges } from './ActiveEditorsBadges';
import { useCollaborativeEntity, type LockedField } from '@/hooks/useCollaborativeEntity';
import type { Entity } from '@/hooks/useEntities';

const METADATA_LABELS: Record<string, string> = {
  role: 'Role / Archetype',
  appearance: 'Appearance',
  motivations: 'Motivations',
  abilities: 'Abilities',
  homePlace: 'Home / Origin',
  affiliations: 'Affiliations',
  placeType: 'Type',
  atmosphere: 'Atmosphere',
  rulesAndDangers: 'Rules / Dangers',
  inhabitants: 'Inhabitants',
  mission: 'Mission',
  ideology: 'Ideology',
  leader: 'Leader',
  rivals: 'Rivals',
  era: 'Date / Era',
  participants: 'Participants',
  location: 'Location',
  causes: 'Causes',
  outcome: 'Outcome',
  loreType: 'Type',
  article: 'Article',
  traits: 'Defining Traits',
  homeworld: 'Homeworld',
  culture: 'Culture',
  vehicleType: 'Type',
  crew: 'Crew / Operator',
  capabilities: 'Capabilities',
  currentStatus: 'Current Status',
  techType: 'Type',
  inventor: 'Inventor',
  howItWorks: 'How It Works',
  limitations: 'Limitations',
  orgType: 'Type',
  purpose: 'Purpose',
  structure: 'Structure',
  members: 'Notable Members',
  influence: 'Influence / Reach',
};

interface CollaborativeFieldProps {
  fieldPath: string;
  label: string;
  value: string;
  multiline?: boolean;
  lock: LockedField | undefined;
  currentUserId: string;
  onFocus: (fieldPath: string) => void;
  onBlur: (fieldPath: string) => void;
  onChange: (fieldPath: string, value: string) => void;
}

function CollaborativeField({
  fieldPath,
  label,
  value,
  multiline = false,
  lock,
  currentUserId,
  onFocus,
  onBlur,
  onChange,
}: CollaborativeFieldProps) {
  const isLockedByOther = lock && lock.userId !== currentUserId;
  const isLockedByMe = lock && lock.userId === currentUserId;

  const InputComponent = multiline ? Textarea : Input;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        {isLockedByOther && (
          <Badge variant="outline" className="text-[10px] py-0 flex items-center gap-1">
            <Lock className="h-2.5 w-2.5" />
            {lock.displayName}
          </Badge>
        )}
        {isLockedByMe && (
          <Badge variant="default" className="text-[10px] py-0">
            Editing
          </Badge>
        )}
      </div>
      <InputComponent
        value={value}
        onChange={(e) => onChange(fieldPath, e.target.value)}
        onFocus={() => onFocus(fieldPath)}
        onBlur={() => onBlur(fieldPath)}
        disabled={!!isLockedByOther}
        className={`text-sm ${
          isLockedByOther
            ? 'opacity-60 border-orange-300 dark:border-orange-700'
            : isLockedByMe
              ? 'border-blue-400 dark:border-blue-600 ring-1 ring-blue-400/30'
              : ''
        }`}
        rows={multiline ? 4 : undefined}
      />
    </div>
  );
}

interface CollaborativeEntityEditorProps {
  entityId: string;
  initialEntity: Entity;
  currentUserId: string;
  currentAddress?: string;
  onClose: () => void;
}

export function CollaborativeEntityEditor({
  entityId,
  initialEntity,
  currentUserId,
  currentAddress,
  onClose,
}: CollaborativeEntityEditorProps) {
  const [showHistory, setShowHistory] = useState(false);

  const {
    entity: liveEntity,
    editors,
    lockedFields,
    isConnected,
    updateField,
    lockField,
    unlockField,
    editHistory,
  } = useCollaborativeEntity({
    entityId,
    enabled: true,
    displayName: currentAddress?.slice(0, 10) || 'Anonymous',
  });

  // Use live entity if available, fallback to initial
  const entity = liveEntity || initialEntity;

  const handleFocus = useCallback(
    async (fieldPath: string) => {
      await lockField(fieldPath);
    },
    [lockField]
  );

  const handleBlur = useCallback(
    async (fieldPath: string) => {
      await unlockField(fieldPath);
    },
    [unlockField]
  );

  const handleChange = useCallback(
    (fieldPath: string, value: string) => {
      updateField(fieldPath, value);
    },
    [updateField]
  );

  const metadataEntries = Object.entries(entity.metadata || {}).filter(
    ([, v]) => v !== null && v !== undefined
  );

  return (
    <div className="space-y-4">
      {/* Header: editors + connection status */}
      <Card>
        <CardContent className="p-3">
          <div className="flex items-center justify-between gap-2">
            <ActiveEditorsBadges
              editors={editors}
              currentUserId={currentUserId}
              isConnected={isConnected}
            />
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setShowHistory((v) => !v)}
              >
                <History className="h-3 w-3 mr-1" />
                History
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onClose}>
                Exit Collab
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Edit history panel */}
      {showHistory && editHistory.length > 0 && (
        <Card>
          <CardHeader className="py-2 px-3">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <History className="h-3 w-3" />
              Recent Changes
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 max-h-48 overflow-y-auto">
            <div className="space-y-1.5">
              {editHistory.slice(0, 15).map((edit: any) => (
                <div key={edit.id} className="text-xs text-muted-foreground flex gap-2">
                  <span className="text-foreground font-medium">
                    {edit.walletAddress?.slice(0, 8) || 'user'}
                  </span>
                  <span>
                    changed <span className="font-medium">{edit.fieldPath}</span>
                  </span>
                  {edit.timestamp && (
                    <span className="ml-auto shrink-0">
                      {new Date(edit.timestamp).toLocaleTimeString()}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Core fields */}
      <Card>
        <CardHeader className="py-2 px-3">
          <CardTitle className="text-sm flex items-center gap-1">
            <Users className="h-3.5 w-3.5" />
            Collaborative Editor
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-3 pt-0">
          <CollaborativeField
            fieldPath="name"
            label="Name"
            value={String(entity.name || '')}
            lock={lockedFields['name']}
            currentUserId={currentUserId}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onChange={handleChange}
          />

          <CollaborativeField
            fieldPath="description"
            label="Description"
            value={String(entity.description || '')}
            multiline
            lock={lockedFields['description']}
            currentUserId={currentUserId}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onChange={handleChange}
          />
        </CardContent>
      </Card>

      {/* Metadata fields */}
      {metadataEntries.length > 0 && (
        <Card>
          <CardHeader className="py-2 px-3">
            <CardTitle className="text-sm">World Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-3 pt-0">
            {metadataEntries.map(([key, value]) => (
              <CollaborativeField
                key={key}
                fieldPath={key}
                label={METADATA_LABELS[key] || key}
                value={String(value || '')}
                multiline={String(value || '').length > 100}
                lock={lockedFields[key]}
                currentUserId={currentUserId}
                onFocus={handleFocus}
                onBlur={handleBlur}
                onChange={handleChange}
              />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
