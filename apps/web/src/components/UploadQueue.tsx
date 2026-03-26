/**
 * Upload Queue Component
 *
 * Displays active/recent uploads with per-provider status and progress.
 */

import { useUploadQueue, type UploadJobStatus } from '@/hooks/useUploadQueue';

function ProviderBadge({ name, status }: { name: string; status: string }) {
  const colors: Record<string, string> = {
    completed: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    uploading: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    pending: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
    failed: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colors[status] || colors.pending}`}>
      {name}
    </span>
  );
}

function UploadJobCard({
  job,
  onRetry,
  onRemove,
}: {
  job: UploadJobStatus;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const statusColors: Record<string, string> = {
    pending: 'text-gray-500',
    uploading: 'text-blue-500',
    completed: 'text-green-500',
    failed: 'text-red-500',
  };

  return (
    <div className="border rounded-lg p-3 bg-card text-card-foreground">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium truncate max-w-[180px]">
          {job.filename}
        </span>
        <span className={`text-xs font-medium ${statusColors[job.status]}`}>
          {job.status === 'uploading' ? `${job.progress}%` : job.status}
        </span>
      </div>

      {/* Progress bar */}
      {(job.status === 'uploading' || job.status === 'pending') && (
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 mb-2">
          <div
            className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
            style={{ width: `${job.progress}%` }}
          />
        </div>
      )}

      {/* Provider badges */}
      {job.providers.length > 0 && (
        <div className="flex gap-1 flex-wrap mb-1">
          {job.providers.map((p) => (
            <ProviderBadge key={p.name} name={p.name} status={p.status} />
          ))}
        </div>
      )}

      {/* Error + retry */}
      {job.status === 'failed' && (
        <div className="mt-1">
          <p className="text-xs text-red-500 truncate">{job.error}</p>
          <button
            onClick={() => onRetry(job.id)}
            className="text-xs text-blue-500 hover:underline mt-1"
          >
            Retry
          </button>
        </div>
      )}

      {/* Completed — show content hash */}
      {job.status === 'completed' && job.manifest && (
        <p className="text-xs text-muted-foreground truncate">
          Hash: {job.manifest.contentHash.slice(0, 16)}...
        </p>
      )}
    </div>
  );
}

export function UploadQueue() {
  const { jobs, retryJob, removeJob, hasActiveUploads } = useUploadQueue();

  if (jobs.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 w-80 max-h-96 overflow-y-auto z-50 bg-background border rounded-xl shadow-lg p-3 space-y-2">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold">
          Uploads {hasActiveUploads && <span className="animate-pulse text-blue-500 ml-1">...</span>}
        </h3>
        <span className="text-xs text-muted-foreground">
          {jobs.length} {jobs.length === 1 ? 'job' : 'jobs'}
        </span>
      </div>
      {jobs.map((job) => (
        <UploadJobCard
          key={job.id}
          job={job}
          onRetry={retryJob}
          onRemove={removeJob}
        />
      ))}
    </div>
  );
}
