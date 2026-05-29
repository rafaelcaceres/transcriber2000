import { useState, useCallback, useRef } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { WaveformIcon } from "./WaveformIcon";
import { ProgressBar } from "./ProgressBar";

// POST the file with real upload progress (fetch can't report this).
function uploadWithProgress(
  url: string,
  file: File,
  onProgress: (fraction: number) => void
): Promise<{ storageId: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        reject(new Error("Upload falhou"));
      }
    };
    xhr.onerror = () => reject(new Error("Upload falhou"));
    xhr.send(file);
  });
}

// Read the media duration (seconds) straight from the browser — no ffmpeg
// needed server-side. The action uses it to slice the transcription into time
// windows. Resolves undefined if the format doesn't expose a finite duration
// (e.g. some streamed webm), in which case the server falls back to probing.
function getMediaDuration(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement(
      file.type.startsWith("video/") ? "video" : "audio"
    );
    el.preload = "metadata";
    const done = (value: number | undefined) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    el.onloadedmetadata = () =>
      done(Number.isFinite(el.duration) && el.duration > 0 ? el.duration : undefined);
    el.onerror = () => done(undefined);
    el.src = url;
  });
}

interface FileUploadProps {
  onUploadComplete: (transcriptionId: string) => void;
}

const ACCEPTED_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/webm",
  "audio/ogg",
  "audio/flac",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "video/mp4",
  "video/webm",
];

const FORMAT_TAGS = ["MP3", "WAV", "OGG", "WEBM", "MP4", "FLAC"];

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileUpload({ onUploadComplete }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const generateUploadUrl = useMutation(api.transcriptions.generateUploadUrl);
  const createTranscription = useMutation(api.transcriptions.createTranscription);

  const handleUpload = useCallback(
    async (file: File) => {
      setError(null);

      if (!ACCEPTED_TYPES.includes(file.type)) {
        setError("Formato não suportado. Use MP3, WAV, OGG, WEBM, MP4 ou FLAC.");
        return;
      }

      setSelectedFile(file);
      setUploadProgress(0);
      setIsUploading(true);

      try {
        // Read duration in parallel with the upload — it never blocks it.
        const durationPromise = getMediaDuration(file);
        const uploadUrl = await generateUploadUrl();

        const { storageId } = await uploadWithProgress(uploadUrl, file, (f) =>
          setUploadProgress(f * 100)
        );

        const transcriptionId = await createTranscription({
          fileName: file.name,
          fileId: storageId as Id<"_storage">,
          mimeType: file.type,
          durationSeconds: await durationPromise,
        });

        onUploadComplete(transcriptionId);
      } catch (err) {
        console.error("Upload error:", err);
        setError("Falha no upload. Tente novamente.");
      } finally {
        setIsUploading(false);
      }
    },
    [generateUploadUrl, createTranscription, onUploadComplete]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleUpload(file);
    },
    [handleUpload]
  );

  if (isUploading && selectedFile) {
    const done = uploadProgress >= 100;
    return (
      <div className="bg-surface border border-border rounded-xl p-14 animate-fade-in">
        <div className="flex justify-center mb-8">
          <WaveformIcon animate />
        </div>
        <div className="max-w-md mx-auto">
          <ProgressBar
            value={uploadProgress}
            label={done ? "Finalizando envio..." : "Enviando arquivo..."}
          />
          <div className="text-xs font-mono text-muted/50 mt-4 text-center">
            {selectedFile.name} · {formatSize(selectedFile.size)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div
        className={cn(
          "relative border rounded-2xl py-20 px-16 text-center cursor-pointer transition-all overflow-hidden bg-surface",
          isDragging
            ? "border-accent/35 bg-[#131313]"
            : "border-border hover:border-accent/35 hover:bg-[#131313]"
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        {/* Glow effect */}
        <div
          className={cn(
            "absolute inset-0 pointer-events-none transition-opacity duration-300",
            isDragging ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          )}
          style={{
            background:
              "radial-gradient(ellipse at 50% 0%, var(--color-accent-glow) 0%, transparent 70%)",
          }}
        />

        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept={ACCEPTED_TYPES.join(",")}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleUpload(file);
          }}
        />

        <div className="relative z-10">
          {/* Music icon */}
          <div className="w-18 h-18 mx-auto mb-8 bg-surface-hover border border-border rounded-2xl flex items-center justify-center">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="text-accent"
            >
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
          </div>

          <div className="text-lg font-medium text-text mb-3">
            Arraste um arquivo de áudio
          </div>
          <div className="text-sm font-mono text-muted mt-1">
            ou clique para selecionar do computador
          </div>

          {/* Format tags */}
          <div className="flex gap-2.5 justify-center flex-wrap mt-10">
            {FORMAT_TAGS.map((f) => (
              <span
                key={f}
                className="text-[11px] font-mono px-3.5 py-1.5 bg-surface-hover border border-border rounded-md text-muted"
              >
                {f}
              </span>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-error/8 border border-error/20 rounded-lg px-6 py-5 text-xs font-mono text-error animate-fade-in">
          ⚠ {error}
        </div>
      )}
    </div>
  );
}
