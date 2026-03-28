/**
 * Direct Upload Component
 *
 * Drag-and-drop file upload to decentralized storage via /api/upload endpoint.
 * Shows real-time upload progress.
 */

import { useState, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { getSiweToken } from '@/lib/wallet-auth';

interface StorageManifest {
  contentHash: string;
  uploads: { provider: string; url: string; contentId: string; size: number }[];
  mimeType: string;
  size: number;
  createdAt: number;
}

interface DirectUploadProps {
  onUploadComplete: (manifest: StorageManifest, previewUrl: string) => void;
  acceptedTypes?: string[];
  maxSizeMB?: number;
  label?: string;
}

const DEFAULT_TYPES = [
  // Video
  'video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska',
  // Raster images
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/tiff', 'image/bmp',
  'image/avif', 'image/heic', 'image/heif', 'image/svg+xml',
  // Design formats
  'image/vnd.adobe.photoshop', 'image/x-xcf', 'application/postscript',
  // 3D models
  'model/gltf+json', 'model/gltf-binary', 'model/obj', 'model/stl',
  // Audio
  'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/flac', 'audio/aac',
  // Documents
  'application/pdf',
  // Proprietary art app formats (reported as application/octet-stream by browsers)
  '.blend', '.fbx', '.ma', '.mb', '.c4d', '.zpr', '.ztl', '.dae', '.abc', '.3ds', '.lwo',
  '.psd', '.psb', '.kra', '.clip', '.procreate', '.sketch', '.afdesign', '.afphoto', '.afpub', '.cdr',
  '.exr', '.hdr', '.tga', '.dds',
];

export function DirectUpload({
  onUploadComplete,
  acceptedTypes = DEFAULT_TYPES,
  maxSizeMB = 200,
  label = 'Drop a file here or click to upload',
}: DirectUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const getAuthToken = useCallback((): string | null => {
    return getSiweToken();
  }, []);

  const uploadFile = useCallback(
    async (file: File) => {
      const fileExt = '.' + (file.name.split('.').pop()?.toLowerCase() ?? '');
      const isOctetStream = file.type === 'application/octet-stream' || file.type === '';
      const mimeAccepted = acceptedTypes.includes(file.type);
      const extAccepted = isOctetStream && acceptedTypes.includes(fileExt);
      if (!mimeAccepted && !extAccepted) {
        toast.error('Unsupported file type', {
          description: `File type not allowed for upload`,
        });
        return;
      }

      if (file.size > maxSizeMB * 1024 * 1024) {
        toast.error('File too large', {
          description: `Maximum size: ${maxSizeMB}MB`,
        });
        return;
      }

      const token = getAuthToken();
      if (!token) {
        toast.error('Authentication required');
        return;
      }

      setIsUploading(true);
      setProgress(0);
      setFileName(file.name);

      try {
        const serverUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';

        const formData = new FormData();
        formData.append('file', file);

        // Use XMLHttpRequest for progress tracking
        const result = await new Promise<{ manifest: StorageManifest }>((resolve, reject) => {
          const xhr = new XMLHttpRequest();

          xhr.upload.addEventListener('progress', (event) => {
            if (event.lengthComputable) {
              const pct = Math.round((event.loaded / event.total) * 100);
              setProgress(pct);
            }
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
                reject(new Error(err.error || `HTTP ${xhr.status}`));
              } catch {
                reject(new Error(`HTTP ${xhr.status}`));
              }
            }
          });

          xhr.addEventListener('error', () => reject(new Error('Network error')));
          xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')));

          xhr.open('POST', `${serverUrl}/api/upload`);
          xhr.setRequestHeader('Authorization', `Bearer ${token}`);
          xhr.send(formData);
        });

        const previewUrl = URL.createObjectURL(file);
        onUploadComplete(result.manifest, previewUrl);

        toast.success('Upload complete!', {
          description: `Stored on ${result.manifest.uploads.map((u) => u.provider).join(', ')}`,
          duration: 4000,
        });
      } catch (err) {
        console.error('Direct upload failed:', err);
        toast.error('Upload failed', {
          description: err instanceof Error ? err.message : 'Unknown error',
        });
      } finally {
        setIsUploading(false);
        setProgress(0);
        setFileName(null);
      }
    },
    [acceptedTypes, maxSizeMB, getAuthToken, onUploadComplete]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) uploadFile(file);
    },
    [uploadFile]
  );

  const handleClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) uploadFile(file);
      // Reset so same file can be selected again
      e.target.value = '';
    },
    [uploadFile]
  );

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
      className={`
        relative cursor-pointer rounded-lg border-2 border-dashed p-6 text-center transition-colors
        ${
          isDragging
            ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
            : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
        }
        ${isUploading ? 'pointer-events-none opacity-70' : ''}
      `}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={acceptedTypes.join(',')}
        onChange={handleFileChange}
        className="hidden"
      />

      {isUploading ? (
        <div className="space-y-2">
          <p className="text-sm font-medium truncate">{fileName}</p>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Uploading to decentralized storage... {progress}%
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          <svg
            className="mx-auto h-8 w-8 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-xs text-muted-foreground">
            {acceptedTypes.map((t) => t.split('/')[1]).join(', ')} up to {maxSizeMB}MB
          </p>
        </div>
      )}
    </div>
  );
}
