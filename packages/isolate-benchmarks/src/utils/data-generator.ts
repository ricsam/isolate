import { randomBytes } from "node:crypto";

export function generatePayload(size: number): Uint8Array {
  return new Uint8Array(randomBytes(size));
}
