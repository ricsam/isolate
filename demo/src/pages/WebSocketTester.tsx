import { useState, useRef, useEffect } from "react";

interface Message {
  type: "sent" | "received" | "system";
  content: string;
  timestamp: number;
}

export function WebSocketTester() {
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const addMessage = (type: Message["type"], content: string) => {
    setMessages((prev) => [...prev, { type, content, timestamp: Date.now() }]);
  };

  const connect = () => {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${location.host}/ws`;

    addMessage("system", `Connecting to ${wsUrl}...`);

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setConnected(true);
      addMessage("system", "Connected!");
    };

    ws.onmessage = (event) => {
      addMessage("received", event.data);
    };

    ws.onclose = (event) => {
      setConnected(false);
      addMessage(
        "system",
        `Disconnected (code: ${event.code}, reason: ${event.reason || "none"})`
      );
      wsRef.current = null;
    };

    ws.onerror = () => {
      addMessage("system", "WebSocket error occurred");
    };

    wsRef.current = ws;
  };

  const disconnect = () => {
    if (wsRef.current) {
      wsRef.current.close(1000, "User disconnected");
    }
  };

  const sendMessage = () => {
    if (!wsRef.current || !inputMessage.trim()) return;

    wsRef.current.send(inputMessage);
    addMessage("sent", inputMessage);
    setInputMessage("");
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearMessages = () => {
    setMessages([]);
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString();
  };

  return (
    <div className="page websocket-tester-page">
      <h1>WebSocket Tester</h1>
      <p>Test WebSocket connections handled by QuickJS</p>

      <div className="connection-section">
        <div className="status">
          Status:{" "}
          <span className={connected ? "connected" : "disconnected"}>
            {connected ? "Connected" : "Disconnected"}
          </span>
        </div>
        <div className="connection-buttons">
          {!connected ? (
            <button onClick={connect} className="connect-button">
              Connect
            </button>
          ) : (
            <button onClick={disconnect} className="disconnect-button">
              Disconnect
            </button>
          )}
          <button onClick={clearMessages} className="clear-button">
            Clear Log
          </button>
        </div>
      </div>

      <div className="messages-section">
        <h3>Messages</h3>
        <div className="messages-container">
          {messages.length === 0 ? (
            <p className="no-messages">No messages yet. Connect to start.</p>
          ) : (
            messages.map((msg, index) => (
              <div key={index} className={`message message-${msg.type}`}>
                <span className="message-time">{formatTime(msg.timestamp)}</span>
                <span className="message-type">
                  {msg.type === "sent"
                    ? "→"
                    : msg.type === "received"
                      ? "←"
                      : "●"}
                </span>
                <span className="message-content">
                  {msg.type === "received" ? (
                    <pre>{formatJson(msg.content)}</pre>
                  ) : (
                    msg.content
                  )}
                </span>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="send-section">
        <input
          type="text"
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Type a message..."
          disabled={!connected}
          className="message-input"
        />
        <button
          onClick={sendMessage}
          disabled={!connected || !inputMessage.trim()}
          className="send-button"
        >
          Send
        </button>
      </div>
    </div>
  );
}

function formatJson(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}
