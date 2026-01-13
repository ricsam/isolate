import { useState, useRef, useEffect, useCallback } from "react";

interface ChatMessage {
  username: string;
  content: string;
  timestamp: number;
  isOwn?: boolean;
  isSystem?: boolean;
}

interface User {
  username: string;
  typing: boolean;
}

export function ChatPage() {
  const [connected, setConnected] = useState(false);
  const [username, setUsername] = useState("");
  const [joined, setJoined] = useState(false);
  const [myUsername, setMyUsername] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<number | null>(null);
  const lastTypingSent = useRef(false);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, []);

  const connect = useCallback(() => {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${location.host}/ws/chat`;

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        switch (msg.type) {
          case "connected":
            break;

          case "roomState":
            setJoined(true);
            setMyUsername(msg.payload.username);
            setUsers(msg.payload.users);
            setMessages((prev) => [
              ...prev,
              {
                username: "System",
                content: `Welcome to the chat, ${msg.payload.username}!`,
                timestamp: Date.now(),
                isSystem: true,
              },
            ]);
            break;

          case "userJoined":
            setMessages((prev) => [
              ...prev,
              {
                username: "System",
                content: `${msg.payload.username} joined the chat`,
                timestamp: Date.now(),
                isSystem: true,
              },
            ]);
            setUsers((prev) => [
              ...prev,
              { username: msg.payload.username, typing: false },
            ]);
            break;

          case "userLeft":
            setMessages((prev) => [
              ...prev,
              {
                username: "System",
                content: `${msg.payload.username} left the chat`,
                timestamp: Date.now(),
                isSystem: true,
              },
            ]);
            setUsers((prev) =>
              prev.filter((u) => u.username !== msg.payload.username)
            );
            setTypingUsers((prev) =>
              prev.filter((u) => u !== msg.payload.username)
            );
            break;

          case "message":
            setMessages((prev) => [
              ...prev,
              {
                username: msg.payload.username,
                content: msg.payload.content,
                timestamp: msg.payload.timestamp,
                isOwn: msg.payload.username === myUsername,
              },
            ]);
            break;

          case "typing":
            if (msg.payload.typing) {
              setTypingUsers((prev) =>
                prev.includes(msg.payload.username)
                  ? prev
                  : [...prev, msg.payload.username]
              );
            } else {
              setTypingUsers((prev) =>
                prev.filter((u) => u !== msg.payload.username)
              );
            }
            break;

          case "error":
            setMessages((prev) => [
              ...prev,
              {
                username: "Error",
                content: msg.payload.message,
                timestamp: Date.now(),
                isSystem: true,
              },
            ]);
            break;
        }
      } catch (error) {
        console.error("Failed to parse message:", error);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      setJoined(false);
      setUsers([]);
      setTypingUsers([]);
      wsRef.current = null;
    };

    ws.onerror = () => {
      setMessages((prev) => [
        ...prev,
        {
          username: "Error",
          content: "WebSocket connection error",
          timestamp: Date.now(),
          isSystem: true,
        },
      ]);
    };

    wsRef.current = ws;
  }, [myUsername]);

  const handleJoin = () => {
    if (!username.trim()) return;

    if (!connected) {
      connect();
      // Wait for connection then join
      const checkConnection = setInterval(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          clearInterval(checkConnection);
          wsRef.current.send(
            JSON.stringify({
              type: "join",
              payload: { username: username.trim() },
            })
          );
        }
      }, 100);
    } else {
      wsRef.current?.send(
        JSON.stringify({
          type: "join",
          payload: { username: username.trim() },
        })
      );
    }
  };

  const sendMessage = () => {
    if (!wsRef.current || !inputMessage.trim()) return;

    wsRef.current.send(
      JSON.stringify({
        type: "message",
        payload: { content: inputMessage.trim() },
      })
    );

    // Stop typing indicator
    if (lastTypingSent.current) {
      wsRef.current.send(
        JSON.stringify({
          type: "typing",
          payload: { typing: false },
        })
      );
      lastTypingSent.current = false;
    }

    setInputMessage("");
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputMessage(e.target.value);

    if (!wsRef.current || !joined) return;

    // Send typing indicator
    if (!lastTypingSent.current && e.target.value.trim()) {
      wsRef.current.send(
        JSON.stringify({
          type: "typing",
          payload: { typing: true },
        })
      );
      lastTypingSent.current = true;
    }

    // Reset typing timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = window.setTimeout(() => {
      if (wsRef.current && lastTypingSent.current) {
        wsRef.current.send(
          JSON.stringify({
            type: "typing",
            payload: { typing: false },
          })
        );
        lastTypingSent.current = false;
      }
    }, 2000);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleLeave = () => {
    wsRef.current?.close();
    setMessages([]);
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString();
  };

  return (
    <div className="page chat-page">
      <h1>Chat Room</h1>
      <p>Real-time WebSocket chat running in QuickJS</p>

      {!joined ? (
        <div className="join-section">
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyPress={(e) => e.key === "Enter" && handleJoin()}
            placeholder="Enter your username..."
            className="username-input"
          />
          <button
            onClick={handleJoin}
            disabled={!username.trim()}
            className="join-button"
          >
            Join Chat
          </button>
        </div>
      ) : (
        <>
          <div className="chat-header">
            <span>Logged in as <strong>{myUsername}</strong></span>
            <button onClick={handleLeave} className="leave-button">
              Leave
            </button>
          </div>

          <div className="chat-container">
            <div className="users-sidebar">
              <h4>Users ({users.length})</h4>
              {users.map((user) => (
                <div
                  key={user.username}
                  className={`user-item ${user.username === myUsername ? "current-user" : ""}`}
                >
                  {user.username}
                  {user.username === myUsername && " (you)"}
                  {typingUsers.includes(user.username) && (
                    <span className="typing-indicator">...</span>
                  )}
                </div>
              ))}
            </div>

            <div className="messages-area">
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`chat-message ${msg.isOwn ? "own" : ""} ${msg.isSystem ? "system" : ""}`}
                >
                  <span className="message-time">{formatTime(msg.timestamp)}</span>
                  <span className="message-author">{msg.username}</span>
                  <span className="message-text">{msg.content}</span>
                </div>
              ))}
              {typingUsers.length > 0 && (
                <div className="typing-status">
                  {typingUsers.join(", ")}{" "}
                  {typingUsers.length === 1 ? "is" : "are"} typing...
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>

          <div className="input-area">
            <input
              type="text"
              value={inputMessage}
              onChange={handleInputChange}
              onKeyPress={handleKeyPress}
              placeholder="Type a message..."
              className="message-input"
            />
            <button
              onClick={sendMessage}
              disabled={!inputMessage.trim()}
              className="send-button"
            >
              Send
            </button>
          </div>
        </>
      )}
    </div>
  );
}
