/**
 * Upload Queue Hook
 *
 * Manages file uploads via the unified storage service with status polling.
 */

import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';

export interface UploadJobStatus {
  id: string;
  userId: string;
  status: 'pending' | 'uploading' | 'completed' | 'failed';
  progress: number;
  filename: string;
  mimeType: string;
  manifest?: {
    contentHash: string;
    uploads: { provider: string; url: string; contentId: string }[];
    size: number;
  };
  error?: string;
  providers: { name: string; status: string; url?: string }[];
  createdAt: number;
  updatedAt: number;
}

/**
 * Manages async file uploads with status polling.
 * Tracks active upload jobs, polls their status every 2 seconds, and
 * auto-removes completed jobs after 10 seconds.
 *
 * @returns `{ jobs, activeJobIds, uploadFromUrl, retryJob, removeJob, hasActiveUploads }`
 */
export function useUploadQueue() {
  const [activeJobIds, setActiveJobIds] = useState<string[]>([]);

  /**
   * Initiates an async upload from a URL via the storage tRPC endpoint.
   * @param url - Source URL of the file to upload
   * @param filename - Optional filename override
   * @returns The job ID for status polling
   */
  const uploadFromUrl = useCallback(async (url: string, filename?: string) => {
    const result = await trpcClient.storage.uploadAsync.mutate({
      url,
      filename,
    });
    setActiveJobIds((prev) => [...prev, result.jobId]);
    return result.jobId;
  }, []);

  /**
   * Retries a failed upload job.
   * @param jobId - The job ID to retry
   */
  const retryJob = useCallback(async (jobId: string) => {
    await trpcClient.storage.retryUpload.mutate({ jobId });
  }, []);

  /**
   * Removes a job from the active polling list (does not cancel the server-side job).
   * @param jobId - The job ID to stop tracking
   */
  const removeJob = useCallback((jobId: string) => {
    setActiveJobIds((prev) => prev.filter((id) => id !== jobId));
  }, []);

  // Poll active job statuses
  const { data: jobStatuses } = useQuery({
    queryKey: ['uploadJobs', activeJobIds],
    queryFn: async () => {
      if (activeJobIds.length === 0) return [];
      const results = await Promise.all(
        activeJobIds.map((id) => trpcClient.storage.uploadStatus.query({ jobId: id }))
      );
      return results.filter(Boolean) as UploadJobStatus[];
    },
    refetchInterval: activeJobIds.length > 0 ? 2000 : false,
    enabled: activeJobIds.length > 0,
  });

  // Auto-remove completed jobs from polling after a delay
  const completedJobs = jobStatuses?.filter((j) => j.status === 'completed') || [];
  if (completedJobs.length > 0) {
    setTimeout(() => {
      setActiveJobIds((prev) => prev.filter((id) => !completedJobs.some((j) => j.id === id)));
    }, 10_000);
  }

  return {
    jobs: jobStatuses || [],
    activeJobIds,
    uploadFromUrl,
    retryJob,
    removeJob,
    hasActiveUploads: activeJobIds.length > 0,
  };
}
