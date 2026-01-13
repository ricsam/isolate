import { useState, useRef, useEffect } from "react";

interface LogEntry {
  id: number;
  level: "info" | "warn" | "error";
  message: string;
  timestamp: string;
  source: string;
}

type LogLevel = "all" | "info" | "warn" | "error";

export function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [filter, setFilter] = useState<LogLevel>("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const eventSourceRef = useRef<EventSource | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const connect = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource(`/api/logs?level=${filter}`);
    eventSourceRef.current = es;

    es.addEventListener("connected", (e) => {
      setConnected(true);
      const data = JSON.parse(e.data);
      setLogs((prev) => [
        ...prev.slice(-99),
        {
          id: Date.now(),
          level: "info",
          message: `Connected to log stream (filter: ${data.filter})`,
          timestamp: new Date().toISOString(),
          source: "system",
        },
      ]);
    });

    es.addEventListener("log", (e) => {
      const log = JSON.parse(e.data);
      setLogs((prev) => [...prev.slice(-99), log]);
    });

    es.addEventListener("heartbeat", () => {
      // Connection is alive - could update UI if needed
    });

    es.onerror = () => {
      setConnected(false);
      setLogs((prev) => [
        ...prev.slice(-99),
        {
          id: Date.now(),
          level: "error",
          message: "Connection lost",
          timestamp: new Date().toISOString(),
          source: "system",
        },
      ]);
      es.close();
      eventSourceRef.current = null;
    };
  };

  const disconnect = () => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setConnected(false);
    setLogs((prev) => [
      ...prev.slice(-99),
      {
        id: Date.now(),
        level: "info",
        message: "Disconnected from log stream",
        timestamp: new Date().toISOString(),
        source: "system",
      },
    ]);
  };

  useEffect(() => {
    if (autoScroll) {
      logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  // Reconnect when filter changes (if connected)
  useEffect(() => {
    if (connected) {
      disconnect();
      setTimeout(connect, 100);
    }
  }, [filter]);

  const handleClear = () => {
    setLogs([]);
  };

  const getLevelClass = (level: string) => {
    switch (level) {
      case "error":
        return "log-error";
      case "warn":
        return "log-warn";
      default:
        return "log-info";
    }
  };

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString();
  };

  const logCounts = {
    info: logs.filter((l) => l.level === "info").length,
    warn: logs.filter((l) => l.level === "warn").length,
    error: logs.filter((l) => l.level === "error").length,
  };

  return (
    <div className="page logs-page">
      <h1>Live Logs</h1>
      <p>Server-Sent Events streaming log data from QuickJS</p>

      <div className="controls">
        <div className="filter-group">
          <label>Filter:</label>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as LogLevel)}
            className="filter-select"
          >
            <option value="all">All Levels</option>
            <option value="info">Info</option>
            <option value="warn">Warnings</option>
            <option value="error">Errors</option>
          </select>
        </div>

        <div className="button-group">
          {!connected ? (
            <button onClick={connect} className="connect-button">
              Connect
            </button>
          ) : (
            <button onClick={disconnect} className="disconnect-button">
              Disconnect
            </button>
          )}
          <button onClick={handleClear} className="clear-button">
            Clear
          </button>
        </div>

        <div className="status-group">
          <label className="auto-scroll">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            Auto-scroll
          </label>
          <span className={`status ${connected ? "connected" : "disconnected"}`}>
            {connected ? "Connected" : "Disconnected"}
          </span>
        </div>
      </div>

      <div className="log-stats">
        <span className="stat info">Info: {logCounts.info}</span>
        <span className="stat warn">Warn: {logCounts.warn}</span>
        <span className="stat error">Error: {logCounts.error}</span>
        <span className="stat total">Total: {logs.length}</span>
      </div>

      <div className="logs-container">
        {logs.length === 0 ? (
          <div className="no-logs">
            No logs yet. Click Connect to start streaming.
          </div>
        ) : (
          logs.map((log) => (
            <div key={log.id} className={`log-entry ${getLevelClass(log.level)}`}>
              <span className="log-time">{formatTime(log.timestamp)}</span>
              <span className={`log-level ${log.level}`}>
                [{log.level.toUpperCase()}]
              </span>
              <span className="log-source">[{log.source}]</span>
              <span className="log-message">{log.message}</span>
            </div>
          ))
        )}
        <div ref={logsEndRef} />
      </div>
    </div>
  );
}
