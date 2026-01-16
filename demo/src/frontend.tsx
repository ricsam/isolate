/**
 * This file is the entry point for the React app, it sets up the root
 * element and renders the App component to the DOM.
 *
 * It is included in `src/index.html`.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  RouterProvider,
  createRouter,
  createRoute,
  createRootRoute,
  Link,
  Outlet,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

import { HomePage } from "./pages/HomePage.tsx";
import { APITester } from "./pages/APITester.tsx";
import { FileUploader } from "./pages/FileUploader.tsx";
import { WebSocketTester } from "./pages/WebSocketTester.tsx";
import { ChatPage } from "./pages/ChatPage.tsx";
import { AIPage } from "./pages/AIPage.tsx";
import { LogsPage } from "./pages/LogsPage.tsx";
import { DownloadsPage } from "./pages/DownloadsPage.tsx";

import "./index.css";

// Root layout with navigation
const rootRoute = createRootRoute({
  component: () => (
    <div className="app-layout">
      <nav className="main-nav">
        <div className="nav-brand">QuickJS Demo</div>
        <div className="nav-links">
          <Link
            to="/"
            className="nav-link"
            activeProps={{ className: "nav-link active" }}
          >
            Home
          </Link>
          <Link
            to="/api"
            className="nav-link"
            activeProps={{ className: "nav-link active" }}
          >
            API
          </Link>
          <Link
            to="/files"
            className="nav-link"
            activeProps={{ className: "nav-link active" }}
          >
            Files
          </Link>
          <Link
            to="/websocket"
            className="nav-link"
            activeProps={{ className: "nav-link active" }}
          >
            WebSocket
          </Link>
          <Link
            to="/chat"
            className="nav-link"
            activeProps={{ className: "nav-link active" }}
          >
            Chat
          </Link>
          <Link
            to="/ai"
            className="nav-link"
            activeProps={{ className: "nav-link active" }}
          >
            AI
          </Link>
          <Link
            to="/logs"
            className="nav-link"
            activeProps={{ className: "nav-link active" }}
          >
            Logs
          </Link>
          <Link
            to="/downloads"
            className="nav-link"
            activeProps={{ className: "nav-link active" }}
          >
            Downloads
          </Link>
        </div>
      </nav>
      <main className="main-content">
        <Outlet />
      </main>
      <TanStackRouterDevtools />
    </div>
  ),
});

// Define routes
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});

const apiRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/api",
  component: APITester,
});

const filesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/files",
  component: FileUploader,
});

const websocketRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/websocket",
  component: WebSocketTester,
});

const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/chat",
  component: ChatPage,
});

const aiRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/ai",
  component: AIPage,
});

const logsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/logs",
  component: LogsPage,
});

const downloadsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/downloads",
  component: DownloadsPage,
});

// Create route tree
const routeTree = rootRoute.addChildren([
  indexRoute,
  apiRoute,
  filesRoute,
  websocketRoute,
  chatRoute,
  aiRoute,
  logsRoute,
  downloadsRoute,
]);

// Create router
const router = createRouter({ routeTree });

// Register router for type safety
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// Render
const elem = document.getElementById("root")!;
const app = (
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);

createRoot(elem).render(app);
