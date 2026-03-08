import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Plus, Trash2 } from "lucide-react";
import { WaveformIcon } from "./WaveformIcon";

interface SidebarProps {
  currentId: Id<"transcriptions"> | null;
  onSelect: (id: Id<"transcriptions">) => void;
  onNew: () => void;
}

const statusColors: Record<string, string> = {
  processing: "bg-yellow-400",
  completed: "bg-accent",
  error: "bg-error",
  uploading: "bg-blue-400",
};

export function Sidebar({ currentId, onSelect, onNew }: SidebarProps) {
  const transcriptions = useQuery(api.transcriptions.listTranscriptions);
  const deleteTranscription = useMutation(api.transcriptions.deleteTranscription);

  const handleDelete = async (e: React.MouseEvent, id: Id<"transcriptions">) => {
    e.stopPropagation();
    await deleteTranscription({ id });
    if (currentId === id) {
      onNew();
    }
  };

  return (
    <aside className="w-72 h-screen bg-surface border-r border-border flex flex-col shrink-0 p-6">
      {/* Logo */}
      <div className="pb-6 border-b border-border">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-accent rounded-lg flex items-center justify-center">
            <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5">
              <rect x="2" y="8" width="2" height="4" fill="#0a0a0a" rx="1" />
              <rect x="6" y="5" width="2" height="10" fill="#0a0a0a" rx="1" />
              <rect x="10" y="3" width="2" height="14" fill="#0a0a0a" rx="1" />
              <rect x="14" y="6" width="2" height="8" fill="#0a0a0a" rx="1" />
            </svg>
          </div>
          <div>
            <h1 className="text-sm font-medium tracking-wide uppercase text-text">
              Transcriber
            </h1>
            <div className="text-[11px] font-mono text-muted mt-0.5">audio → texto</div>
          </div>
        </div>
      </div>

      {/* New button */}
      <div className="py-5">
        <button
          onClick={onNew}
          className="w-full flex items-center justify-center gap-2.5 py-3.5 px-5 rounded-lg bg-accent text-bg text-sm font-semibold cursor-pointer transition-all hover:brightness-110 hover:-translate-y-px"
        >
          <Plus className="w-4 h-4" />
          Nova transcrição
        </button>
      </div>

      {/* History */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-2 py-3 mb-2">
          <span className="text-[10px] font-mono text-muted uppercase tracking-widest">
            Histórico
          </span>
        </div>

        {!transcriptions ? (
          <div className="flex justify-center py-12">
            <WaveformIcon animate />
          </div>
        ) : transcriptions.length === 0 ? (
          <div className="px-3 py-10 text-center">
            <p className="text-xs font-mono text-muted">Nenhuma transcrição ainda</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {transcriptions.map((t) => (
              <button
                key={t._id}
                onClick={() => onSelect(t._id)}
                className={`group w-full text-left px-4 py-3.5 rounded-lg transition-all cursor-pointer flex items-center gap-3.5 ${
                  currentId === t._id
                    ? "bg-accent-dim border border-accent/20"
                    : "hover:bg-surface-hover border border-transparent"
                }`}
              >
                <div
                  className={`w-2 h-2 rounded-full shrink-0 ${statusColors[t.status] ?? "bg-muted"}`}
                />
                <div className="flex-1 min-w-0">
                  <div
                    className={`text-sm truncate ${currentId === t._id ? "text-accent" : "text-text"}`}
                  >
                    {t.fileName}
                  </div>
                </div>
                <button
                  onClick={(e) => handleDelete(e, t._id)}
                  className="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-border transition-all cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5 text-muted hover:text-error" />
                </button>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer badge */}
      <div className="pt-6 border-t border-border">
        <div className="flex items-center justify-center">
          <span className="text-[11px] font-mono px-4 py-2 rounded-md bg-accent-dim text-accent border border-accent/20">
            Gemini AI
          </span>
        </div>
      </div>
    </aside>
  );
}
