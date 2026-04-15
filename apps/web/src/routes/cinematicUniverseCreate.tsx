/**
 * Cinematic Universe Creation Route
 *
 * Two-step wizard for deploying a new narrative universe on-chain:
 * 1. Create the Universe smart contract (name, image, description).
 * 2. Deploy a governance token and liquidity pool for the universe.
 * Includes AI-powered cover image generation via fal.ai.
 */

import { createFileRoute, Link as RouterLink, useNavigate } from '@tanstack/react-router';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useBalance, useChainId, useWaitForTransactionReceipt, useSwitchChain } from 'wagmi';
import { useIsAutoConnecting, useActiveAccount } from 'thirdweb/react';
import { useWalletAuth } from '@/lib/wallet-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { useMutation } from '@tanstack/react-query';
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
import { parseEther, decodeEventLog } from 'viem';
import { universeManagerAbi } from '@loar/abis/generated';
import {
  isSupportedChain,
  getExplorerAddressUrl,
  CHAIN_NAMES,
  SUPPORTED_CHAIN_IDS,
} from '@/configs/chains';

export const Route = createFileRoute('/cinematicUniverseCreate')({
  component: CinematicUniverseCreate,
});

// Deployment steps
enum DeploymentStep {
  IDLE = 'idle',
  CREATING_UNIVERSE = 'creating_universe',
  UNIVERSE_CREATED = 'universe_created',
  DEPLOYING_TOKEN = 'deploying_token',
  TOKEN_DEPLOYED = 'token_deployed',
  COMPLETED = 'completed',
}

function CinematicUniverseCreate() {
  const { address, isConnected, isAuthenticated, isAuthenticating, signIn } = useWalletAuth();
  const navigate = useNavigate();
  const isAutoConnecting = useIsAutoConnecting();
  const chainId = useChainId();
  const { data: balance } = useBalance({ address });
  const { switchChain } = useSwitchChain();
  const thirdwebAccount = useActiveAccount();

  // Form state
  const [universeName, setUniverseName] = useState('');
  const [tokenSymbol, setTokenSymbol] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [description, setDescription] = useState('');
  const [metadata, setMetadata] = useState(''); // Additional token metadata
  const [context, setContext] = useState(''); // Universe context/lore

  // Token launch mode: deploy token + LP now, or skip and do it later
  const [launchTokenNow, setLaunchTokenNow] = useState(true);

  // Token allocation state (basis points, must sum to 10000)
  const [lpBps, setLpBps] = useState(8000); // 80% LP
  const [creatorBps, setCreatorBps] = useState(1000); // 10% Creator
  const [treasuryBps, setTreasuryBps] = useState(500); // 5% Treasury
  const [communityBps, setCommunityBps] = useState(500); // 5% Community
  const [showAdvancedTokenomics, setShowAdvancedTokenomics] = useState(false);

  // Allocation helpers
  const allocationTotal = lpBps + creatorBps + treasuryBps + communityBps;
  const allocationValid =
    allocationTotal === 10000 && lpBps >= 5000 && treasuryBps >= 200 && creatorBps <= 4000;

  const handleAllocationChange = (
    field: 'lp' | 'creator' | 'treasury' | 'community',
    value: number
  ) => {
    // Build the proposed state with the new value applied
    const proposed = {
      lp: field === 'lp' ? value : lpBps,
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

    setLpBps(proposed.lp);
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
  const [coverModel, setCoverModel] = useState<string>(
    import.meta.env.VITE_DEFAULT_IMAGE_MODEL || 'fal-ai/nano-banana'
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
  const { createUniverse, deployUniverseToken, hash, isPending, error } = useUniverseManager();
  const defaultConfig = useDefaultDeploymentConfig();
  const {
    isSuccess: txSuccess,
    isLoading: isConfirming,
    data: txReceipt,
  } = useWaitForTransactionReceipt({ hash });

  // Track which tx hash each effect has already processed to prevent double-firing
  const processedUniverseHash = useRef<string | null>(null);
  const processedTokenHash = useRef<string | null>(null);

  // Auto-switch to supported chain if on wrong network
  useEffect(() => {
    if (isConnected && !isSupportedChain(chainId)) {
      switchChain({ chainId: SUPPORTED_CHAIN_IDS[0] });
    }
  }, [isConnected, chainId, switchChain]);

  const handleSwitchNetwork = () => {
    switchChain({ chainId: SUPPORTED_CHAIN_IDS[0] });
  };

  // Cover image generation mutation
  const generateCoverMutation = useMutation({
    mutationFn: async () => {
      const prompt = `Epic cinematic universe cover art for "${universeName}". ${description}. Professional movie poster style, high quality, dramatic lighting`;

      const result = await trpcClient.image.generateImage.mutate({
        prompt,
        model: coverModel as any,
        imageSize: 'landscape_16_9',
      });

      return result;
    },
    onSuccess: (data) => {
      if (data?.imageUrl) {
        setCoverPreview(data.imageUrl);
        setImageUrl(data.imageUrl);
      }
    },
    onError: (error: any) => {
      const msg = error?.message || 'Unknown error';
      if (msg.includes('Insufficient credits') || msg.includes('PRECONDITION_FAILED')) {
        alert(
          'Not enough credits to generate a cover image. Purchase credits in the Credits page.'
        );
      } else {
        alert(`Failed to generate cover: ${msg}`);
      }
    },
  });

  const handleGenerateCover = async () => {
    if (!universeName) {
      alert('Please enter a universe name first');
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
      alert('Please upload an image file (JPEG, PNG, GIF, WebP, or AVIF)');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      alert('Image must be under 10MB');
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
        alert('Session expired. Please sign in again.');
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
          xhr.open('POST', `${serverUrl}/api/upload`);
          xhr.withCredentials = true;
          xhr.send(formData);
        }
      );

      return result.manifest.uploads[0]?.url || null;
    } catch (err) {
      alert(`Upload failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
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
      if (uploadedUrl) {
        setImageUrl(uploadedUrl);
        setCoverPreview(URL.createObjectURL(blob));
      }

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

  // Watch for universe creation transaction success
  useEffect(() => {
    if (!txSuccess || !txReceipt || !hash) return;
    if (deploymentStep !== DeploymentStep.CREATING_UNIVERSE) return;
    if (processedUniverseHash.current === hash) return; // Already processed this tx
    processedUniverseHash.current = hash;

    // Parse UniverseCreated event from receipt logs
    let parsedUniverseAddress: `0x${string}` | null = null;
    let parsedUniverseId: bigint | null = null;

    for (const log of txReceipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: universeManagerAbi,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === 'UniverseCreated') {
          const args = decoded.args as { universe: string; creator: string };
          parsedUniverseAddress = args.universe as `0x${string}`;
        }
        if (decoded.eventName === 'UniverseMintFee') {
          const args = decoded.args as { universeId: bigint };
          parsedUniverseId = args.universeId;
        }
      } catch {
        // Not a UniverseManager event, skip
      }
    }

    if (parsedUniverseAddress) {
      setUniverseAddress(parsedUniverseAddress);
    }
    if (parsedUniverseId !== null) {
      setUniverseId(parsedUniverseId);
    }
    // If user chose to launch token now AND provided a symbol, auto-trigger step 2
    if (launchTokenNow && parsedUniverseId !== null && address && tokenSymbol) {
      setDeploymentStep(DeploymentStep.UNIVERSE_CREATED);
      setTimeout(() => {
        handleDeployTokenWithId(parsedUniverseId!);
      }, 500);
    } else {
      // Skip token deployment — go straight to completed (universe-only)
      setDeploymentStep(DeploymentStep.COMPLETED);
    }

    // Register universe in Firestore using parsed values directly (not stale state)
    if (address && parsedUniverseAddress) {
      (async () => {
        try {
          const creator = safeAddress ?? address;
          // Fetch server-issued nonce and sign a message to prove wallet ownership
          const { nonce } = await trpcClient.universes.getNonce.query();
          const message = `Register universe ${parsedUniverseAddress} created by ${creator} with nonce ${nonce} at ${Date.now()}`;
          if (!thirdwebAccount) throw new Error('Wallet not connected');
          const signature = await thirdwebAccount.signMessage({ message });

          await trpcClient.universes.create.mutate({
            address: parsedUniverseAddress,
            creator,
            name: universeName,
            tokenAddress: '0x0000000000000000000000000000000000000000',
            governanceAddress: '0x0000000000000000000000000000000000000000',
            imageUrl: imageUrl,
            portraitImageUrl: portraitImageUrl || undefined,
            description: description,
            onChainUniverseId: parsedUniverseId?.toString(),
            mintTxHash: hash,
            signature,
            message,
            nonce,
          });
        } catch (err) {
          // Registration error is non-blocking; universe was already created on-chain
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txSuccess, txReceipt, hash]);

  // Watch for token deployment transaction success
  useEffect(() => {
    if (!txSuccess || !txReceipt || !hash) return;
    if (deploymentStep !== DeploymentStep.DEPLOYING_TOKEN) return;
    if (processedTokenHash.current === hash) return; // Already processed this tx
    processedTokenHash.current = hash;

    // Parse TokenCreated event for token + governor addresses
    let parsedTokenAddress: `0x${string}` | undefined;
    let parsedGovernorAddress: `0x${string}` | undefined;

    for (const log of txReceipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: universeManagerAbi,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === 'TokenCreated') {
          const args = decoded.args as { tokenAddress: string; governor: string };
          parsedTokenAddress = args.tokenAddress as `0x${string}`;
          parsedGovernorAddress = args.governor as `0x${string}`;
        }
      } catch {
        // Not a UniverseManager event, skip
      }
    }

    if (parsedTokenAddress) setTokenAddress(parsedTokenAddress);
    if (parsedGovernorAddress) setGovernorAddress(parsedGovernorAddress);
    setDeploymentStep(DeploymentStep.COMPLETED);

    // Update Firestore with real token and governance addresses
    if (universeAddress && parsedTokenAddress && parsedGovernorAddress) {
      trpcClient.universes.finalizeTokenDeployment
        .mutate({
          universeId: universeAddress,
          tokenAddress: parsedTokenAddress,
          governanceAddress: parsedGovernorAddress,
          tokenDeployTxHash: hash,
        })
        .catch(() => {
          // Firestore finalization error is non-blocking; token was already deployed on-chain
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txSuccess, txReceipt, hash]);

  const handleCreateUniverse = async () => {
    if (!address) {
      alert('Please connect your wallet first');
      return;
    }

    // Trigger SIWE sign-in if wallet is connected but not authenticated
    if (!isAuthenticated) {
      try {
        await signIn();
      } catch {
        alert('Please sign the message in your wallet to continue');
        return;
      }
    }

    if (!isSupportedChain(chainId)) {
      alert('Wrong Network! Please switch to a supported network.');
      return;
    }

    if (!universeName || !imageUrl || !description) {
      alert('Please fill in universe name, image, and description');
      return;
    }

    if (launchTokenNow && !tokenSymbol) {
      alert('Please enter a token symbol or switch to "Launch Token Later"');
      return;
    }

    setDeploymentStep(DeploymentStep.CREATING_UNIVERSE);

    try {
      await createUniverse({
        name: universeName,
        imageURL: imageUrl,
        description: description,
        nodeCreationOptions: 0, // OPEN - anyone can create nodes
        nodeVisibilityOptions: 0, // PUBLIC - all nodes visible
        initialOwner: address as `0x${string}`,
        safeAddress: safeAddress ?? undefined,
      });
    } catch (error) {
      alert(
        `Universe creation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      setDeploymentStep(DeploymentStep.IDLE);
    }
  };

  const handleDeployTokenWithId = async (id: bigint) => {
    if (!address) return;
    if (!tokenSymbol) return;

    setDeploymentStep(DeploymentStep.DEPLOYING_TOKEN);

    try {
      await deployUniverseToken(
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
            tickIfToken0IsLoar: defaultConfig.defaultTickIfToken0IsLoar,
            tickSpacing: defaultConfig.defaultTickSpacing,
            poolData: defaultConfig.defaultPoolData as `0x${string}`,
          },
          lockerConfig: {
            locker: defaultConfig.defaultLocker,
            rewardAdmins: [address as `0x${string}`],
            rewardRecipients: [address as `0x${string}`],
            rewardBps: [10000],
            tickLower: [defaultConfig.defaultTickIfToken0IsLoar],
            tickUpper: [0],
            positionBps: [10000],
            lockerData: '0x' as `0x${string}`,
          },
          allocationConfig: {
            lpBps,
            creatorBps,
            treasuryBps,
            communityBps,
          },
        },
        id,
        parseEther('0.01')
      );
    } catch (error) {
      alert(`Token deployment failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setDeploymentStep(DeploymentStep.UNIVERSE_CREATED);
    }
  };

  const handleDeployToken = () => {
    if (!universeId) {
      alert('Universe must be created first');
      return;
    }
    handleDeployTokenWithId(universeId);
  };

  // Redirect to login if not authenticated (after all hooks)
  useEffect(() => {
    if (!isAuthenticated && !isAuthenticating && !isAutoConnecting) {
      navigate({ to: '/login', search: { redirect: '/cinematicUniverseCreate' } });
    }
  }, [isAuthenticated, isAuthenticating, isAutoConnecting, navigate]);

  // Wait for thirdweb to finish reconnecting the previously-connected wallet
  // before showing the connect prompt (avoids a flash of "Connect Your Wallet"
  // when the user is actually already connected).
  if (isAutoConnecting || isAuthenticating) {
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

  // Wrong network state
  if (!isSupportedChain(chainId)) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-50 px-6 py-4 bg-yellow-900/90 backdrop-blur-md border border-yellow-700 rounded-lg shadow-2xl">
          <p className="text-yellow-100 font-medium">
            Wrong Network! Please switch to a supported network.
          </p>
        </div>
        <Card className="w-full max-w-md">
          <CardContent className="text-center space-y-4 p-8">
            <AlertCircle className="h-16 w-16 mx-auto mb-4 text-yellow-600" />
            <h2 className="text-2xl font-bold">Wrong Network</h2>
            <p className="text-muted-foreground">Please switch to a supported network</p>
            <Button size="lg" onClick={handleSwitchNetwork}>
              <Rocket className="h-5 w-5 mr-2" />
              Switch Network
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
              {tokenAddress ? 'Universe Launched!' : 'Universe Created!'} 🚀
            </h2>
            <p className="text-muted-foreground text-lg">
              Your universe is now deployed on{' '}
              {CHAIN_NAMES[chainId as keyof typeof CHAIN_NAMES] ?? 'testnet'}
              {tokenAddress
                ? ' with governance token and liquidity pool'
                : '. You can launch a token anytime from your dashboard.'}
            </p>

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
                    <Sparkles className="h-5 w-5 mr-2" />
                    Launch Token Later
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
          <h1 className="text-2xl md:text-4xl font-bold mb-2">Launch Your Universe</h1>
          <p className="text-muted-foreground text-sm md:text-lg">
            Deploy a new cinematic universe with governance token and liquidity pool
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

                <div>
                  <Label htmlFor="universeName" className="text-sm font-semibold mb-2 block">
                    Universe Name
                  </Label>
                  <Input
                    id="universeName"
                    placeholder="e.g., Marvel Cinematic Universe"
                    value={universeName}
                    onChange={(e) => setUniverseName(e.target.value)}
                    disabled={deploymentStep !== DeploymentStep.IDLE}
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
                      <div className="flex gap-2">
                        <Select
                          value={coverModel}
                          onValueChange={setCoverModel}
                          disabled={deploymentStep !== DeploymentStep.IDLE}
                        >
                          <SelectTrigger className="h-11 flex-1 text-xs">
                            <SelectValue placeholder="Select model" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="fal-ai/nano-banana">Nano Banana</SelectItem>
                            <SelectItem value="fal-ai/nano-banana-2">Nano Banana 2</SelectItem>
                            <SelectItem value="fal-ai/nano-banana-pro">Nano Banana Pro</SelectItem>
                            <SelectItem value="fal-ai/flux/schnell">Flux Schnell</SelectItem>
                            <SelectItem value="fal-ai/flux/dev">Flux Dev</SelectItem>
                            <SelectItem value="fal-ai/flux-pro">Flux Pro</SelectItem>
                            <SelectItem value="fal-ai/flux-pro/v1.1">Flux Pro v1.1</SelectItem>
                            <SelectItem value="fal-ai/flux-2-pro">Flux 2 Pro</SelectItem>
                            <SelectItem value="fal-ai/flux-pro/kontext">
                              Flux Pro Kontext
                            </SelectItem>
                            <SelectItem value="fal-ai/recraft/v4/pro/text-to-image">
                              Recraft v4 Pro
                            </SelectItem>
                            <SelectItem value="fal-ai/ideogram/v3/generate">Ideogram v3</SelectItem>
                            <SelectItem value="fal-ai/wan/v2.7/text-to-image">Wan v2.7</SelectItem>
                            <SelectItem value="fal-ai/qwen-image">Qwen Image</SelectItem>
                          </SelectContent>
                        </Select>
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
                    disabled={deploymentStep !== DeploymentStep.IDLE}
                    className="min-h-[100px] resize-none"
                    maxLength={500}
                  />
                </div>

                {/* Token Launch Toggle */}
                <div className="p-4 rounded-lg border bg-muted/30 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold">Launch Token & Pool</p>
                      <p className="text-[10px] text-muted-foreground">
                        {launchTokenNow
                          ? 'Deploy governance token + liquidity pool at mint'
                          : 'Create universe first, launch token later from dashboard'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setLaunchTokenNow(!launchTokenNow)}
                      disabled={deploymentStep !== DeploymentStep.IDLE}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        launchTokenNow ? 'bg-primary' : 'bg-zinc-600'
                      } ${deploymentStep !== DeploymentStep.IDLE ? 'opacity-50' : ''}`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          launchTokenNow ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>

                  {launchTokenNow && (
                    <div>
                      <Label htmlFor="tokenSymbolMain" className="text-sm font-semibold mb-2 block">
                        Token Symbol
                      </Label>
                      <Input
                        id="tokenSymbolMain"
                        placeholder="e.g., MCU"
                        value={tokenSymbol}
                        onChange={(e) => setTokenSymbol(e.target.value.toUpperCase())}
                        disabled={deploymentStep !== DeploymentStep.IDLE}
                        maxLength={10}
                        className="h-11"
                      />
                    </div>
                  )}
                </div>

                {/* Multi-Sig Ownership (optional) */}
                <SafeSetup
                  disabled={deploymentStep !== DeploymentStep.IDLE}
                  onSafeDeployed={(addr) => setSafeAddress(addr as `0x${string}`)}
                  onDisabled={() => setSafeAddress(null)}
                />

                {deploymentStep === DeploymentStep.IDLE && (
                  <Button
                    onClick={handleCreateUniverse}
                    disabled={
                      !universeName ||
                      !imageUrl ||
                      !description ||
                      (launchTokenNow && !tokenSymbol) ||
                      isPending ||
                      isConfirming
                    }
                    className="w-full h-12 text-base font-bold"
                    size="lg"
                  >
                    {isPending || isConfirming ? (
                      <>
                        <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                        {launchTokenNow ? 'Creating Universe & Token...' : 'Creating Universe...'}
                      </>
                    ) : (
                      <>
                        <Rocket className="h-5 w-5 mr-2" />
                        {launchTokenNow ? 'Launch Universe + Token' : 'Create Universe'}
                      </>
                    )}
                  </Button>
                )}
              </div>

              {/* Step 2: Token Deployment (only shown when launching token with universe) */}
              {launchTokenNow && deploymentStep !== DeploymentStep.IDLE && (
                <div className="space-y-4 pt-4 border-t">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold">Step 2: Deploy Token & Pool</h3>
                    {(deploymentStep as DeploymentStep) === DeploymentStep.COMPLETED && (
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                    )}
                  </div>

                  <div>
                    <Label htmlFor="tokenSymbol" className="text-sm font-semibold mb-2 block">
                      Token Symbol
                    </Label>
                    <Input
                      id="tokenSymbol"
                      placeholder="e.g., MCU"
                      value={tokenSymbol}
                      onChange={(e) => setTokenSymbol(e.target.value.toUpperCase())}
                      disabled={
                        (deploymentStep as DeploymentStep) === DeploymentStep.TOKEN_DEPLOYED ||
                        (deploymentStep as DeploymentStep) === DeploymentStep.COMPLETED
                      }
                      maxLength={10}
                      className="h-11"
                    />
                  </div>

                  {/* Tokenomics Configuration */}
                  <div className="space-y-3">
                    <button
                      type="button"
                      onClick={() => setShowAdvancedTokenomics(!showAdvancedTokenomics)}
                      className="flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Sliders className="h-4 w-4" />
                      Token Allocation
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {showAdvancedTokenomics ? 'Custom' : 'Default'}
                      </Badge>
                    </button>

                    {showAdvancedTokenomics && (
                      <div className="space-y-4 p-4 bg-muted/50 rounded-lg border">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                          <Info className="h-3 w-3" />
                          <span>100B tokens total supply. Adjust how they're distributed.</span>
                        </div>

                        {/* Allocation Pie Visual */}
                        <div className="flex gap-2 h-3 rounded-full overflow-hidden mb-4">
                          <div
                            className="bg-blue-500 transition-all"
                            style={{ width: `${lpBps / 100}%` }}
                            title={`LP: ${lpBps / 100}%`}
                          />
                          <div
                            className="bg-green-500 transition-all"
                            style={{ width: `${creatorBps / 100}%` }}
                            title={`Creator: ${creatorBps / 100}%`}
                          />
                          <div
                            className="bg-purple-500 transition-all"
                            style={{ width: `${treasuryBps / 100}%` }}
                            title={`Treasury: ${treasuryBps / 100}%`}
                          />
                          <div
                            className="bg-amber-500 transition-all"
                            style={{ width: `${communityBps / 100}%` }}
                            title={`Community: ${communityBps / 100}%`}
                          />
                        </div>

                        {/* LP Allocation */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                              <Label className="text-xs font-medium">Liquidity Pool</Label>
                            </div>
                            <span className="text-xs font-bold tabular-nums">
                              {(lpBps / 100).toFixed(1)}%
                            </span>
                          </div>
                          <Slider
                            value={[lpBps]}
                            onValueChange={([v]) => handleAllocationChange('lp', v)}
                            min={5000}
                            max={9000}
                            step={100}
                            disabled={deploymentStep !== DeploymentStep.UNIVERSE_CREATED}
                          />
                          <p className="text-[10px] text-muted-foreground">
                            Locked forever. Higher = safer for buyers. Min 50%
                          </p>
                        </div>

                        {/* Creator Allocation */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
                              <Label className="text-xs font-medium">Creator</Label>
                            </div>
                            <span className="text-xs font-bold tabular-nums">
                              {(creatorBps / 100).toFixed(1)}%
                            </span>
                          </div>
                          <Slider
                            value={[creatorBps]}
                            onValueChange={([v]) => handleAllocationChange('creator', v)}
                            min={0}
                            max={4000}
                            step={100}
                            disabled={deploymentStep !== DeploymentStep.UNIVERSE_CREATED}
                          />
                          <p className="text-[10px] text-muted-foreground">
                            Your governance voting power from day 1. Max 40%
                          </p>
                        </div>

                        {/* Treasury Allocation */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className="w-2.5 h-2.5 rounded-full bg-purple-500" />
                              <Label className="text-xs font-medium">Protocol Treasury</Label>
                            </div>
                            <span className="text-xs font-bold tabular-nums">
                              {(treasuryBps / 100).toFixed(1)}%
                            </span>
                          </div>
                          <Slider
                            value={[treasuryBps]}
                            onValueChange={([v]) => handleAllocationChange('treasury', v)}
                            min={200}
                            max={2000}
                            step={100}
                            disabled={deploymentStep !== DeploymentStep.UNIVERSE_CREATED}
                          />
                          <p className="text-[10px] text-muted-foreground">
                            Protocol sustainability fee. Min 2%
                          </p>
                        </div>

                        {/* Community Allocation */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                              <Label className="text-xs font-medium">Community Rewards</Label>
                            </div>
                            <span className="text-xs font-bold tabular-nums">
                              {(communityBps / 100).toFixed(1)}%
                            </span>
                          </div>
                          <Slider
                            value={[communityBps]}
                            onValueChange={([v]) => handleAllocationChange('community', v)}
                            min={0}
                            max={3000}
                            step={100}
                            disabled={deploymentStep !== DeploymentStep.UNIVERSE_CREATED}
                          />
                          <p className="text-[10px] text-muted-foreground">
                            Airdrops, contests, contributor rewards
                          </p>
                        </div>

                        {/* Validation */}
                        {!allocationValid && (
                          <div className="flex items-center gap-2 p-2 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-500">
                            <AlertCircle className="h-3 w-3 flex-shrink-0" />
                            {allocationTotal !== 10000
                              ? `Total must equal 100% (currently ${(allocationTotal / 100).toFixed(1)}%)`
                              : lpBps < 5000
                                ? 'LP must be at least 50%'
                                : treasuryBps < 200
                                  ? 'Treasury must be at least 2%'
                                  : 'Creator cannot exceed 40%'}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Quick preview when collapsed */}
                    {!showAdvancedTokenomics && (
                      <div className="flex gap-3 text-[10px] text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-blue-500" /> LP {lpBps / 100}%
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-green-500" /> Creator{' '}
                          {creatorBps / 100}%
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-purple-500" /> Treasury{' '}
                          {treasuryBps / 100}%
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-amber-500" /> Community{' '}
                          {communityBps / 100}%
                        </span>
                      </div>
                    )}
                  </div>

                  {deploymentStep === DeploymentStep.UNIVERSE_CREATED && (
                    <Button
                      onClick={handleDeployToken}
                      disabled={!tokenSymbol || !allocationValid || isPending || isConfirming}
                      className="w-full h-12 text-base font-bold"
                      size="lg"
                    >
                      {isPending || isConfirming ? (
                        <>
                          <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                          Deploying Token...
                        </>
                      ) : (
                        <>
                          <Rocket className="h-5 w-5 mr-2" />
                          Deploy Token & Pool
                        </>
                      )}
                    </Button>
                  )}

                  {deploymentStep === DeploymentStep.DEPLOYING_TOKEN && (
                    <div className="p-4 bg-muted rounded-lg">
                      <div className="flex items-center gap-3">
                        <Loader2 className="h-5 w-5 text-primary animate-spin" />
                        <div>
                          <p className="text-sm font-semibold">
                            Deploying token and setting up liquidity pool...
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            This may take a few moments...
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
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
                    }}
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500">
                    <ImageIcon className="h-16 w-16 text-white/40" />
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-6">
                  <h3 className="text-2xl font-bold text-white drop-shadow-2xl mb-2">
                    {universeName || 'Your Universe Name'}
                  </h3>
                  {tokenSymbol && (
                    <Badge className="bg-white/20 backdrop-blur-sm text-white border-0">
                      ${tokenSymbol}
                    </Badge>
                  )}
                </div>
              </div>

              {/* Preview Content */}
              <div className="p-6 space-y-4 flex-1 overflow-y-auto">
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
                        {deploymentStep !== DeploymentStep.CREATING_UNIVERSE ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                        ) : (
                          <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        )}
                        <span
                          className={
                            deploymentStep !== DeploymentStep.CREATING_UNIVERSE
                              ? 'text-green-500 font-medium'
                              : ''
                          }
                        >
                          Universe Contract
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        {deploymentStep === DeploymentStep.DEPLOYING_TOKEN ||
                        deploymentStep === DeploymentStep.TOKEN_DEPLOYED ? (
                          <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        ) : (
                          <Loader2 className="h-4 w-4 opacity-40" />
                        )}
                        <span
                          className={
                            deploymentStep === DeploymentStep.DEPLOYING_TOKEN ||
                            deploymentStep === DeploymentStep.TOKEN_DEPLOYED
                              ? ''
                              : 'opacity-40'
                          }
                        >
                          Token & Liquidity Pool
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
