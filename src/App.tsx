import { useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { FileUpload } from "./components/FileUpload";
import { TranscriptionView } from "./components/TranscriptionView";
import type { Id } from "../convex/_generated/dataModel";

function App() {
  const [currentTranscriptionId, setCurrentTranscriptionId] =
    useState<Id<"transcriptions"> | null>(null);

  const handleUploadComplete = (transcriptionId: string) => {
    setCurrentTranscriptionId(transcriptionId as Id<"transcriptions">);
  };

  const handleBack = () => {
    setCurrentTranscriptionId(null);
  };

  return (
    <div className="flex h-screen bg-bg">
      <Sidebar
        currentId={currentTranscriptionId}
        onSelect={setCurrentTranscriptionId}
        onNew={handleBack}
      />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto">
          {currentTranscriptionId ? (
            <TranscriptionView
              transcriptionId={currentTranscriptionId}
              onBack={handleBack}
            />
          ) : (
            <div className="space-y-18">
              <div>
                <h2 className="text-3xl font-semibold text-text mb-4">
                  Nova transcrição
                </h2>
                <p className="text-base font-mono text-muted">
                  Faça upload de um arquivo de áudio ou vídeo para transcrever
                </p>
              </div>
              <FileUpload onUploadComplete={handleUploadComplete} />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
