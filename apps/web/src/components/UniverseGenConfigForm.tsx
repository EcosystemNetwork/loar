/**
 * Universe Generation Config Form
 *
 * Admin form for configuring AI generation parameters within a universe.
 * Covers model selection, style constraints, lore rules, access control, and revenue splits.
 */
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, X, Loader2, Save, Sparkles, Lock, Palette, BookOpen, Coins } from 'lucide-react';
import { useUniverseGenConfig, useUpsertGenConfig } from '@/hooks/useUniverseGenConfig';

interface UniverseGenConfigFormProps {
  universeAddress: string;
}

export function UniverseGenConfigForm({ universeAddress }: UniverseGenConfigFormProps) {
  const { data: existingConfig, isLoading } = useUniverseGenConfig(universeAddress);
  const upsertConfig = useUpsertGenConfig();

  // Form state
  const [styleGuide, setStyleGuide] = useState('');
  const [negativePrompts, setNegativePrompts] = useState<string[]>([]);
  const [newNegPrompt, setNewNegPrompt] = useState('');
  const [defaultPromptPrefix, setDefaultPromptPrefix] = useState('');
  const [defaultPromptSuffix, setDefaultPromptSuffix] = useState('');
  const [loreRules, setLoreRules] = useState<Array<{ rule: string; type: 'DO' | 'DONT' }>>([]);
  const [newLoreRule, setNewLoreRule] = useState('');
  const [newLoreType, setNewLoreType] = useState<'DO' | 'DONT'>('DO');
  const [creditMultiplier, setCreditMultiplier] = useState(1.0);
  const [minCreditsPerGen, setMinCreditsPerGen] = useState(0);
  const [accessType, setAccessType] = useState<'PUBLIC' | 'HOLDERS' | 'WHITELISTED'>('PUBLIC');
  const [whitelistedAddresses, setWhitelistedAddresses] = useState<string[]>([]);
  const [newWhitelistAddr, setNewWhitelistAddr] = useState('');
  const [requiredTokenBalance, setRequiredTokenBalance] = useState(0);
  const [universeCreatorSplitBps, setUniverseCreatorSplitBps] = useState(2000);

  // Load existing config
  useEffect(() => {
    if (existingConfig) {
      setStyleGuide(existingConfig.styleGuide || '');
      setNegativePrompts(existingConfig.negativePrompts || []);
      setDefaultPromptPrefix(existingConfig.defaultPromptPrefix || '');
      setDefaultPromptSuffix(existingConfig.defaultPromptSuffix || '');
      setLoreRules(existingConfig.loreRules || []);
      setCreditMultiplier(existingConfig.creditMultiplier || 1.0);
      setMinCreditsPerGen(existingConfig.minCreditsPerGen || 0);
      setAccessType(existingConfig.accessType || 'PUBLIC');
      setWhitelistedAddresses(existingConfig.whitelistedAddresses || []);
      setRequiredTokenBalance(existingConfig.requiredTokenBalance || 0);
      setUniverseCreatorSplitBps(existingConfig.universeCreatorSplitBps ?? 2000);
    }
  }, [existingConfig]);

  const handleSave = async () => {
    await upsertConfig.mutateAsync({
      universeAddress,
      styleGuide,
      negativePrompts,
      defaultPromptPrefix,
      defaultPromptSuffix,
      loreRules,
      creditMultiplier,
      minCreditsPerGen,
      accessType,
      whitelistedAddresses,
      requiredTokenBalance,
      universeCreatorSplitBps,
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const generatorBps = 10000 - universeCreatorSplitBps - 1000;

  return (
    <div className="space-y-6">
      {/* Style Guide */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Palette className="h-4 w-4" />
            Style Constraints
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Style Guide</Label>
            <Textarea
              value={styleGuide}
              onChange={(e) => setStyleGuide(e.target.value)}
              placeholder="Describe the visual style for this universe (e.g., 'cyberpunk noir with neon highlights, gritty urban environments, rain-soaked streets')"
              rows={4}
              maxLength={5000}
              className="mt-1"
            />
            <p className="text-xs text-muted-foreground mt-1">{styleGuide.length}/5000</p>
          </div>

          <div>
            <Label>Prompt Prefix (auto-prepended)</Label>
            <Input
              value={defaultPromptPrefix}
              onChange={(e) => setDefaultPromptPrefix(e.target.value)}
              placeholder="e.g., 'In the style of Neo-Tokyo 2089:'"
              maxLength={500}
              className="mt-1"
            />
          </div>

          <div>
            <Label>Prompt Suffix (auto-appended)</Label>
            <Input
              value={defaultPromptSuffix}
              onChange={(e) => setDefaultPromptSuffix(e.target.value)}
              placeholder="e.g., 'cinematic lighting, volumetric fog'"
              maxLength={500}
              className="mt-1"
            />
          </div>

          <div>
            <Label>Negative Prompts (things to avoid)</Label>
            <div className="flex gap-2 mt-1">
              <Input
                value={newNegPrompt}
                onChange={(e) => setNewNegPrompt(e.target.value)}
                placeholder="e.g., 'bright colors, cartoon style'"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newNegPrompt.trim()) {
                    setNegativePrompts([...negativePrompts, newNegPrompt.trim()]);
                    setNewNegPrompt('');
                  }
                }}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (newNegPrompt.trim()) {
                    setNegativePrompts([...negativePrompts, newNegPrompt.trim()]);
                    setNewNegPrompt('');
                  }
                }}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-1 mt-2">
              {negativePrompts.map((prompt, i) => (
                <Badge key={i} variant="secondary" className="text-xs">
                  {prompt}
                  <button
                    onClick={() => setNegativePrompts(negativePrompts.filter((_, j) => j !== i))}
                    className="ml-1"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lore Rules */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BookOpen className="h-4 w-4" />
            Lore Rules
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Select value={newLoreType} onValueChange={(v) => setNewLoreType(v as 'DO' | 'DONT')}>
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="DO">DO</SelectItem>
                <SelectItem value="DONT">DON'T</SelectItem>
              </SelectContent>
            </Select>
            <Input
              value={newLoreRule}
              onChange={(e) => setNewLoreRule(e.target.value)}
              placeholder="e.g., 'Include holographic advertisements in urban scenes'"
              className="flex-1"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newLoreRule.trim()) {
                  setLoreRules([...loreRules, { rule: newLoreRule.trim(), type: newLoreType }]);
                  setNewLoreRule('');
                }
              }}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (newLoreRule.trim()) {
                  setLoreRules([...loreRules, { rule: newLoreRule.trim(), type: newLoreType }]);
                  setNewLoreRule('');
                }
              }}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="space-y-1">
            {loreRules.map((lr, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <Badge
                  variant={lr.type === 'DO' ? 'default' : 'destructive'}
                  className="text-xs w-14 justify-center"
                >
                  {lr.type === 'DO' ? 'DO' : "DON'T"}
                </Badge>
                <span className="flex-1">{lr.rule}</span>
                <button onClick={() => setLoreRules(loreRules.filter((_, j) => j !== i))}>
                  <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                </button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Access Control */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Lock className="h-4 w-4" />
            Access Control
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Who can generate content in this universe?</Label>
            <Select value={accessType} onValueChange={(v) => setAccessType(v as any)}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PUBLIC">Public (anyone)</SelectItem>
                <SelectItem value="HOLDERS">Token Holders</SelectItem>
                <SelectItem value="WHITELISTED">Whitelisted Addresses</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {accessType === 'HOLDERS' && (
            <div>
              <Label>Required Token Balance</Label>
              <Input
                type="number"
                value={requiredTokenBalance}
                onChange={(e) => setRequiredTokenBalance(Number(e.target.value))}
                min={0}
                className="mt-1"
              />
            </div>
          )}

          {accessType === 'WHITELISTED' && (
            <div>
              <Label>Whitelisted Addresses</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  value={newWhitelistAddr}
                  onChange={(e) => setNewWhitelistAddr(e.target.value)}
                  placeholder="0x..."
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newWhitelistAddr.trim()) {
                      setWhitelistedAddresses([...whitelistedAddresses, newWhitelistAddr.trim()]);
                      setNewWhitelistAddr('');
                    }
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (newWhitelistAddr.trim()) {
                      setWhitelistedAddresses([...whitelistedAddresses, newWhitelistAddr.trim()]);
                      setNewWhitelistAddr('');
                    }
                  }}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                {whitelistedAddresses.map((addr, i) => (
                  <Badge key={i} variant="outline" className="text-xs font-mono">
                    {addr.slice(0, 6)}...{addr.slice(-4)}
                    <button
                      onClick={() =>
                        setWhitelistedAddresses(whitelistedAddresses.filter((_, j) => j !== i))
                      }
                      className="ml-1"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Credit Pricing & Revenue */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Coins className="h-4 w-4" />
            Credits & Revenue
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Credit Multiplier ({creditMultiplier}x)</Label>
            <p className="text-xs text-muted-foreground mb-2">
              How much to charge generators relative to base model cost
            </p>
            <Slider
              value={[creditMultiplier]}
              onValueChange={([v]) => setCreditMultiplier(v)}
              min={0.5}
              max={5.0}
              step={0.1}
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>0.5x (discount)</span>
              <span>1.0x (base)</span>
              <span>5.0x (premium)</span>
            </div>
          </div>

          <div>
            <Label>Minimum Credits Per Generation</Label>
            <Input
              type="number"
              value={minCreditsPerGen}
              onChange={(e) => setMinCreditsPerGen(Number(e.target.value))}
              min={0}
              className="mt-1"
            />
          </div>

          <div>
            <Label>Your Revenue Split ({(universeCreatorSplitBps / 100).toFixed(0)}%)</Label>
            <p className="text-xs text-muted-foreground mb-2">
              Your cut when content created in your universe is sold/licensed
            </p>
            <Slider
              value={[universeCreatorSplitBps]}
              onValueChange={([v]) => setUniverseCreatorSplitBps(v)}
              min={0}
              max={4000}
              step={100}
            />
            <div className="flex justify-between text-xs mt-2">
              <span className="text-cyan-600">
                You: {(universeCreatorSplitBps / 100).toFixed(0)}%
              </span>
              <span className="text-green-600">Generator: {(generatorBps / 100).toFixed(0)}%</span>
              <span className="text-muted-foreground">Platform: 10%</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Save */}
      <Button onClick={handleSave} disabled={upsertConfig.isPending} className="w-full" size="lg">
        {upsertConfig.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
        ) : (
          <Save className="h-4 w-4 mr-2" />
        )}
        Save Configuration
      </Button>
    </div>
  );
}
