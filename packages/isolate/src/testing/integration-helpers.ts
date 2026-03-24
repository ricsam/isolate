import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createIsolateHost } from "../index.ts";
import type { IsolateHost, RequestResult } from "../types.ts";

function sanitizeLabel(label: string): string {
  return label.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
}

export function createTestId(label: string): string {
  return `${sanitizeLabel(label)}-${process.pid}-${randomUUID()}`;
}

function createTestSocketPath(label: string): string {
  const suffix = randomUUID().slice(0, 8);
  return path.join("/tmp", `isolate-${sanitizeLabel(label)}-${suffix}.sock`);
}

export async function createTestHost(
  label: string,
): Promise<{
  host: IsolateHost;
  socketPath: string;
  cleanup: () => Promise<void>;
}> {
  const socketPath = createTestSocketPath(label);
  await fs.rm(socketPath, { force: true });

  const host = await createIsolateHost({
    daemon: {
      socketPath,
      timeoutMs: 15_000,
    },
  });

  return {
    host,
    socketPath,
    cleanup: async () => {
      await host.close().catch(() => {});
      await fs.rm(socketPath, { force: true }).catch(() => {});
    },
  };
}

export function expectResponse(result: RequestResult): Response {
  if (result.type !== "response") {
    assert.fail(`Expected a response result, received ${result.type}`);
  }
  return result.response;
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Timed out after ${timeoutMs}ms: ${label}`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}
