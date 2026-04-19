/**
 * Revenue hooks — connects frontend to all revenue stream tRPC endpoints
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';

// ---- Episode NFTs ----

export function useEpisodeNFTs(universeId: string) {
  return useQuery({
    queryKey: ['episode-nfts', universeId],
    queryFn: () => trpcClient.nft.getEpisodesByUniverse.query({ universeId }),
    enabled: !!universeId,
  });
}

export function useCreateEpisodeListing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof trpcClient.nft.createEpisodeListing.mutate>[0]) =>
      trpcClient.nft.createEpisodeListing.mutate(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['episode-nfts'] }),
  });
}

export function useBatchCreateEpisodeListings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof trpcClient.nft.batchCreateEpisodeListing.mutate>[0]) =>
      trpcClient.nft.batchCreateEpisodeListing.mutate(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['episode-nfts'] }),
  });
}

export function useMyNFTs() {
  return useQuery({
    queryKey: ['my-nfts'],
    queryFn: () => trpcClient.nft.getMyNFTs.query(),
  });
}

export function useCharacterNFTs(universeId: string) {
  return useQuery({
    queryKey: ['character-nfts', universeId],
    queryFn: () => trpcClient.nft.getCharactersByUniverse.query({ universeId }),
    enabled: !!universeId,
  });
}

export function useCreateCharacterNFT() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof trpcClient.nft.createCharacterNFT.mutate>[0]) =>
      trpcClient.nft.createCharacterNFT.mutate(input),
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['character-nfts', vars.universeId] }),
  });
}

export function useMintContent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof trpcClient.nft.mintContent.mutate>[0]) =>
      trpcClient.nft.mintContent.mutate(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-nfts'] });
      qc.invalidateQueries({ queryKey: ['episode-nfts'] });
    },
  });
}

export function useRecordMint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof trpcClient.nft.recordMint.mutate>[0]) =>
      trpcClient.nft.recordMint.mutate(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-nfts'] }),
  });
}

// ---- Canon Marketplace ----

export function useCanonSubmissions(
  universeId: string,
  status: 'VOTING' | 'ACCEPTED' | 'REJECTED' | 'ALL' = 'ALL'
) {
  return useQuery({
    queryKey: ['canon-submissions', universeId, status],
    queryFn: () => trpcClient.marketplace.getByUniverse.query({ universeId, status }),
    enabled: !!universeId,
  });
}

export function useSubmitCanon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof trpcClient.marketplace.submit.mutate>[0]) =>
      trpcClient.marketplace.submit.mutate(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['canon-submissions'] }),
  });
}

export function useVoteCanon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof trpcClient.marketplace.vote.mutate>[0]) =>
      trpcClient.marketplace.vote.mutate(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['canon-submissions'] }),
  });
}

export function useCanon(universeId: string) {
  return useQuery({
    queryKey: ['canon', universeId],
    queryFn: () => trpcClient.marketplace.getCanon.query({ universeId }),
    enabled: !!universeId,
  });
}

export function useFinalizeCanon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof trpcClient.marketplace.finalize.mutate>[0]) =>
      trpcClient.marketplace.finalize.mutate(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['canon-submissions'] });
      qc.invalidateQueries({ queryKey: ['canon'] });
    },
  });
}

export function useLicenseCanon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof trpcClient.marketplace.licenseCanon.mutate>[0]) =>
      trpcClient.marketplace.licenseCanon.mutate(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['canon'] });
      qc.invalidateQueries({ queryKey: ['canon-submissions'] });
    },
  });
}

// ---- Credits ----

export function useCreditBalance() {
  const { isAuthenticated } = useWalletAuth();
  return useQuery({
    queryKey: ['credit-balance'],
    queryFn: () => trpcClient.credits.getBalance.query(),
    enabled: isAuthenticated,
  });
}

export function useCreditTiers() {
  return useQuery({
    queryKey: ['credit-tiers'],
    queryFn: () => trpcClient.credits.getPackages.query(),
  });
}

export function usePurchaseCredits() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof trpcClient.credits.purchaseWithFiat.mutate>[0]) =>
      trpcClient.credits.purchaseWithFiat.mutate(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['credit-balance'] }),
  });
}

export function useSpendCredits() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof trpcClient.credits.spend.mutate>[0]) =>
      trpcClient.credits.spend.mutate(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['credit-balance'] }),
  });
}

export function useCreditHistory(limit = 20) {
  return useQuery({
    queryKey: ['credit-history', limit],
    queryFn: () => trpcClient.credits.getHistory.query({ limit }),
  });
}

// ---- Subscriptions ----

export function useSubscriptionTiers(universeId: string) {
  return useQuery({
    queryKey: ['sub-tiers', universeId],
    queryFn: () => trpcClient.subscriptions.getTiers.query({ universeId }),
    enabled: !!universeId,
  });
}

export function useSubscribe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof trpcClient.subscriptions.subscribe.mutate>[0]) =>
      trpcClient.subscriptions.subscribe.mutate(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-subs'] }),
  });
}

export function useMySubscriptions() {
  return useQuery({
    queryKey: ['my-subs'],
    queryFn: () => trpcClient.subscriptions.mySubscriptions.query(),
  });
}

export function useUniverseSubStats(universeId: string) {
  return useQuery({
    queryKey: ['sub-stats', universeId],
    queryFn: () => trpcClient.subscriptions.getUniverseStats.query({ universeId }),
    enabled: !!universeId,
  });
}

// ---- Collabs ----

export function useUniverseCollabs(universeId: string) {
  return useQuery({
    queryKey: ['collabs', universeId],
    queryFn: () => trpcClient.collabs.getByUniverse.query({ universeId }),
    enabled: !!universeId,
  });
}

export function useProposeCollab() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof trpcClient.collabs.propose.mutate>[0]) =>
      trpcClient.collabs.propose.mutate(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['collabs'] });
      qc.invalidateQueries({ queryKey: ['my-collabs'] });
    },
  });
}

export function useMyCollabs(enabled = true) {
  return useQuery({
    queryKey: ['my-collabs'],
    queryFn: () => trpcClient.collabs.myCollabs.query(),
    enabled,
  });
}

export function useCollab(collabId: string) {
  return useQuery({
    queryKey: ['collab', collabId],
    queryFn: () => trpcClient.collabs.getCollab.query({ collabId }),
    enabled: !!collabId,
  });
}

export function useCollabEpisodes(collabId: string) {
  return useQuery({
    queryKey: ['collab-episodes', collabId],
    queryFn: () => trpcClient.collabs.getEpisodes.query({ collabId }),
    enabled: !!collabId,
  });
}

export function useAcceptCollab() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof trpcClient.collabs.accept.mutate>[0]) =>
      trpcClient.collabs.accept.mutate(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['collabs'] });
      qc.invalidateQueries({ queryKey: ['my-collabs'] });
    },
  });
}

export function useActivateCollab() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof trpcClient.collabs.activate.mutate>[0]) =>
      trpcClient.collabs.activate.mutate(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['collabs'] });
      qc.invalidateQueries({ queryKey: ['my-collabs'] });
    },
  });
}

export function useCancelCollab() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof trpcClient.collabs.cancel.mutate>[0]) =>
      trpcClient.collabs.cancel.mutate(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['collabs'] });
      qc.invalidateQueries({ queryKey: ['my-collabs'] });
    },
  });
}

export function useCompleteCollab() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof trpcClient.collabs.complete.mutate>[0]) =>
      trpcClient.collabs.complete.mutate(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['collabs'] });
      qc.invalidateQueries({ queryKey: ['my-collabs'] });
    },
  });
}

// ---- Ads ----

export function useAdSlots(universeId: string) {
  return useQuery({
    queryKey: ['ad-slots', universeId],
    queryFn: () => trpcClient.ads.getSlotsByUniverse.query({ universeId }),
    enabled: !!universeId,
  });
}

export function useAdSlot(slotId: string) {
  return useQuery({
    queryKey: ['ad-slot', slotId],
    queryFn: () => trpcClient.ads.getSlot.query({ slotId }),
    enabled: !!slotId,
  });
}

export function useAdBids(slotId: string) {
  return useQuery({
    queryKey: ['ad-bids', slotId],
    queryFn: () => trpcClient.ads.getBids.query({ slotId }),
    enabled: !!slotId,
  });
}

export function useUniverseSponsorships(universeId: string) {
  return useQuery({
    queryKey: ['universe-sponsorships', universeId],
    queryFn: () => trpcClient.ads.getSponsorships.query({ universeId }),
    enabled: !!universeId,
  });
}

export function useCreateAdSlot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof trpcClient.ads.createSlot.mutate>[0]) =>
      trpcClient.ads.createSlot.mutate(input),
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['ad-slots', vars.universeId] }),
  });
}

export function usePlaceBid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof trpcClient.ads.placeBid.mutate>[0]) =>
      trpcClient.ads.placeBid.mutate(input),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['ad-slots'] });
      qc.invalidateQueries({ queryKey: ['ad-bids', vars.slotId] });
    },
  });
}

export function useAcceptBid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof trpcClient.ads.acceptBid.mutate>[0]) =>
      trpcClient.ads.acceptBid.mutate(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ad-slots'] });
      qc.invalidateQueries({ queryKey: ['ad-bids'] });
      qc.invalidateQueries({ queryKey: ['universe-sponsorships'] });
    },
  });
}

export function useMySponsorships() {
  const { isAuthenticated } = useWalletAuth();
  return useQuery({
    queryKey: ['my-sponsorships'],
    queryFn: () => trpcClient.ads.mySponsorships.query(),
    enabled: isAuthenticated,
  });
}

// ---- Ad Seeds (Seed Dance) ----

export function useAdSeeds(status?: string, seedType?: string) {
  return useQuery({
    queryKey: ['ad-seeds', status, seedType],
    queryFn: () =>
      trpcClient.adSeeds.list.query({
        status: status as any,
        seedType: seedType as any,
      }),
  });
}

export function useAdSeed(seedId: string) {
  return useQuery({
    queryKey: ['ad-seed', seedId],
    queryFn: () => trpcClient.adSeeds.get.query({ seedId }),
    enabled: !!seedId,
  });
}

export function useAdSeedPlacements(seedId: string) {
  return useQuery({
    queryKey: ['ad-seed-placements', seedId],
    queryFn: () => trpcClient.adSeeds.placements.query({ seedId }),
    enabled: !!seedId,
  });
}

export function useAdSeedStats() {
  return useQuery({
    queryKey: ['ad-seed-stats'],
    queryFn: () => trpcClient.adSeeds.stats.query(),
  });
}

export function useMyAdSeeds() {
  const { isAuthenticated } = useWalletAuth();
  return useQuery({
    queryKey: ['my-ad-seeds'],
    queryFn: () => trpcClient.adSeeds.mySeeds.query(),
    enabled: isAuthenticated,
  });
}

export function useMyAdSeedPlacements() {
  const { isAuthenticated } = useWalletAuth();
  return useQuery({
    queryKey: ['my-ad-seed-placements'],
    queryFn: () => trpcClient.adSeeds.myPlacements.query(),
    enabled: isAuthenticated,
  });
}

export function useCreateAdSeed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof trpcClient.adSeeds.create.mutate>[0]) =>
      trpcClient.adSeeds.create.mutate(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ad-seeds'] });
      qc.invalidateQueries({ queryKey: ['my-ad-seeds'] });
    },
  });
}

export function useSubmitAdSeedPlacement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof trpcClient.adSeeds.submitPlacement.mutate>[0]) =>
      trpcClient.adSeeds.submitPlacement.mutate(input),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['ad-seed-placements', vars.seedId] });
      qc.invalidateQueries({ queryKey: ['ad-seed', vars.seedId] });
      qc.invalidateQueries({ queryKey: ['my-ad-seed-placements'] });
    },
  });
}

export function useApproveAdSeedPlacement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof trpcClient.adSeeds.approvePlacement.mutate>[0]) =>
      trpcClient.adSeeds.approvePlacement.mutate(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ad-seed-placements'] });
      qc.invalidateQueries({ queryKey: ['ad-seeds'] });
      qc.invalidateQueries({ queryKey: ['my-ad-seeds'] });
    },
  });
}

export function useRejectAdSeedPlacement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof trpcClient.adSeeds.rejectPlacement.mutate>[0]) =>
      trpcClient.adSeeds.rejectPlacement.mutate(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ad-seed-placements'] });
      qc.invalidateQueries({ queryKey: ['ad-seeds'] });
    },
  });
}

// ---- Licensing ----

export function useUniverseLicenses(universeId: string) {
  return useQuery({
    queryKey: ['licenses', universeId],
    queryFn: () => trpcClient.licensing.getLicenses.query({ universeId }),
    enabled: !!universeId,
  });
}

export function useMyLicenses(limit = 50) {
  const { isAuthenticated } = useWalletAuth();
  return useQuery({
    queryKey: ['my-licenses', limit],
    queryFn: () => trpcClient.licensing.myLicenses.query({ limit }),
    enabled: isAuthenticated,
  });
}

export function useCreateLicense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof trpcClient.licensing.createLicense.mutate>[0]) =>
      trpcClient.licensing.createLicense.mutate(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['licenses'] }),
  });
}

export function useActivateLicense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof trpcClient.licensing.activateLicense.mutate>[0]) =>
      trpcClient.licensing.activateLicense.mutate(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['licenses'] }),
  });
}

export function useRevokeLicense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof trpcClient.licensing.revokeLicense.mutate>[0]) =>
      trpcClient.licensing.revokeLicense.mutate(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['licenses'] }),
  });
}

export function useMerchOrders(limit = 20) {
  return useQuery({
    queryKey: ['merch-orders', limit],
    queryFn: () => trpcClient.licensing.getOrders.query({ limit }),
  });
}

export function useMyMerch() {
  return useQuery({
    queryKey: ['my-merch'],
    queryFn: () => trpcClient.licensing.myMerch.query(),
  });
}

// ---- Merch ----

export function useUniverseMerch(universeId: string) {
  return useQuery({
    queryKey: ['merch', universeId],
    queryFn: () => trpcClient.licensing.getMerch.query({ universeId }),
    enabled: !!universeId,
  });
}

export function useCreateMerch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof trpcClient.licensing.createMerch.mutate>[0]) =>
      trpcClient.licensing.createMerch.mutate(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['merch'] }),
  });
}

export function usePurchaseMerch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof trpcClient.licensing.purchaseMerch.mutate>[0]) =>
      trpcClient.licensing.purchaseMerch.mutate(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['merch'] }),
  });
}

// ---- Analytics ----

export function useUniverseMetrics(universeId: string) {
  return useQuery({
    queryKey: ['universe-metrics', universeId],
    queryFn: () => trpcClient.analytics.getUniverseMetrics.query({ universeId }),
    enabled: !!universeId,
  });
}

export function useRecordView() {
  return useMutation({
    mutationFn: (input: Parameters<typeof trpcClient.analytics.recordView.mutate>[0]) =>
      trpcClient.analytics.recordView.mutate(input),
  });
}

export function useTrending(limit = 10) {
  return useQuery({
    queryKey: ['trending', limit],
    queryFn: () => trpcClient.analytics.getTrending.query({ limit }),
  });
}

export function usePlatformStats() {
  return useQuery({
    queryKey: ['platform-stats'],
    queryFn: () => trpcClient.analytics.getPlatformStats.query(),
  });
}
