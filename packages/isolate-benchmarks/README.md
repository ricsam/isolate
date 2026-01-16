# @ricsam/isolate-benchmarks

Benchmark suite for testing HTTP file transfer and WebSocket performance across different isolate execution environments.

## Benchmarks

1. **File Transfer** - Upload and download a large file (default 20 MB)
2. **WebSocket Ping/Pong** - 1000 roundtrip messages

## Scenarios

The benchmarks run against three scenarios:

| Scenario | Description |
|----------|-------------|
| **Direct Node.js** | Baseline using `@whatwg-node/server` and `ws` module directly in Node.js |
| **Isolate Runtime** | Using `createRuntime()` from `@ricsam/isolate-runtime` with requests dispatched from the host |
| **Isolate Client + Daemon** | Using `@ricsam/isolate-client` connected to `@ricsam/isolate-daemon` via IPC |

## Running the Benchmarks

From the repository root:

```bash
npm run bench --workspace=@ricsam/isolate-benchmarks
```

Or from this directory:

```bash
npm run bench
```

## Example Output

```
Running scenario: Direct Node.js...

Running scenario: Isolate Runtime...

Running scenario: Isolate Client + Daemon...
Isolate daemon listening on /tmp/isolate-benchmark-daemon.sock
Isolate daemon stopped

=== File Transfer (20 MB upload + download) ===

┌─────────┬───────────────────────────┬───────────────┬───────────────────┐
│ (index) │ Scenario                  │ Duration (ms) │ Throughput (MB/s) │
├─────────┼───────────────────────────┼───────────────┼───────────────────┤
│ 0       │ 'Direct Node.js'          │ '65.00'       │ '615.38'          │
│ 1       │ 'Isolate Runtime'         │ '2386.00'     │ '16.76'           │
│ 2       │ 'Isolate Client + Daemon' │ '2560.00'     │ '15.63'           │
└─────────┴───────────────────────────┴───────────────┴───────────────────┘

=== WebSocket Ping/Pong (1000 roundtrips) ===

┌─────────┬───────────────────────────┬───────────────┬──────────────┐
│ (index) │ Scenario                  │ Duration (ms) │ Messages/sec │
├─────────┼───────────────────────────┼───────────────┼──────────────┤
│ 0       │ 'Direct Node.js'          │ '47.00'       │ '42553'      │
│ 1       │ 'Isolate Runtime'         │ '34.00'       │ '58824'      │
│ 2       │ 'Isolate Client + Daemon' │ '52.00'       │ '38462'      │
└─────────┴───────────────────────────┴───────────────┴──────────────┘
```

## Configuration

Edit `src/index.ts` to change:

- `PAYLOAD_SIZE` - File size for transfer benchmark (default: 20 MB)
- `WEBSOCKET_MESSAGES` - Number of ping/pong roundtrips (default: 1000)

## How It Works

### File Transfer

1. Generates a random payload of the configured size
2. Uploads the payload via HTTP POST to `/upload`
3. Downloads the payload via HTTP GET from `/download`
4. Measures total time and calculates throughput

The upload uses streaming (64 KB chunks) to handle large files efficiently.

### WebSocket

1. Establishes a WebSocket connection via upgrade request to `/ws`
2. Sends ping messages and waits for pong responses
3. Measures time for all roundtrips and calculates messages per second

### Scenario Details

**Direct Node.js**: Creates an HTTP server with `@whatwg-node/server` and WebSocket server with `ws`. Uses native `fetch()` and `WebSocket` clients.

**Isolate Runtime**: Creates an isolated V8 sandbox via `createRuntime()`. The isolate defines a `serve()` handler, and the host dispatches requests using `runtime.fetch.dispatchRequest()` and WebSocket events via `runtime.fetch.dispatchWebSocketOpen/Message/Close()`.

**Isolate Client + Daemon**: Starts the isolate daemon, connects via Unix socket, and creates a remote runtime. Same dispatch pattern as Isolate Runtime but communication goes through IPC.
