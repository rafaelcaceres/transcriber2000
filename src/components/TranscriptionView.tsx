import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useState } from "react";
import { Copy, Download, CheckCircle, XCircle, ArrowLeft } from "lucide-react";
import { WaveformIcon } from "./WaveformIcon";
import { ProgressBar } from "./ProgressBar";

function stageLabel(progress: number) {
  if (progress < 8) return "Preparando arquivo...";
  if (progress < 18) return "Enviando para o Gemini...";
  if (progress < 45) return "Processando áudio...";
  return "Transcrevendo...";
}

interface TranscriptionViewProps {
  transcriptionId: Id<"transcriptions">;
  onBack: () => void;
}

export function TranscriptionView({ transcriptionId, onBack }: TranscriptionViewProps) {
  const transcription = useQuery(api.transcriptions.getTranscription, {
    id: transcriptionId,
  });
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (transcription?.transcription) {
      await navigator.clipboard.writeText(transcription.transcription);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownload = () => {
    if (transcription?.transcription) {
      const blob = new Blob([transcription.transcription], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${transcription.fileName.replace(/\.[^/.]+$/, "")}_transcricao.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  if (!transcription) {
    return (
      <div className="bg-surface border border-border rounded-xl p-14 text-center animate-fade-in">
        <div className="flex justify-center mb-6">
          <WaveformIcon animate />
        </div>
        <div className="text-sm font-mono text-muted">Carregando...</div>
      </div>
    );
  }

  return (
    <div className="space-y-10 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-5">
        <button
          onClick={onBack}
          className="p-3 rounded-lg border border-border text-muted hover:text-text hover:border-border-hover transition-all cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-2xl font-medium text-text truncate">
            {transcription.fileName}
          </h2>
          <div className="text-sm font-mono text-muted mt-1.5">
            {transcription.mimeType}
          </div>
        </div>
      </div>

      {/* Processing state */}
      {transcription.status === "processing" && (
        <div className="bg-surface border border-border rounded-2xl p-12 animate-fade-in">
          <div className="flex justify-center mb-8">
            <WaveformIcon animate />
          </div>
          <div className="max-w-md mx-auto">
            <ProgressBar
              value={transcription.progress ?? 0}
              label={stageLabel(transcription.progress ?? 0)}
            />
            <div className="text-sm font-mono text-muted/40 mt-5 text-center">
              Áudios longos podem levar alguns minutos. Pode fechar a aba — a
              transcrição continua em segundo plano.
            </div>
          </div>

          {/* Live preview of the transcript as it streams in */}
          {transcription.transcription && (
            <div className="mt-10 pt-8 border-t border-border">
              <p className="text-sm leading-7 text-text-secondary/70 whitespace-pre-wrap font-light max-h-64 overflow-y-auto">
                {transcription.transcription}
                <span className="inline-block w-1.5 h-4 ml-0.5 -mb-0.5 bg-accent animate-pulse" />
              </p>
            </div>
          )}
        </div>
      )}

      {/* Completed */}
      {transcription.status === "completed" && transcription.transcription && (
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          {/* Transcript header */}
          <div className="flex items-center justify-between px-8 py-6 border-b border-border">
            <div className="flex items-center gap-3 text-sm font-mono text-accent uppercase tracking-widest">
              <div className="w-2.5 h-2.5 bg-accent rounded-full" />
              Transcrição
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleCopy}
                className="flex items-center gap-2.5 text-sm font-mono px-5 py-2.5 rounded-lg border border-border text-muted hover:border-accent/30 hover:text-accent transition-all cursor-pointer"
              >
                {copied ? (
                  <CheckCircle className="w-4 h-4 text-accent" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
                {copied ? "copiado" : "copiar"}
              </button>
              <button
                onClick={handleDownload}
                className="flex items-center gap-2.5 text-sm font-mono px-5 py-2.5 rounded-lg border border-border text-muted hover:border-accent/30 hover:text-accent transition-all cursor-pointer"
              >
                <Download className="w-4 h-4" />
                download
              </button>
            </div>
          </div>

          {/* Transcript body */}
          <div className="p-10">
            <p className="text-base leading-8 text-text-secondary whitespace-pre-wrap font-light">
              {transcription.transcription}
            </p>
          </div>

          {/* Word count footer */}
          <div className="px-10 py-5 border-t border-border">
            <span className="text-xs font-mono text-muted">
              {transcription.transcription.trim().split(/\s+/).length} palavras ·{" "}
              {transcription.transcription.length} caracteres
            </span>
          </div>
        </div>
      )}

      {/* Error state */}
      {transcription.status === "error" && (
        <div className="bg-error/8 border border-error/20 rounded-2xl p-14 text-center animate-fade-in">
          <XCircle className="w-10 h-10 text-error mx-auto mb-5" />
          <div className="text-base font-medium text-error">Falha na transcrição</div>
          {transcription.errorMessage && (
            <div className="text-sm font-mono text-muted mt-4">
              {transcription.errorMessage}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
