import { useState, useRef } from "react";

interface StreamStats {
  totalWords: number;
  totalChars: number;
  processingTime: number;
}

export function AIPage() {
  const [prompt, setPrompt] = useState("");
  const [response, setResponse] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [stats, setStats] = useState<StreamStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleSubmit = async () => {
    if (!prompt.trim() || isStreaming) return;

    setResponse("");
    setStats(null);
    setError(null);
    setIsStreaming(true);
    abortRef.current = new AbortController();

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim() }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const chunk = JSON.parse(line);

            if (chunk.type === "chunk") {
              setResponse((prev) => prev + chunk.content);
            } else if (chunk.type === "done") {
              setStats(chunk.stats);
            }
          } catch {
            // Ignore parse errors for incomplete chunks
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError((err as Error).message);
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
  };

  const handleClear = () => {
    setResponse("");
    setStats(null);
    setError(null);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && e.metaKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const suggestedPrompts = [
    "Hello",
    "Explain how this works",
    "Show me some code",
  ];

  return (
    <div className="page ai-page">
      <h1>AI Streaming Demo</h1>
      <p>Simulated AI responses with word-by-word streaming from Isolate</p>

      <div className="prompt-section">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyPress}
          placeholder="Enter your prompt... (try: hello, code, explain)"
          rows={3}
          className="prompt-input"
          disabled={isStreaming}
        />

        <div className="suggested-prompts">
          {suggestedPrompts.map((p) => (
            <button
              key={p}
              onClick={() => setPrompt(p)}
              className="suggested-prompt"
              disabled={isStreaming}
            >
              {p}
            </button>
          ))}
        </div>

        <div className="button-row">
          <button
            onClick={handleSubmit}
            disabled={isStreaming || !prompt.trim()}
            className="generate-button"
          >
            {isStreaming ? "Generating..." : "Generate"}
          </button>
          {isStreaming && (
            <button onClick={handleCancel} className="cancel-button">
              Cancel
            </button>
          )}
          {(response || error) && !isStreaming && (
            <button onClick={handleClear} className="clear-button">
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="response-section">
        <h3>
          Response
          {isStreaming && <span className="cursor">|</span>}
        </h3>

        {error ? (
          <div className="error-content">{error}</div>
        ) : (
          <div className="response-content">
            {response || (
              <span className="placeholder">Response will appear here...</span>
            )}
          </div>
        )}

        {stats && (
          <div className="stats">
            <span>{stats.totalWords} words</span>
            <span>{stats.totalChars} chars</span>
            <span>{stats.processingTime}ms</span>
          </div>
        )}
      </div>
    </div>
  );
}
