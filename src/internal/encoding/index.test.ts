import assert from "node:assert/strict";
import { test } from "node:test";
import ivm from "@ricsam/isolated-vm";
import { setupEncoding } from "./index.ts";

test("setupEncoding supports latin1 and binary Buffer aliases", async () => {
  const isolate = new ivm.Isolate();
  const context = await isolate.createContext();

  try {
    await setupEncoding(context);

    const resultJson = context.evalSync(`
      JSON.stringify((() => {
        const source = String.fromCharCode(0x89, 0x50, 0x4E, 0x47);
        return {
          binaryIsEncoding: Buffer.isEncoding("binary"),
          latin1IsEncoding: Buffer.isEncoding("latin1"),
          binaryBytes: Array.from(Buffer.from(source, "binary")),
          latin1Bytes: Array.from(Buffer.from(source, "latin1")),
          base64: Buffer.from(source, "binary").toString("base64"),
          roundTrip: Buffer.from([0x89, 0x50, 0x4E, 0x47]).toString("binary"),
          byteLength: Buffer.byteLength(source, "latin1"),
        };
      })())
    `) as string;

    const result = JSON.parse(resultJson) as {
      binaryIsEncoding: boolean;
      latin1IsEncoding: boolean;
      binaryBytes: number[];
      latin1Bytes: number[];
      base64: string;
      roundTrip: string;
      byteLength: number;
    };

    assert.equal(result.binaryIsEncoding, true);
    assert.equal(result.latin1IsEncoding, true);
    assert.deepEqual(result.binaryBytes, [0x89, 0x50, 0x4E, 0x47]);
    assert.deepEqual(result.latin1Bytes, [0x89, 0x50, 0x4E, 0x47]);
    assert.equal(result.base64, "iVBORw==");
    assert.equal(
      result.roundTrip,
      String.fromCharCode(0x89, 0x50, 0x4E, 0x47),
    );
    assert.equal(result.byteLength, 4);
  } finally {
    context.release();
    isolate.dispose();
  }
});
