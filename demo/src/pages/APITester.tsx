import { useState, type FormEvent } from "react";

export function APITester() {
  const [response, setResponse] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const testEndpoint = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);

    try {
      const form = e.currentTarget;
      const formData = new FormData(form);
      const endpoint = formData.get("endpoint") as string;
      const method = formData.get("method") as string;
      const body = formData.get("body") as string;

      const url = new URL(endpoint, location.href);

      const options: RequestInit = { method };

      if (method === "POST" && body.trim()) {
        options.body = body;
        options.headers = { "Content-Type": "application/json" };
      }

      const res = await fetch(url, options);
      const contentType = res.headers.get("content-type") || "";

      let data: string;
      if (contentType.includes("application/json")) {
        data = JSON.stringify(await res.json(), null, 2);
      } else {
        data = await res.text();
      }

      setResponse(`Status: ${res.status} ${res.statusText}\n\n${data}`);
    } catch (error) {
      setResponse(`Error: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page api-tester-page">
      <h1>API Tester</h1>
      <p>Test HTTP endpoints handled by QuickJS</p>

      <form onSubmit={testEndpoint} className="api-form">
        <div className="form-row">
          <select name="method" className="method-select">
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="DELETE">DELETE</option>
          </select>
          <input
            type="text"
            name="endpoint"
            defaultValue="/api/hello"
            className="endpoint-input"
            placeholder="/api/hello"
          />
          <button type="submit" className="send-button" disabled={loading}>
            {loading ? "Sending..." : "Send"}
          </button>
        </div>

        <div className="form-row">
          <textarea
            name="body"
            placeholder='JSON body for POST requests, e.g.: {"message": "hello"}'
            className="body-input"
            rows={3}
          />
        </div>
      </form>

      <div className="endpoints-info">
        <h3>Available Endpoints</h3>
        <ul>
          <li>
            <code>GET /api/hello</code> - Returns a greeting from QuickJS
          </li>
          <li>
            <code>POST /api/echo</code> - Echoes the JSON body back with
            timestamp
          </li>
        </ul>
      </div>

      <div className="response-section">
        <h3>Response</h3>
        <pre className="response-output">
          {response || "Response will appear here..."}
        </pre>
      </div>
    </div>
  );
}
