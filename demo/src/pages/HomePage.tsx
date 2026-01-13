import { Link } from "@tanstack/react-router";

export function HomePage() {
  return (
    <div className="page home-page">
      <div className="hero">
        <h1>QuickJS Runtime Demo</h1>
        <p className="subtitle">
          Testing HTTP, WebSocket, and File System APIs running inside QuickJS
        </p>
      </div>

      <div className="features">
        <div className="feature-card">
          <h2>HTTP API</h2>
          <p>
            Test GET and POST requests handled by QuickJS serve() handlers.
            Includes JSON echo and hello endpoints.
          </p>
          <Link to="/api" className="feature-link">
            Test API &rarr;
          </Link>
        </div>

        <div className="feature-card">
          <h2>File Uploads</h2>
          <p>
            Upload files via FormData, list uploaded files, and download them.
            Files are stored via the QuickJS fs API.
          </p>
          <Link to="/files" className="feature-link">
            Test Files &rarr;
          </Link>
        </div>

        <div className="feature-card">
          <h2>WebSocket</h2>
          <p>
            Connect to a WebSocket endpoint handled by QuickJS. Send messages
            and receive echo responses in real-time.
          </p>
          <Link to="/websocket" className="feature-link">
            Test WebSocket &rarr;
          </Link>
        </div>
      </div>

      <div className="info">
        <h3>Architecture</h3>
        <pre>{`Browser → Bun.serve() → QuickJS serve() handler
   ↑                              ↓
   └────── Response ──────────────┘`}</pre>
        <p>
          All API requests are forwarded to handlers running inside a sandboxed
          QuickJS environment via <code>dispatchRequest()</code>.
        </p>
      </div>
    </div>
  );
}
