/**
 * Cinematic Universe Creation Route
 *
 * Two-step wizard for deploying a new narrative universe on-chain:
 * 1. Create the Universe smart contract (name, image, description).
 * 2. Deploy a governance token and liquidity pool for the universe.
 * Includes AI-powered cover image generation via the routed image catalog.
 */

import { createFileRoute, Link as RouterLink, useNavigate, redirect } from '@tanstack/react-router';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useBalance, useChainId, useWaitForTransactionReceipt, useSwitchChain } from 'wagmi';
import { useWalletAuth, awaitSessionValidation } from '@/lib/wallet-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { trpcClient } from '@/utils/trpc';
import { WalletConnectButton } from '@/components/wallet-connect-button';
import {
  Rocket,
  CheckCircle2,
  Loader2,
  ExternalLink,
  AlertCircle,
  Sparkles,
  Image as ImageIcon,
  ArrowLeft,
  Sliders,
  Info,
  Upload,
  Link,
  X,
  Crop,
} from 'lucide-react';
import { ImageCropper } from '@/components/ImageCropper';
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
import { useUniverseManager, useDefaultDeploymentConfig } from '@/hooks/useUniverseManager';
import { SafeSetup } from '@/components/SafeSetup';
import { decodeEventLog } from 'viem';
import { universeManagerAbi } from '@loar/abis/generated';
import {
  isSupportedChain,
  getExplorerAddressUrl,
  CHAIN_NAMES,
  SUPPORTED_CHAIN_IDS,
} from '@/configs/chains';
import { Price, usePriceText } from '@/components/Price';
import { ModelSelector } from '@/components/ModelSelector';

export const Route = createFileRoute('/cinematicUniverseCreate')({
  // WEB-6: block entry until /auth/me confirms the session. The component
  // fires an on-chain universe deploy, which costs gas even if the server
  // side later rejects the subsequent tRPC call.
  beforeLoad: async ({ context }) => {
    if (!context.hasSession()) {
      throw redirect({ to: '/login', search: { redirect: '/cinematicUniverseCreate' } });
    }
    await awaitSessionValidation();
  },
  component: CinematicUniverseCreate,
});

// Deployment steps
enum DeploymentStep {
  IDLE = 'idle',
  CREATING_UNIVERSE = 'creating_universe',
  UNIVERSE_CREATED = 'universe_created',
  DEPLOYING_TOKEN = 'deploying_token',
  TOKEN_DEPLOYED = 'token_deployed',
  REGISTERING = 'registering',
  COMPLETED = 'completed',
}

function CinematicUniverseCreate() {
  const { address, isConnected, isAuthenticated, isAuthenticating } = useWalletAuth();
  const navigate = useNavigate();

  const chainId = useChainId();
  const { data: balance } = useBalance({ address });
  const { switchChain } = useSwitchChain();
  const priceText = usePriceText();

  // Form state
  const [universeName, setUniverseName] = useState('');
  const [tokenSymbol, setTokenSymbol] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [description, setDescription] = useState('');
  const [metadata, setMetadata] = useState(''); // Additional token metadata
  const [context, setContext] = useState(''); // Universe context/lore

  // Universe mode: 'fun' = free creative playground, 'monetize' = token + LP
  const [universeMode, setUniverseMode] = useState<'fun' | 'monetize' | null>(null);

  // Starting price — slider controls the tick, which sets initial token price
  // tick range: -300000 (very cheap, ~0.01 ETH MC) to -200000 (expensive, ~200 ETH MC)
  // Rounded to tickSpacing of 200
  const TICK_MIN = -300000;
  const TICK_MAX = -200000;
  const TICK_DEFAULT = -230200; // ~10 ETH market cap
  const TOKEN_SUPPLY = 1_000_000_000; // 1B
  const [startingTick, setStartingTick] = useState(TICK_DEFAULT);

  // Derived price calculations (update in real-time as slider moves)
  const pricePerToken = Math.pow(1.0001, startingTick);
  const marketCapEth = pricePerToken * TOKEN_SUPPLY;
  const tokensPerEth = 1 / pricePerToken;

  // Quick preset buttons
  const PRICE_PRESETS = [
    { label: '0.1 ETH', tick: -276400 },
    { label: '1 ETH', tick: -253200 },
    { label: '10 ETH', tick: -230200 },
    { label: '50 ETH', tick: -214200 },
    { label: '100 ETH', tick: -207200 },
  ] as const;

  // Format helpers
  const formatMarketCap = (mc: number) => {
    if (mc < 0.01) return `${(mc * 1000).toFixed(2)} mETH`;
    if (mc < 1) return `${mc.toFixed(3)} ETH`;
    if (mc < 1000) return `${mc.toFixed(2)} ETH`;
    return `${(mc / 1000).toFixed(1)}k ETH`;
  };

  const formatTokenAmount = (amount: number) => {
    if (amount >= 1e12) return `${(amount / 1e12).toFixed(1)}T`;
    if (amount >= 1e9) return `${(amount / 1e9).toFixed(1)}B`;
    if (amount >= 1e6) return `${(amount / 1e6).toFixed(1)}M`;
    if (amount >= 1e3) return `${(amount / 1e3).toFixed(1)}K`;
    return amount.toFixed(0);
  };

  // Token allocation state (basis points, must sum to 10000)
  const [curveBps, setCurveBps] = useState(8000); // 80% Bonding Curve
  const [creatorBps, setCreatorBps] = useState(1000); // 10% Creator
  const [treasuryBps, setTreasuryBps] = useState(500); // 5% Treasury
  const [communityBps, setCommunityBps] = useState(500); // 5% Community
  const [showAdvancedTokenomics, setShowAdvancedTokenomics] = useState(false);

  // Allocation helpers
  const allocationTotal = curveBps + creatorBps + treasuryBps + communityBps;
  const allocationValid =
    allocationTotal === 10000 && curveBps >= 5000 && treasuryBps >= 200 && creatorBps <= 4000;

  const handleAllocationChange = (
    field: 'lp' | 'creator' | 'treasury' | 'community',
    value: number
  ) => {
    // Build the proposed state with the new value applied
    const proposed = {
      lp: field === 'lp' ? value : curveBps,
      creator: field === 'creator' ? value : creatorBps,
      treasury: field === 'treasury' ? value : treasuryBps,
      community: field === 'community' ? value : communityBps,
    };

    // Auto-balance: absorb the difference into a counterpart field
    const balanceField = field === 'community' ? 'lp' : 'community';
    const remainder =
      10000 - proposed.lp - proposed.creator - proposed.treasury - proposed.community;
    const adjusted = proposed[balanceField] + remainder;
    if (adjusted >= 0 && adjusted <= 10000) {
      proposed[balanceField] = adjusted;
    }

    setCurveBps(proposed.lp);
    setCreatorBps(proposed.creator);
    setTreasuryBps(proposed.treasury);
    setCommunityBps(proposed.community);
  };

  // Deployment state
  const [deploymentStep, setDeploymentStep] = useState<DeploymentStep>(DeploymentStep.IDLE);
  const [universeId, setUniverseId] = useState<bigint | null>(null);
  const [universeAddress, setUniverseAddress] = useState<`0x${string}` | null>(null);
  const [tokenAddress, setTokenAddress] = useState<`0x${string}` | null>(null);
  const [governorAddress, setGovernorAddress] = useState<`0x${string}` | null>(null);

  // Multi-sig Safe state
  const [safeAddress, setSafeAddress] = useState<`0x${string}` | null>(null);

  // Cover image state
  const [isGeneratingCover, setIsGeneratingCover] = useState(false);
  const [isUploadingCover, setIsUploadingCover] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [portraitPreview, setPortraitPreview] = useState<string | null>(null);
  const [portraitImageUrl, setPortraitImageUrl] = useState('');
  // '' = auto routing (server picks model via image.generate routing engine).
  // VITE_DEFAULT_IMAGE_MODEL still overrides if set, so ops can pin a model.
  const [coverModel, setCoverModel] = useState<string>(
    import.meta.env.VITE_DEFAULT_IMAGE_MODEL || ''
  );
  const [coverInputMode, setCoverInputMode] = useState<'upload' | 'url' | 'generate'>('upload');
  const coverFileRef = useRef<HTMLInputElement>(null);

  // Cropper state — shown after file is picked, before upload
  // cropPhase: 'landscape' = 16:9 crop first, 'portrait' = 3:4 crop second
  const [cropperSrc, setCropperSrc] = useState<string | null>(null);
  const [cropperFile, setCropperFile] = useState<File | null>(null);
  const [cropPhase, setCropPhase] = useState<'landscape' | 'portrait'>('landscape');
  // Keep original source so we can re-crop for portrait after landscape is done
  const [originalSrc, setOriginalSrc] = useState<string | null>(null);

  // Hooks
  const {
    createUniverse,
    createUniverseWithToken,
    deployUniverseToken,
    mintFee,
    mintFeeLoading,
    hash,
    isPending,
    error,
  } = useUniverseManager();
  const defaultConfig = useDefaultDeploymentConfig();
  const {
    isSuccess: txSuccess,
    isError: txReverted,
    isLoading: isConfirming,
    data: txReceipt,
  } = useWaitForTransactionReceipt({ hash });

  // Track which tx hash each effect has already processed to prevent double-firing
  const processedUniverseHash = useRef<string | null>(null);

  // Auto-switch to first supported chain only when on a completely unsupported network
  useEffect(() => {
    if (isConnected && !isSupportedChain(chainId)) {
      switchChain({ chainId: SUPPORTED_CHAIN_IDS[0] });
    }
  }, [isConnected, chainId, switchChain]);

  const handleSwitchNetwork = () => {
    switchChain({ chainId: SUPPORTED_CHAIN_IDS[0] });
  };

  const handleChainSelect = (selectedChainId: string) => {
    const id = Number(selectedChainId);
    if (id !== chainId) {
      switchChain({ chainId: id });
    }
  };

  // Cover image generation — routes through image.generate so the same model
  // catalog, auto-routing, and credit accounting used everywhere else apply
  // here too. coverModel === '' falls back to auto routing.
  const generateCoverMutation = useMutation({
    mutationFn: async () => {
      const prompt = `Epic cinematic universe cover art for "${universeName}". ${description}. Professional movie poster style, high quality, dramatic lighting`;

      const result = await trpcClient.image.generate.mutate({
        prompt,
        task: 'text_to_image',
        imageSize: 'landscape_16_9',
        numImages: 1,
        routingMode: coverModel ? 'manual' : 'auto',
        ...(coverModel ? { selectedModelId: coverModel } : {}),
      });

      return result;
    },
    onSuccess: async (data) => {
      const tempUrl = data?.status === 'completed' ? data.imageUrls?.[0] : undefined;
      if (!tempUrl) {
        toast.error('Image was generated but no URL was returned. Please try again.');
        return;
      }

      setCoverPreview(tempUrl);

      // Pin the temp fal.ai URL to Pinata for permanent storage
      try {
        const imgRes = await fetch(tempUrl);
        if (!imgRes.ok) throw new Error(`Failed to fetch generated image`);
        const blob = await imgRes.blob();
        const pinnedUrl = await uploadBlob(blob, 'ai-cover.jpg');
        if (pinnedUrl) {
          setImageUrl(pinnedUrl);
          setCoverPreview(pinnedUrl);
        } else {
          // Upload failed — fall back to temp URL (will expire in ~24h)
          setImageUrl(tempUrl);
          toast.warning('Could not pin image to permanent storage. Using temporary URL.');
        }
      } catch {
        // Pinata upload failed — use temp URL as fallback
        setImageUrl(tempUrl);
        toast.warning('Could not pin image to permanent storage. Using temporary URL.');
      }
    },
    onError: (error: any) => {
      const msg = error?.message || 'Unknown error';
      if (msg.includes('Insufficient credits') || msg.includes('PRECONDITION_FAILED')) {
        toast.error(
          'Not enough credits to generate a cover image. Purchase credits in the Credits page.'
        );
      } else {
        toast.error(`Failed to generate cover: ${msg}`);
      }
    },
  });

  const handleGenerateCover = async () => {
    if (!universeName) {
      toast.warning('Please enter a universe name first');
      return;
    }
    setIsGeneratingCover(true);
    try {
      await generateCoverMutation.mutateAsync();
    } finally {
      setIsGeneratingCover(false);
    }
  };

  // Step 1: user picks a file → validate and open landscape cropper first
  const handleCoverFilePick = useCallback((file: File) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif'];
    if (!allowedTypes.includes(file.type)) {
      toast.error('Please upload an image file (JPEG, PNG, GIF, WebP, or AVIF)');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Image must be under 10MB');
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setCropperFile(file);
    setCropperSrc(objectUrl);
    setOriginalSrc(objectUrl);
    setCropPhase('landscape');
  }, []);

  // Shared upload helper — uploads a blob and returns the URL
  const uploadBlob = useCallback(async (blob: Blob, filename: string): Promise<string | null> => {
    const file = new File([blob], filename, { type: 'image/jpeg' });

    setIsUploadingCover(true);
    setUploadProgress(0);

    try {
      const serverUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';

      // Pre-flight: verify session cookie is valid before uploading
      const meRes = await fetch(`${serverUrl}/auth/me`, { credentials: 'include' });
      if (!meRes.ok || !(await meRes.json()).authenticated) {
        toast.error('Session expired. Please sign in again.');
        return null;
      }

      const formData = new FormData();
      formData.append('file', file);

      const result = await new Promise<{ manifest: { uploads: { url: string }[] } }>(
        (resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
          });
          xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                resolve(JSON.parse(xhr.responseText));
              } catch {
                reject(new Error('Invalid response'));
              }
            } else {
              try {
                const err = JSON.parse(xhr.responseText);
                reject(new Error(err.message || `Upload failed (${xhr.status})`));
              } catch {
                reject(new Error(`Upload failed (${xhr.status})`));
              }
            }
          });
          xhr.addEventListener('error', () => reject(new Error('Network error')));
          xhr.addEventListener('timeout', () =>
            reject(new Error('Upload timed out — please try again'))
          );
          xhr.timeout = 30000; // 30s timeout
          xhr.open('POST', `${serverUrl}/api/upload`);
          xhr.withCredentials = true;
          xhr.send(formData);
        }
      );

      return result.manifest.uploads[0]?.url || null;
    } catch (err) {
      toast.error(`Upload failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      return null;
    } finally {
      setIsUploadingCover(false);
      setUploadProgress(0);
    }
  }, []);

  // Step 2: user confirms landscape crop → upload, then open portrait cropper
  const handleLandscapeCrop = useCallback(
    async (blob: Blob) => {
      setCropperSrc(null);

      const uploadedUrl = await uploadBlob(blob, 'cover.jpg');
      if (!uploadedUrl) {
        // Upload failed — don't proceed to portrait phase
        setCropperFile(null);
        return;
      }

      setImageUrl(uploadedUrl);
      setCoverPreview(URL.createObjectURL(blob));

      // Now open the portrait cropper on the same original image
      if (originalSrc) {
        setCropPhase('portrait');
        setCropperSrc(originalSrc);
      }
    },
    [uploadBlob, originalSrc]
  );

  // Step 3: user confirms portrait crop → upload portrait version
  const handlePortraitCrop = useCallback(
    async (blob: Blob) => {
      setCropperSrc(null);
      setCropperFile(null);

      const uploadedUrl = await uploadBlob(blob, 'cover-portrait.jpg');
      if (uploadedUrl) {
        setPortraitImageUrl(uploadedUrl);
        setPortraitPreview(URL.createObjectURL(blob));
      }
    },
    [uploadBlob]
  );

  // Dispatch to the right handler based on crop phase
  const handleCoverCrop = useCallback(
    (blob: Blob) => {
      if (cropPhase === 'landscape') {
        handleLandscapeCrop(blob);
      } else {
        handlePortraitCrop(blob);
      }
    },
    [cropPhase, handleLandscapeCrop, handlePortraitCrop]
  );

  const handleCropCancel = useCallback(() => {
    if (cropPhase === 'portrait') {
      // Skip portrait crop — landscape was already uploaded, just close
      setCropperSrc(null);
      setCropperFile(null);
      return;
    }
    setCropperSrc(null);
    setCropperFile(null);
    if (originalSrc) {
      URL.revokeObjectURL(originalSrc);
      setOriginalSrc(null);
    }
  }, [cropPhase, originalSrc]);

  const handleClearCover = () => {
    setImageUrl('');
    setPortraitImageUrl('');
    setCoverPreview(null);
    setPortraitPreview(null);
    setCropperSrc(null);
    setCropPhase('landscape');
    if (originalSrc) {
      URL.revokeObjectURL(originalSrc);
      setOriginalSrc(null);
    }
    setCropperFile(null);
    if (coverFileRef.current) coverFileRef.current.value = '';
  };

  // Handle on-chain tx revert — reset deployment state so user can retry
  useEffect(() => {
    if (!txReverted || !hash) return;
    if (deploymentStep === DeploymentStep.CREATING_UNIVERSE) {
      toast.error('Transaction reverted on-chain. Please check your wallet and try again.');
      setDeploymentStep(DeploymentStep.IDLE);
      processedUniverseHash.current = null;
    }
  }, [txReverted, hash, deploymentStep]);

  // Watch for universe creation transaction success (fun mode OR atomic monetize mode)
  useEffect(() => {
    if (!txSuccess || !txReceipt || !hash) return;
    if (deploymentStep !== DeploymentStep.CREATING_UNIVERSE) return;
    if (processedUniverseHash.current === hash) return; // Already processed this tx
    processedUniverseHash.current = hash;

    // Parse events from receipt — in atomic mode, both UniverseCreated + TokenCreated are here
    let parsedUniverseAddress: `0x${string}` | null = null;
    let parsedUniverseId: bigint | null = null;
    let parsedTokenAddress: `0x${string}` | null = null;
    let parsedGovernorAddress: `0x${string}` | null = null;

    for (const log of txReceipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: universeManagerAbi,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === 'UniverseCreated') {
          const args = decoded.args as Record<string, unknown>;
          if (typeof args.universe === 'string') {
            parsedUniverseAddress = args.universe as `0x${string}`;
          }
        }
        if (decoded.eventName === 'UniverseLpSeed') {
          const args = decoded.args as Record<string, unknown>;
          if (typeof args.universeId === 'bigint') {
            parsedUniverseId = args.universeId;
          }
        }
        if (decoded.eventName === 'TokenCreated') {
          const args = decoded.args as Record<string, unknown>;
          if (typeof args.tokenAddress === 'string') {
            parsedTokenAddress = args.tokenAddress as `0x${string}`;
          }
          if (typeof args.governor === 'string') {
            parsedGovernorAddress = args.governor as `0x${string}`;
          }
        }
      } catch {
        // Not a UniverseManager event, skip
      }
    }

    if (parsedUniverseAddress) setUniverseAddress(parsedUniverseAddress);
    if (parsedUniverseId !== null) setUniverseId(parsedUniverseId);
    if (parsedTokenAddress) setTokenAddress(parsedTokenAddress);
    if (parsedGovernorAddress) setGovernorAddress(parsedGovernorAddress);

    // Register universe in Firestore before showing completed
    if (address && parsedUniverseAddress) {
      setDeploymentStep(DeploymentStep.REGISTERING);

      (async () => {
        const MAX_RETRIES = 3;
        let lastError: unknown;

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          try {
            const creator = safeAddress ?? address;
            // Each attempt needs a fresh nonce + signature (nonce is consumed on the server)
            const { nonce } = await trpcClient.universes.getNonce.query();
            const message = `Register universe ${parsedUniverseAddress} created by ${creator} with nonce ${nonce} at ${Date.now()}`;
            // Circle DCW — signing is handled server-side. Use a simple hash-based proof.
            const signature = `circle-auth:${address}:${nonce}`;

            await trpcClient.universes.create.mutate({
              address: parsedUniverseAddress,
              creator,
              name: universeName,
              tokenAddress: parsedTokenAddress ?? '0x0000000000000000000000000000000000000000',
              governanceAddress:
                parsedGovernorAddress ?? '0x0000000000000000000000000000000000000000',
              imageUrl: imageUrl,
              portraitImageUrl: portraitImageUrl || undefined,
              description: description,
              onChainUniverseId: parsedUniverseId?.toString(),
              mintTxHash: hash,
              chainId,
              signature,
              message,
              nonce,
              universeType: universeMode === 'monetize' ? 'monetized' : 'fun',
            });

            // Registration succeeded
            setDeploymentStep(DeploymentStep.COMPLETED);
            return;
          } catch (err) {
            lastError = err;
            console.error(
              `Firestore registration attempt ${attempt + 1}/${MAX_RETRIES} failed:`,
              err
            );

            // If the universe already exists, treat as success (idempotent)
            if (err instanceof Error && err.message.includes('already exists')) {
              setDeploymentStep(DeploymentStep.COMPLETED);
              return;
            }

            // Wait before retrying (exponential backoff: 1s, 2s, 4s)
            if (attempt < MAX_RETRIES - 1) {
              await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
            }
          }
        }

        // All retries exhausted — still show completed since on-chain succeeded,
        // but warn the user about the DB gap
        console.error('Firestore registration failed after all retries:', lastError);
        toast.warning(
          "Universe created on-chain, but app registration failed after multiple attempts. It may take a moment to appear. Contact support if it doesn't.",
          { duration: 10000 }
        );
        setDeploymentStep(DeploymentStep.COMPLETED);
      })();
    } else {
      setDeploymentStep(DeploymentStep.COMPLETED);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txSuccess, txReceipt, hash]);

  // Note: Token deployment event parsing is handled in the universe creation effect above
  // since createUniverseWithToken() emits both events in a single receipt.

  const handleCreateUniverse = async () => {
    // Auth is now Circle DCW — there is no in-page sign-in flow. Send the
    // user to /login if they're not signed in (or have no wallet) so they
    // can complete email/social auth, then come back here.
    if (!address || !isAuthenticated) {
      toast.error('Please sign in to continue');
      navigate({ to: '/login', search: { redirect: '/cinematicUniverseCreate' } });
      return;
    }

    if (!isSupportedChain(chainId)) {
      const targetName =
        CHAIN_NAMES[SUPPORTED_CHAIN_IDS[0] as keyof typeof CHAIN_NAMES] ??
        `Chain ${SUPPORTED_CHAIN_IDS[0]}`;
      toast.error(`Wrong network — please switch to ${targetName}.`);
      return;
    }

    if (!universeName || !imageUrl || !description) {
      toast.error('Please fill in universe name, image, and description');
      return;
    }

    if (!universeMode) {
      toast.error('Please select a universe mode');
      return;
    }

    if (universeMode === 'monetize' && !tokenSymbol) {
      toast.error('Please enter a token symbol');
      return;
    }

    // Guard: mint fee must be loaded from contract before submitting
    if (mintFee === undefined) {
      toast.error('Mint fee not loaded yet. Please wait a moment and try again.');
      return;
    }

    // Guard: check wallet balance covers mintFee + gas buffer
    if (balance?.value !== undefined && mintFee !== undefined) {
      const gasBuffer = BigInt(5e15); // ~0.005 ETH buffer for gas
      if (balance.value < mintFee + gasBuffer) {
        toast.error(
          `Insufficient balance. You need at least ${priceText({ wei: mintFee + gasBuffer }, { hideChain: true })} (mint fee + gas).`
        );
        return;
      }
    }

    // Guard: allocation must be valid in monetize mode
    if (universeMode === 'monetize' && !allocationValid) {
      toast.error('Token allocation is invalid. Please fix before continuing.');
      return;
    }

    setDeploymentStep(DeploymentStep.CREATING_UNIVERSE);

    try {
      if (universeMode === 'monetize') {
        // Atomic: create universe + deploy token in a single transaction
        if (
          !defaultConfig.defaultHook ||
          !defaultConfig.defaultLocker ||
          !defaultConfig.defaultPairedToken
        ) {
          toast.error(
            'Token deployment contracts not available on this network. Please try again later.'
          );
          setDeploymentStep(DeploymentStep.IDLE);
          return;
        }

        await createUniverseWithToken(
          {
            name: universeName,
            imageURL: imageUrl,
            description: description,
            nodeCreationOptions: 0,
            nodeVisibilityOptions: 0,
            initialOwner: address as `0x${string}`,
            safeAddress: safeAddress ?? undefined,
          },
          {
            tokenConfig: {
              tokenAdmin: address as `0x${string}`,
              name: universeName,
              symbol: tokenSymbol,
              imageURL: imageUrl,
              metadata: metadata || `Token for ${universeName}`,
              context: context || description,
            },
            poolConfig: {
              hook: defaultConfig.defaultHook,
              pairedToken: defaultConfig.defaultPairedToken,
              tickIfToken0IsLoar: startingTick,
              tickSpacing: defaultConfig.defaultTickSpacing,
              poolData: defaultConfig.defaultPoolData as `0x${string}`,
            },
            lockerConfig: {
              locker: defaultConfig.defaultLocker,
              rewardAdmins: [address as `0x${string}`],
              rewardRecipients: [address as `0x${string}`],
              rewardBps: [10000],
              tickLower: [startingTick],
              tickUpper: [0],
              positionBps: [10000],
              lockerData: '0x' as `0x${string}`,
            },
            allocationConfig: {
              curveBps,
              creatorBps,
              treasuryBps,
              communityBps,
            },
          }
        );
      } else {
        // Fun mode: create universe only (token can be deployed later)
        await createUniverse({
          name: universeName,
          imageURL: imageUrl,
          description: description,
          nodeCreationOptions: 0,
          nodeVisibilityOptions: 0,
          initialOwner: address as `0x${string}`,
          safeAddress: safeAddress ?? undefined,
        });
      }
    } catch (err) {
      toast.error(
        `Universe creation failed: ${err instanceof Error ? err.message : 'Unknown error'}`
      );
      setDeploymentStep(DeploymentStep.IDLE);
      processedUniverseHash.current = null;
    }
  };

  // Note: Token deployment for existing universes (fun → monetize later) is handled
  // by the standalone /universe/$id/deploy-token page. This create page uses the
  // atomic createUniverseWithToken() for monetize mode.

  // Auth is now checked in beforeLoad — no useEffect redirect needed

  // Wait for thirdweb to finish reconnecting the previously-connected wallet
  // before showing the connect prompt (avoids a flash of "Connect Your Wallet"
  // when the user is actually already connected).
  if (isAuthenticating) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Not connected state — need at least a wallet for contract calls
  if (!isConnected) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardContent className="text-center space-y-4 p-8">
            <Sparkles className="h-16 w-16 mx-auto mb-4 text-primary" />
            <h2 className="text-2xl font-bold">Connect Your Wallet</h2>
            <p className="text-muted-foreground">
              Please connect your wallet to create a universe.
            </p>
            <WalletConnectButton size="lg" />
          </CardContent>
        </Card>
      </div>
    );
  }

  // Wrong network state — tells user exactly which network to switch to
  if (!isSupportedChain(chainId)) {
    const targetName =
      CHAIN_NAMES[SUPPORTED_CHAIN_IDS[0] as keyof typeof CHAIN_NAMES] ??
      `Chain ${SUPPORTED_CHAIN_IDS[0]}`;
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardContent className="text-center space-y-4 p-8">
            <AlertCircle className="h-16 w-16 mx-auto mb-4 text-yellow-600" />
            <h2 className="text-2xl font-bold">Wrong Network</h2>
            <p className="text-muted-foreground">
              LOAR runs on <strong>{targetName}</strong>. Please switch your wallet to continue.
            </p>
            <Button size="lg" onClick={handleSwitchNetwork}>
              <Rocket className="h-5 w-5 mr-2" />
              Switch to {targetName}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Success state
  if (deploymentStep === DeploymentStep.COMPLETED) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <Card className="w-full max-w-2xl">
          <CardContent className="text-center space-y-6 p-10">
            <CheckCircle2 className="h-20 w-20 mx-auto text-green-500" />
            <h2 className="text-3xl font-bold">
              {tokenAddress ? 'Universe Launched!' : 'Universe Created!'}
            </h2>
            <p className="text-muted-foreground text-lg">
              {tokenAddress
                ? `Your universe is live on ${CHAIN_NAMES[chainId as keyof typeof CHAIN_NAMES] ?? 'testnet'} with governance token and liquidity pool.`
                : `Your universe is live on ${CHAIN_NAMES[chainId as keyof typeof CHAIN_NAMES] ?? 'testnet'}. Ready to start building your narrative world!`}
            </p>
            {!tokenAddress && (
              <div className="p-3 rounded-lg bg-muted/50 border text-sm text-muted-foreground">
                Want to monetize later? You can launch a token anytime from your universe page.
              </div>
            )}

            <div className="space-y-3">
              {universeAddress && (
                <div className="p-4 bg-muted rounded-lg flex items-center justify-between">
                  <div className="text-left">
                    <p className="text-xs text-muted-foreground mb-1 uppercase font-semibold">
                      Universe Contract
                    </p>
                    <code className="text-sm font-mono">
                      {universeAddress.slice(0, 16)}...{universeAddress.slice(-14)}
                    </code>
                  </div>
                  <a
                    href={getExplorerAddressUrl(chainId, universeAddress)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline text-sm flex items-center gap-1"
                  >
                    View <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
              {tokenAddress && (
                <div className="p-4 bg-muted rounded-lg flex items-center justify-between">
                  <div className="text-left">
                    <p className="text-xs text-muted-foreground mb-1 uppercase font-semibold">
                      Governance Token
                    </p>
                    <code className="text-sm font-mono">
                      {tokenAddress.slice(0, 16)}...{tokenAddress.slice(-14)}
                    </code>
                  </div>
                  <a
                    href={getExplorerAddressUrl(chainId, tokenAddress)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline text-sm flex items-center gap-1"
                  >
                    View <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              {universeAddress && (
                <RouterLink to="/create" search={{ universe: universeAddress.toLowerCase() }}>
                  <Button size="lg" className="w-full">
                    <Rocket className="h-5 w-5 mr-2" />
                    Start Building
                  </Button>
                </RouterLink>
              )}
              {!tokenAddress && universeAddress && (
                <RouterLink
                  to="/universe/$id/deploy-token"
                  params={{ id: universeAddress.toLowerCase() }}
                >
                  <Button size="lg" variant="outline" className="w-full">
                    <Rocket className="h-5 w-5 mr-2" />
                    Launch Token
                  </Button>
                </RouterLink>
              )}
              <RouterLink to="/universe/$id" params={{ id: universeAddress?.toLowerCase() ?? '' }}>
                <Button size="lg" variant="outline" className="w-full">
                  Enter Universe
                </Button>
              </RouterLink>
              <Button size="lg" variant="ghost" onClick={() => (window.location.href = '/')}>
                <ArrowLeft className="h-5 w-5 mr-2" />
                All Universes
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Main form
  return (
    <div className="min-h-screen md:h-full bg-background md:overflow-hidden">
      <div className="h-full max-w-6xl mx-auto px-4 py-6 md:p-8 flex flex-col">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl md:text-4xl font-bold mb-2">Create Your Universe</h1>
          <p className="text-muted-foreground text-sm md:text-lg">
            Build a narrative world for fun, or launch with a token and liquidity pool
          </p>
        </div>

        {/* Main Content */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 min-h-0">
          {/* Form Panel */}
          <Card className="flex flex-col overflow-hidden">
            <CardContent className="p-6 flex-1 overflow-y-auto space-y-4">
              {/* Step 1: Universe Creation */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold">Step 1: Create Universe</h3>
                  {deploymentStep !== DeploymentStep.IDLE &&
                    deploymentStep !== DeploymentStep.CREATING_UNIVERSE && (
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                    )}
                </div>

                {/* Chain Selector — only when multiple chains are available */}
                {SUPPORTED_CHAIN_IDS.length > 1 && (
                  <div>
                    <Label className="text-sm font-semibold mb-2 block">Deploy on</Label>
                    <Select
                      value={String(chainId)}
                      onValueChange={handleChainSelect}
                      disabled={deploymentStep !== DeploymentStep.IDLE}
                    >
                      <SelectTrigger className="h-11">
                        <SelectValue placeholder="Select network" />
                      </SelectTrigger>
                      <SelectContent>
                        {SUPPORTED_CHAIN_IDS.map((id) => (
                          <SelectItem key={id} value={String(id)}>
                            {CHAIN_NAMES[id] ?? `Chain ${id}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Universe Mode Selector — shown first */}
                <div className="space-y-3">
                  <Label className="text-sm font-semibold block">What kind of universe?</Label>
                  <div className="grid grid-cols-2 gap-3">
                    {/* Create for Fun */}
                    <button
                      type="button"
                      onClick={() => setUniverseMode('fun')}
                      disabled={deploymentStep !== DeploymentStep.IDLE}
                      className={`relative p-4 rounded-lg border-2 text-left transition-all ${
                        universeMode === 'fun'
                          ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                          : 'border-muted hover:border-muted-foreground/30'
                      } disabled:opacity-50`}
                    >
                      {universeMode === 'fun' && (
                        <CheckCircle2 className="absolute top-2 right-2 h-4 w-4 text-primary" />
                      )}
                      <Sparkles className="h-5 w-5 mb-2 text-blue-400" />
                      <p className="text-sm font-bold">Create for Fun</p>
                      <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
                        Narrative playground. No token — just start building. Monetize anytime
                        later.
                      </p>
                    </button>

                    {/* Launch & Monetize */}
                    <button
                      type="button"
                      onClick={() => setUniverseMode('monetize')}
                      disabled={deploymentStep !== DeploymentStep.IDLE}
                      className={`relative p-4 rounded-lg border-2 text-left transition-all ${
                        universeMode === 'monetize'
                          ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                          : 'border-muted hover:border-muted-foreground/30'
                      } disabled:opacity-50`}
                    >
                      {universeMode === 'monetize' && (
                        <CheckCircle2 className="absolute top-2 right-2 h-4 w-4 text-primary" />
                      )}
                      <Rocket className="h-5 w-5 mb-2 text-green-400" />
                      <p className="text-sm font-bold">Launch & Monetize</p>
                      <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
                        Deploy governance token + liquidity pool. Costs mint fee.
                      </p>
                    </button>
                  </div>
                </div>

                <div>
                  <Label htmlFor="universeName" className="text-sm font-semibold mb-2 block">
                    Universe Name
                  </Label>
                  <Input
                    id="universeName"
                    placeholder="e.g., Marvel Cinematic Universe"
                    value={universeName}
                    onChange={(e) => setUniverseName(e.target.value)}
                    disabled={deploymentStep !== DeploymentStep.IDLE || isGeneratingCover}
                    className="h-11"
                  />
                </div>

                <div>
                  <Label className="text-sm font-semibold mb-2 block">Cover Image</Label>

                  {/* Cover previews — landscape + portrait side by side */}
                  {coverPreview && !cropperSrc && (
                    <div className="mb-2 space-y-2">
                      <div className="flex gap-2">
                        {/* Landscape preview */}
                        <div className="relative flex-1 rounded-lg overflow-hidden border">
                          <img
                            src={coverPreview}
                            alt="Landscape cover"
                            className="w-full aspect-video object-cover"
                          />
                          <span className="absolute bottom-1 left-1 text-[10px] bg-black/60 text-white px-1.5 py-0.5 rounded">
                            16:9
                          </span>
                        </div>
                        {/* Portrait preview */}
                        <div className="relative w-20 rounded-lg overflow-hidden border">
                          {portraitPreview ? (
                            <img
                              src={portraitPreview}
                              alt="Portrait cover"
                              className="w-full aspect-[3/4] object-cover"
                            />
                          ) : (
                            <div className="w-full aspect-[3/4] bg-muted flex items-center justify-center">
                              <Crop className="h-3.5 w-3.5 text-muted-foreground" />
                            </div>
                          )}
                          <span className="absolute bottom-1 left-1 text-[10px] bg-black/60 text-white px-1.5 py-0.5 rounded">
                            3:4
                          </span>
                        </div>
                      </div>
                      {deploymentStep === DeploymentStep.IDLE && (
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              if (originalSrc) {
                                setCropPhase('landscape');
                                setCropperSrc(originalSrc);
                              } else {
                                setCropperSrc(coverPreview);
                                setCropPhase('landscape');
                              }
                            }}
                            className="flex items-center gap-1 px-2 py-1 rounded-md text-xs bg-muted hover:bg-muted/80 text-muted-foreground transition-colors"
                            title="Re-crop images"
                          >
                            <Crop className="h-3 w-3" />
                            Re-crop
                          </button>
                          {!portraitPreview && originalSrc && (
                            <button
                              type="button"
                              onClick={() => {
                                setCropPhase('portrait');
                                setCropperSrc(originalSrc);
                              }}
                              className="flex items-center gap-1 px-2 py-1 rounded-md text-xs bg-primary/10 hover:bg-primary/20 text-primary transition-colors"
                              title="Add portrait crop"
                            >
                              <Crop className="h-3 w-3" />
                              Add portrait crop
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={handleClearCover}
                            className="flex items-center gap-1 px-2 py-1 rounded-md text-xs bg-muted hover:bg-muted/80 text-muted-foreground transition-colors ml-auto"
                            title="Remove"
                          >
                            <X className="h-3 w-3" />
                            Remove
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Mode tabs */}
                  <div className="flex gap-1 mb-2">
                    {(
                      [
                        { key: 'upload', label: 'Upload', icon: Upload },
                        { key: 'url', label: 'URL', icon: Link },
                        { key: 'generate', label: 'AI Generate', icon: Sparkles },
                      ] as const
                    ).map(({ key, label, icon: Icon }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setCoverInputMode(key)}
                        disabled={deploymentStep !== DeploymentStep.IDLE}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                          coverInputMode === key
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground hover:bg-muted/80'
                        } disabled:opacity-50`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {label}
                      </button>
                    ))}
                  </div>

                  {/* Upload mode */}
                  {coverInputMode === 'upload' && (
                    <div>
                      <input
                        ref={coverFileRef}
                        type="file"
                        accept="image/jpeg,image/png,image/gif,image/webp,image/avif"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleCoverFilePick(file);
                          e.target.value = '';
                        }}
                        className="hidden"
                      />

                      {/* Cropper — shown after file pick, before upload */}
                      {cropperSrc ? (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">
                              {cropPhase === 'landscape'
                                ? 'Step 1/2 — Landscape (16:9)'
                                : 'Step 2/2 — Portrait (3:4)'}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {cropPhase === 'landscape'
                                ? 'For billboard & wide cards'
                                : 'For poster cards'}
                            </span>
                          </div>
                          <ImageCropper
                            key={cropPhase}
                            src={cropperSrc}
                            aspectRatio={cropPhase === 'landscape' ? 16 / 9 : 3 / 4}
                            outputWidth={cropPhase === 'landscape' ? 1280 : 600}
                            onCrop={handleCoverCrop}
                            onCancel={handleCropCancel}
                          />
                        </div>
                      ) : (
                        <div
                          onClick={() => !isUploadingCover && coverFileRef.current?.click()}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            const file = e.dataTransfer.files[0];
                            if (file) handleCoverFilePick(file);
                          }}
                          className={`cursor-pointer rounded-lg border-2 border-dashed p-4 text-center transition-colors hover:border-primary/50 ${
                            isUploadingCover ? 'pointer-events-none opacity-70' : ''
                          }`}
                        >
                          {isUploadingCover ? (
                            <div className="space-y-2">
                              <Loader2 className="h-5 w-5 mx-auto animate-spin text-primary" />
                              <div className="w-full bg-muted rounded-full h-1.5">
                                <div
                                  className="bg-primary h-1.5 rounded-full transition-all"
                                  style={{ width: `${uploadProgress}%` }}
                                />
                              </div>
                              <p className="text-xs text-muted-foreground">
                                Uploading... {uploadProgress}%
                              </p>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <Upload className="h-5 w-5 mx-auto text-muted-foreground" />
                              <p className="text-xs text-muted-foreground">
                                Drop an image or click to browse
                              </p>
                              <p className="text-[10px] text-muted-foreground/60">
                                JPEG, PNG, GIF, WebP, AVIF — max 10MB
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* URL mode */}
                  {coverInputMode === 'url' && (
                    <Input
                      placeholder="https://example.com/cover.jpg"
                      value={imageUrl}
                      onChange={(e) => {
                        setImageUrl(e.target.value);
                        setCoverPreview(e.target.value || null);
                      }}
                      disabled={deploymentStep !== DeploymentStep.IDLE}
                      className="h-11"
                    />
                  )}

                  {/* AI Generate mode */}
                  {coverInputMode === 'generate' && (
                    <div className="space-y-2">
                      <div className="flex items-end gap-2">
                        <div className="flex-1 min-w-0">
                          <ModelSelector
                            type="image"
                            task="text_to_image"
                            value={coverModel}
                            onChange={setCoverModel}
                            label="Model"
                            compact
                          />
                        </div>
                        <Button
                          type="button"
                          onClick={handleGenerateCover}
                          disabled={
                            isGeneratingCover ||
                            deploymentStep !== DeploymentStep.IDLE ||
                            !universeName
                          }
                          variant="outline"
                          className="h-11"
                        >
                          {isGeneratingCover ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              Generating...
                            </>
                          ) : (
                            <>
                              <Sparkles className="h-4 w-4 mr-2" />
                              Generate
                            </>
                          )}
                        </Button>
                      </div>
                      {!universeName && (
                        <p className="text-xs text-muted-foreground">
                          Enter a universe name above to generate a cover
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <Label htmlFor="description" className="text-sm font-semibold mb-2 block">
                    Description
                  </Label>
                  <Textarea
                    id="description"
                    placeholder="Describe your universe and its narrative..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    disabled={deploymentStep !== DeploymentStep.IDLE || isGeneratingCover}
                    className="min-h-[100px] resize-none"
                    maxLength={1000}
                  />
                  <p className="text-[10px] text-muted-foreground mt-1 text-right tabular-nums">
                    {description.length}/1000
                  </p>
                </div>

                {/* Token config (shown when monetize mode selected) */}
                {universeMode === 'monetize' && (
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="tokenSymbolMain" className="text-sm font-semibold mb-2 block">
                        Token Symbol
                      </Label>
                      <Input
                        id="tokenSymbolMain"
                        placeholder="e.g., MCU"
                        value={tokenSymbol}
                        onChange={(e) => setTokenSymbol(e.target.value.toUpperCase())}
                        disabled={deploymentStep !== DeploymentStep.IDLE || isGeneratingCover}
                        maxLength={10}
                        className="h-11"
                      />
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Auto-uppercase. 2-10 characters.
                      </p>
                    </div>

                    {/* Launch Valuation — live updating */}
                    <div className="space-y-3">
                      <div>
                        <Label className="text-sm font-semibold block">Launch Valuation</Label>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          Total value of all {tokenSymbol || 'tokens'} at launch — sets how much 1
                          ETH buys.
                        </p>
                      </div>

                      {/* Main valuation display */}
                      <div className="p-4 rounded-lg bg-primary/5 border-2 border-primary/20 text-center">
                        <p className="text-[10px] text-muted-foreground uppercase font-semibold mb-1">
                          Initial Market Cap
                        </p>
                        <p className="text-2xl font-bold text-primary tabular-nums">
                          {formatMarketCap(marketCapEth)}
                        </p>
                      </div>

                      {/* Quick presets */}
                      <div>
                        <p className="text-[10px] text-muted-foreground mb-1.5 font-medium">
                          Quick pick a market cap
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {PRICE_PRESETS.map((preset) => (
                            <button
                              key={preset.tick}
                              type="button"
                              onClick={() => setStartingTick(preset.tick)}
                              disabled={deploymentStep !== DeploymentStep.IDLE}
                              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                                startingTick === preset.tick
                                  ? 'bg-primary text-primary-foreground'
                                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
                              } disabled:opacity-50`}
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Slider */}
                      <div>
                        <Slider
                          value={[startingTick]}
                          onValueChange={([v]) => {
                            // Round to tickSpacing of 200
                            setStartingTick(Math.round(v / 200) * 200);
                          }}
                          min={TICK_MIN}
                          max={TICK_MAX}
                          step={200}
                          disabled={deploymentStep !== DeploymentStep.IDLE}
                        />
                        <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                          <span>Lower valuation</span>
                          <span>Higher valuation</span>
                        </div>
                      </div>

                      {/* What this means — plain English */}
                      <div className="p-3 rounded-lg bg-muted/50 border text-xs text-muted-foreground space-y-1">
                        <div className="flex justify-between">
                          <span>1 ETH buys</span>
                          <span className="font-semibold text-foreground tabular-nums">
                            {formatTokenAmount(tokensPerEth)} {tokenSymbol || 'tokens'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Total supply</span>
                          <span className="font-semibold text-foreground tabular-nums">
                            1B {tokenSymbol || 'tokens'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Token Allocation */}
                    <div className="space-y-3">
                      <button
                        type="button"
                        onClick={() => setShowAdvancedTokenomics(!showAdvancedTokenomics)}
                        disabled={deploymentStep !== DeploymentStep.IDLE}
                        className="flex items-center gap-2 w-full text-left group"
                      >
                        <Sliders className="h-4 w-4 text-muted-foreground" />
                        <Label className="text-sm font-semibold cursor-pointer">
                          Token Allocation
                        </Label>
                        <span className="text-[10px] text-muted-foreground ml-auto">
                          {showAdvancedTokenomics ? 'Hide' : 'Customize'}
                        </span>
                      </button>

                      {/* Summary bar — always visible */}
                      <div className="flex h-3 rounded-full overflow-hidden border">
                        <div
                          className="bg-primary"
                          style={{ width: `${curveBps / 100}%` }}
                          title={`Liquidity Pool: ${curveBps / 100}%`}
                        />
                        <div
                          className="bg-green-500"
                          style={{ width: `${creatorBps / 100}%` }}
                          title={`Creator: ${creatorBps / 100}%`}
                        />
                        <div
                          className="bg-amber-500"
                          style={{ width: `${treasuryBps / 100}%` }}
                          title={`Treasury: ${treasuryBps / 100}%`}
                        />
                        <div
                          className="bg-blue-500"
                          style={{ width: `${communityBps / 100}%` }}
                          title={`Community: ${communityBps / 100}%`}
                        />
                      </div>

                      {/* Legend — always visible */}
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                        <div className="flex items-center gap-1.5">
                          <span className="h-2.5 w-2.5 rounded-sm bg-primary flex-shrink-0" />
                          <span className="text-muted-foreground">Liquidity Pool</span>
                          <span className="ml-auto font-semibold tabular-nums">
                            {curveBps / 100}%
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="h-2.5 w-2.5 rounded-sm bg-green-500 flex-shrink-0" />
                          <span className="text-muted-foreground">Creator</span>
                          <span className="ml-auto font-semibold tabular-nums">
                            {creatorBps / 100}%
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="h-2.5 w-2.5 rounded-sm bg-amber-500 flex-shrink-0" />
                          <span className="text-muted-foreground">Treasury</span>
                          <span className="ml-auto font-semibold tabular-nums">
                            {treasuryBps / 100}%
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="h-2.5 w-2.5 rounded-sm bg-blue-500 flex-shrink-0" />
                          <span className="text-muted-foreground">Community</span>
                          <span className="ml-auto font-semibold tabular-nums">
                            {communityBps / 100}%
                          </span>
                        </div>
                      </div>

                      {/* Expanded sliders */}
                      {showAdvancedTokenomics && (
                        <div className="space-y-3 pt-2 border-t">
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <label className="text-xs text-muted-foreground">
                                Liquidity Pool
                              </label>
                              <span className="text-xs font-semibold tabular-nums">
                                {curveBps / 100}%
                              </span>
                            </div>
                            <Slider
                              value={[curveBps]}
                              onValueChange={([v]) =>
                                handleAllocationChange('lp', Math.round(v / 100) * 100)
                              }
                              min={5000}
                              max={9500}
                              step={100}
                              disabled={deploymentStep !== DeploymentStep.IDLE}
                            />
                            <p className="text-[10px] text-muted-foreground">
                              Locked in the liquidity pool forever. Min 50%.
                            </p>
                          </div>

                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <label className="text-xs text-muted-foreground">Creator</label>
                              <span className="text-xs font-semibold tabular-nums">
                                {creatorBps / 100}%
                              </span>
                            </div>
                            <Slider
                              value={[creatorBps]}
                              onValueChange={([v]) =>
                                handleAllocationChange('creator', Math.round(v / 100) * 100)
                              }
                              min={0}
                              max={4000}
                              step={100}
                              disabled={deploymentStep !== DeploymentStep.IDLE}
                            />
                            <p className="text-[10px] text-muted-foreground">
                              Sent to your wallet. Max 40%.
                            </p>
                          </div>

                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <label className="text-xs text-muted-foreground">Treasury</label>
                              <span className="text-xs font-semibold tabular-nums">
                                {treasuryBps / 100}%
                              </span>
                            </div>
                            <Slider
                              value={[treasuryBps]}
                              onValueChange={([v]) =>
                                handleAllocationChange('treasury', Math.round(v / 100) * 100)
                              }
                              min={200}
                              max={2000}
                              step={100}
                              disabled={deploymentStep !== DeploymentStep.IDLE}
                            />
                            <p className="text-[10px] text-muted-foreground">
                              Reserved for governance & operations. Min 2%.
                            </p>
                          </div>

                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <label className="text-xs text-muted-foreground">Community</label>
                              <span className="text-xs font-semibold tabular-nums">
                                {communityBps / 100}%
                              </span>
                            </div>
                            <Slider
                              value={[communityBps]}
                              onValueChange={([v]) =>
                                handleAllocationChange('community', Math.round(v / 100) * 100)
                              }
                              min={0}
                              max={3000}
                              step={100}
                              disabled={deploymentStep !== DeploymentStep.IDLE}
                            />
                            <p className="text-[10px] text-muted-foreground">
                              Airdrops, rewards, and incentives.
                            </p>
                          </div>

                          {!allocationValid && (
                            <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-500 flex items-start gap-2">
                              <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                              <span>
                                {allocationTotal !== 10000
                                  ? `Allocations must total 100% (currently ${allocationTotal / 100}%)`
                                  : curveBps < 5000
                                    ? 'Liquidity Pool must be at least 50%'
                                    : creatorBps > 4000
                                      ? 'Creator allocation cannot exceed 40%'
                                      : 'Treasury must be at least 2%'}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Multi-Sig Ownership (optional) */}
                <SafeSetup
                  disabled={deploymentStep !== DeploymentStep.IDLE}
                  onSafeDeployed={(addr) => setSafeAddress(addr as `0x${string}`)}
                  onDisabled={() => setSafeAddress(null)}
                />

                {deploymentStep === DeploymentStep.IDLE && (
                  <>
                    {/* Mint fee info */}
                    {universeMode && (
                      <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 border text-sm">
                        <Info className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        <span className="text-muted-foreground">
                          Mint fee:{' '}
                          {mintFee !== undefined ? <Price wei={mintFee} hideChain /> : 'loading...'}
                          {universeMode === 'monetize' ? ' (seeds LP pool)' : ''}
                          {' + gas'}
                        </span>
                      </div>
                    )}

                    {/* Early balance warning — shown before user clicks deploy */}
                    {universeMode &&
                      mintFee !== undefined &&
                      balance?.value !== undefined &&
                      (() => {
                        const gasBuffer = BigInt(5e15);
                        const needed = mintFee + gasBuffer;
                        if (balance.value < needed) {
                          return (
                            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm">
                              <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                              <div>
                                <p className="font-medium text-red-500">Insufficient balance</p>
                                <p className="text-xs text-red-400 mt-0.5">
                                  You need at least <Price wei={needed} hideChain /> but have{' '}
                                  <Price wei={balance.value} hideChain />.
                                  {(import.meta.env.VITE_CHAIN_ENV ?? 'testnet') === 'testnet' && (
                                    <>
                                      {' '}
                                      Get testnet ETH from the{' '}
                                      <a href="/faucet" className="underline font-medium">
                                        Faucet
                                      </a>
                                      .
                                    </>
                                  )}
                                </p>
                              </div>
                            </div>
                          );
                        }
                        return null;
                      })()}

                    <Button
                      onClick={handleCreateUniverse}
                      disabled={
                        !universeName ||
                        !imageUrl ||
                        !description ||
                        !universeMode ||
                        (universeMode === 'monetize' && !tokenSymbol) ||
                        (universeMode === 'monetize' && !allocationValid) ||
                        mintFee === undefined ||
                        mintFeeLoading ||
                        isPending ||
                        isConfirming ||
                        isGeneratingCover
                      }
                      className="w-full h-12 text-base font-bold"
                      size="lg"
                    >
                      {isPending || isConfirming ? (
                        <>
                          <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                          {universeMode === 'monetize'
                            ? 'Launching Universe & Token...'
                            : 'Creating Universe...'}
                        </>
                      ) : (
                        <>
                          {universeMode === 'monetize' ? (
                            <Rocket className="h-5 w-5 mr-2" />
                          ) : (
                            <Sparkles className="h-5 w-5 mr-2" />
                          )}
                          {universeMode === 'monetize'
                            ? 'Launch Universe + Token'
                            : 'Create Universe'}
                        </>
                      )}
                    </Button>
                  </>
                )}
              </div>

              {/* Deployment in progress indicator (monetize mode — atomic, single tx) */}
              {universeMode === 'monetize' &&
                deploymentStep === DeploymentStep.CREATING_UNIVERSE && (
                  <div className="pt-4 border-t">
                    <div className="p-4 bg-muted rounded-lg">
                      <div className="flex items-center gap-3">
                        <Loader2 className="h-5 w-5 text-primary animate-spin" />
                        <div>
                          <p className="text-sm font-semibold">
                            Creating universe, deploying token & liquidity pool...
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            One transaction — confirm in your wallet and wait for confirmation.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

              {/* Registering universe in app database */}
              {deploymentStep === DeploymentStep.REGISTERING && (
                <div className="pt-4 border-t">
                  <div className="p-4 bg-muted rounded-lg">
                    <div className="flex items-center gap-3">
                      <Loader2 className="h-5 w-5 text-primary animate-spin" />
                      <div>
                        <p className="text-sm font-semibold">Registering universe...</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          On-chain transaction confirmed. Saving to the app database.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {error && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
                  <p className="text-sm text-red-500">Error: {error.message}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Preview Panel */}
          <Card className="flex flex-col overflow-hidden">
            <CardContent className="p-0 flex-1 flex flex-col overflow-hidden">
              {/* Preview Image */}
              <div className="relative aspect-video bg-muted overflow-hidden flex-shrink-0">
                {imageUrl ? (
                  <img
                    src={imageUrl}
                    alt="Preview"
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                      const fallback =
                        e.currentTarget.parentElement?.querySelector('.img-fallback');
                      if (fallback) (fallback as HTMLElement).style.display = 'flex';
                    }}
                  />
                ) : null}
                <div
                  className="img-fallback absolute inset-0 items-center justify-center bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500"
                  style={{ display: imageUrl ? 'none' : 'flex' }}
                >
                  {imageUrl ? (
                    <div className="text-center">
                      <AlertCircle className="h-8 w-8 text-white/60 mx-auto mb-2" />
                      <p className="text-white/60 text-xs">Image failed to load</p>
                    </div>
                  ) : (
                    <ImageIcon className="h-16 w-16 text-white/40" />
                  )}
                </div>
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-6">
                  <h3 className="text-2xl font-bold text-white drop-shadow-2xl mb-2">
                    {universeName || 'Your Universe Name'}
                  </h3>
                  <div className="flex items-center gap-2">
                    {tokenSymbol && universeMode === 'monetize' && (
                      <Badge className="bg-white/20 backdrop-blur-sm text-white border-0">
                        ${tokenSymbol}
                      </Badge>
                    )}
                    {universeMode && (
                      <Badge
                        className={`backdrop-blur-sm border-0 text-[10px] ${
                          universeMode === 'monetize'
                            ? 'bg-green-500/20 text-green-200'
                            : 'bg-blue-500/20 text-blue-200'
                        }`}
                      >
                        {universeMode === 'monetize' ? 'Monetized' : 'For Fun'}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              {/* Preview Content */}
              <div className="p-6 space-y-4 flex-1 overflow-y-auto">
                {universeMode === 'monetize' && tokenSymbol && (
                  <div className="grid grid-cols-3 gap-2">
                    <div className="p-2.5 rounded-lg bg-muted/50">
                      <p className="text-[10px] text-muted-foreground uppercase font-semibold">
                        Market Cap
                      </p>
                      <p className="text-sm font-bold text-primary tabular-nums">
                        {formatMarketCap(marketCapEth)}
                      </p>
                    </div>
                    <div className="p-2.5 rounded-lg bg-muted/50">
                      <p className="text-[10px] text-muted-foreground uppercase font-semibold">
                        LP Seed
                      </p>
                      <p className="text-sm font-bold">
                        {mintFee !== undefined ? <Price wei={mintFee} hideChain /> : '...'}
                      </p>
                    </div>
                    <div className="p-2.5 rounded-lg bg-muted/50">
                      <p className="text-[10px] text-muted-foreground uppercase font-semibold">
                        Supply
                      </p>
                      <p className="text-sm font-bold">1B</p>
                    </div>
                  </div>
                )}
                <div>
                  <p className="text-xs font-bold text-muted-foreground mb-2 uppercase">About</p>
                  <p className="text-sm text-foreground leading-relaxed">
                    {description ||
                      'Your universe description will appear here. Share the vision and story of your cinematic world...'}
                  </p>
                </div>

                {deploymentStep !== DeploymentStep.IDLE && (
                  <div className="pt-4 border-t space-y-3">
                    <p className="text-xs font-bold text-muted-foreground uppercase">
                      Deployment Progress
                    </p>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm">
                        {deploymentStep === DeploymentStep.CREATING_UNIVERSE ? (
                          <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                        )}
                        <span
                          className={
                            deploymentStep !== DeploymentStep.CREATING_UNIVERSE
                              ? 'text-green-500 font-medium'
                              : ''
                          }
                        >
                          {universeMode === 'monetize'
                            ? 'Universe + Token + Liquidity Pool'
                            : 'Universe Contract'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
