import { useState, useRef, useCallback } from "react";

const SUPPORTED_FORMATS = ["audio/mp3", "audio/mpeg", "audio/wav", "audio/ogg", "audio/webm", "audio/mp4", "audio/flac"];

function WaveformIcon({ animate }) {
  const bars = [3, 6, 9, 12, 8, 5, 10, 7, 4, 11, 6, 9, 3, 7, 5];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "2px", height: "24px" }}>
      {bars.map((h, i) => (
        <div
          key={i}
          style={{
            width: "3px",
            height: animate ? `${h + Math.random() * 6}px` : `${h}px`,
            background: "var(--accent)",
            borderRadius: "2px",
            transition: animate ? "height 0.15s ease" : "height 0.3s ease",
            animation: animate ? `pulse ${0.4 + (i % 3) * 0.15}s ease-in-out infinite alternate` : "none",
          }}
        />
      ))}
    </div>
  );
}

export default function AudioTranscriber() {
  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const inputRef = useRef();

  const handleFile = (f) => {
    if (!f) return;
    setError("");
    setTranscript("");
    if (!SUPPORTED_FORMATS.includes(f.type) && !f.name.match(/\.(mp3|wav|ogg|webm|mp4|flac|m4a)$/i)) {
      setError("Formato não suportado. Use MP3, WAV, OGG, WEBM, MP4 ou FLAC.");
      return;
    }
    setFile(f);
  };

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    handleFile(f);
  }, []);

  const transcribe = async () => {
    if (!file) return;
    setLoading(true);
    setError("");
    setTranscript("");

    try {
      const base64 = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res(reader.result.split(",")[1]);
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });

      const mediaType = file.type || "audio/mpeg";

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Transcreva com precisão todo o conteúdo de fala deste arquivo de áudio. Retorne apenas a transcrição, sem introduções ou comentários adicionais. Mantenha pontuação natural. Se houver múltiplos falantes, indique com [Falante 1], [Falante 2], etc.",
                },
                {
                  type: "document",
                  source: {
                    type: "base64",
                    media_type: mediaType,
                    data: base64,
                  },
                },
              ],
            },
          ],
        }),
      });

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error.message || "Erro na API");
      }

      const text = data.content?.map((b) => b.text || "").join("") || "";
      setTranscript(text);
    } catch (err) {
      setError(err.message || "Erro ao transcrever. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(transcript).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const reset = () => {
    setFile(null);
    setTranscript("");
    setError("");
  };

  const formatSize = (bytes) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500&family=Space+Grotesk:wght@300;400;500;600&display=swap');
        
        :root {
          --bg: #0a0a0a;
          --surface: #111111;
          --border: #1e1e1e;
          --border-hover: #2a2a2a;
          --text: #e8e8e8;
          --muted: #555;
          --accent: #d4f542;
          --accent-dim: rgba(212, 245, 66, 0.12);
          --accent-glow: rgba(212, 245, 66, 0.06);
          --error: #ff4d4d;
        }
        
        * { box-sizing: border-box; margin: 0; padding: 0; }
        
        body {
          background: var(--bg);
          color: var(--text);
          font-family: 'Space Grotesk', sans-serif;
          min-height: 100vh;
        }
        
        @keyframes pulse {
          from { opacity: 0.6; }
          to { opacity: 1; }
        }
        
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        @keyframes shimmer {
          0% { background-position: -200% center; }
          100% { background-position: 200% center; }
        }

        .container {
          max-width: 720px;
          margin: 0 auto;
          padding: 60px 24px;
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          gap: 32px;
        }
        
        .header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
        }
        
        .logo {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        
        .logo-mark {
          width: 36px;
          height: 36px;
          background: var(--accent);
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        
        .logo-mark svg {
          width: 20px;
          height: 20px;
        }
        
        h1 {
          font-size: 15px;
          font-weight: 500;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: var(--text);
        }
        
        .subtitle {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 11px;
          color: var(--muted);
          margin-top: 2px;
        }
        
        .badge {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10px;
          background: var(--accent-dim);
          color: var(--accent);
          padding: 4px 10px;
          border-radius: 4px;
          border: 1px solid rgba(212, 245, 66, 0.2);
        }
        
        .drop-zone {
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 48px 32px;
          text-align: center;
          cursor: pointer;
          transition: all 0.2s ease;
          background: var(--surface);
          position: relative;
          overflow: hidden;
        }
        
        .drop-zone::before {
          content: '';
          position: absolute;
          inset: 0;
          background: radial-gradient(ellipse at 50% 0%, var(--accent-glow) 0%, transparent 70%);
          opacity: 0;
          transition: opacity 0.3s;
        }
        
        .drop-zone:hover::before,
        .drop-zone.drag::before {
          opacity: 1;
        }
        
        .drop-zone:hover,
        .drop-zone.drag {
          border-color: rgba(212, 245, 66, 0.35);
          background: #131313;
        }
        
        .drop-icon {
          width: 56px;
          height: 56px;
          margin: 0 auto 20px;
          background: #161616;
          border: 1px solid var(--border);
          border-radius: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        
        .drop-title {
          font-size: 15px;
          font-weight: 500;
          color: var(--text);
          margin-bottom: 8px;
        }
        
        .drop-hint {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 12px;
          color: var(--muted);
          line-height: 1.6;
        }
        
        .formats {
          display: flex;
          gap: 6px;
          justify-content: center;
          flex-wrap: wrap;
          margin-top: 20px;
        }
        
        .format-tag {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10px;
          padding: 3px 8px;
          background: #161616;
          border: 1px solid var(--border);
          border-radius: 4px;
          color: var(--muted);
        }
        
        .file-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 20px 24px;
          display: flex;
          align-items: center;
          gap: 16px;
          animation: fadeIn 0.3s ease;
        }
        
        .file-icon {
          width: 44px;
          height: 44px;
          background: var(--accent-dim);
          border: 1px solid rgba(212, 245, 66, 0.2);
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        
        .file-info { flex: 1; min-width: 0; }
        
        .file-name {
          font-size: 14px;
          font-weight: 500;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          color: var(--text);
        }
        
        .file-meta {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 11px;
          color: var(--muted);
          margin-top: 3px;
        }
        
        .btn-ghost {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--muted);
          padding: 8px 12px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 13px;
          font-family: 'Space Grotesk', sans-serif;
          transition: all 0.15s;
        }
        
        .btn-ghost:hover {
          border-color: var(--border-hover);
          color: var(--text);
        }
        
        .btn-primary {
          width: 100%;
          padding: 16px;
          background: var(--accent);
          color: #0a0a0a;
          border: none;
          border-radius: 10px;
          font-family: 'Space Grotesk', sans-serif;
          font-size: 14px;
          font-weight: 600;
          letter-spacing: 0.03em;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
        }
        
        .btn-primary:hover:not(:disabled) {
          background: #e0ff4f;
          transform: translateY(-1px);
        }
        
        .btn-primary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          transform: none;
        }
        
        .spinner {
          width: 16px;
          height: 16px;
          border: 2px solid rgba(0,0,0,0.2);
          border-top-color: #0a0a0a;
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
        }
        
        .transcript-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 12px;
          overflow: hidden;
          animation: fadeIn 0.4s ease;
        }
        
        .transcript-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 20px;
          border-bottom: 1px solid var(--border);
        }
        
        .transcript-label {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 11px;
          color: var(--accent);
          text-transform: uppercase;
          letter-spacing: 0.1em;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .transcript-dot {
          width: 6px;
          height: 6px;
          background: var(--accent);
          border-radius: 50%;
        }
        
        .btn-copy {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 11px;
          padding: 6px 12px;
          background: transparent;
          border: 1px solid var(--border);
          border-radius: 6px;
          color: var(--muted);
          cursor: pointer;
          transition: all 0.15s;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        
        .btn-copy:hover {
          border-color: rgba(212, 245, 66, 0.3);
          color: var(--accent);
        }
        
        .transcript-body {
          padding: 24px;
        }
        
        .transcript-text {
          font-size: 15px;
          line-height: 1.8;
          color: #d0d0d0;
          white-space: pre-wrap;
          font-weight: 300;
        }
        
        .word-count {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 11px;
          color: var(--muted);
          padding: 12px 24px;
          border-top: 1px solid var(--border);
        }
        
        .error-box {
          background: rgba(255, 77, 77, 0.08);
          border: 1px solid rgba(255, 77, 77, 0.2);
          border-radius: 10px;
          padding: 16px 20px;
          font-family: 'IBM Plex Mono', monospace;
          font-size: 12px;
          color: var(--error);
          animation: fadeIn 0.3s ease;
        }
        
        .loading-state {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 40px;
          text-align: center;
          animation: fadeIn 0.3s ease;
        }
        
        .loading-text {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 13px;
          color: var(--muted);
          margin-top: 16px;
        }
        
        .loading-subtext {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 11px;
          color: #333;
          margin-top: 6px;
        }
      `}</style>

      <div className="container">
        <div className="header">
          <div className="logo">
            <div className="logo-mark">
              <svg viewBox="0 0 20 20" fill="none">
                <rect x="2" y="8" width="2" height="4" fill="#0a0a0a" rx="1"/>
                <rect x="6" y="5" width="2" height="10" fill="#0a0a0a" rx="1"/>
                <rect x="10" y="3" width="2" height="14" fill="#0a0a0a" rx="1"/>
                <rect x="14" y="6" width="2" height="8" fill="#0a0a0a" rx="1"/>
              </svg>
            </div>
            <div>
              <h1>Transcritor</h1>
              <div className="subtitle">audio → texto</div>
            </div>
          </div>
          <div className="badge">Claude AI</div>
        </div>

        {!file ? (
          <div
            className={`drop-zone ${dragging ? "drag" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
          >
            <input
              ref={inputRef}
              type="file"
              accept="audio/*"
              style={{ display: "none" }}
              onChange={(e) => handleFile(e.target.files[0])}
            />
            <div className="drop-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: "var(--accent)" }}>
                <path d="M9 18V5l12-2v13"/>
                <circle cx="6" cy="18" r="3"/>
                <circle cx="18" cy="16" r="3"/>
              </svg>
            </div>
            <div className="drop-title">Arraste um arquivo de áudio</div>
            <div className="drop-hint">ou clique para selecionar do computador</div>
            <div className="formats">
              {["MP3", "WAV", "OGG", "WEBM", "MP4", "FLAC"].map(f => (
                <span key={f} className="format-tag">{f}</span>
              ))}
            </div>
          </div>
        ) : (
          <div className="file-card">
            <div className="file-icon">
              <WaveformIcon animate={loading} />
            </div>
            <div className="file-info">
              <div className="file-name">{file.name}</div>
              <div className="file-meta">{formatSize(file.size)} · {file.type || "audio"}</div>
            </div>
            <button className="btn-ghost" onClick={reset}>trocar</button>
          </div>
        )}

        {error && <div className="error-box">⚠ {error}</div>}

        {file && !loading && !transcript && (
          <button className="btn-primary" onClick={transcribe} disabled={loading}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
            Transcrever Áudio
          </button>
        )}

        {loading && (
          <div className="loading-state">
            <div style={{ display: "flex", justifyContent: "center", marginBottom: "8px" }}>
              <WaveformIcon animate={true} />
            </div>
            <div className="loading-text">Analisando áudio...</div>
            <div className="loading-subtext">Isso pode levar alguns segundos</div>
          </div>
        )}

        {transcript && (
          <>
            <div className="transcript-card">
              <div className="transcript-header">
                <div className="transcript-label">
                  <div className="transcript-dot" />
                  Transcrição
                </div>
                <button className="btn-copy" onClick={copyToClipboard}>
                  {copied ? "✓ copiado" : "copiar"}
                </button>
              </div>
              <div className="transcript-body">
                <div className="transcript-text">{transcript}</div>
              </div>
              <div className="word-count">
                {transcript.trim().split(/\s+/).length} palavras · {transcript.length} caracteres
              </div>
            </div>

            <div style={{ display: "flex", gap: "10px" }}>
              <button className="btn-ghost" style={{ flex: 1 }} onClick={reset}>
                novo arquivo
              </button>
              <button className="btn-primary" style={{ flex: 2 }} onClick={transcribe}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.1"/>
                </svg>
                Retranscrever
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
