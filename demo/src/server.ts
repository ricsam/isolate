import { createServer } from "node:http";

// TODO: Implement demo server using @ricsam/isolate-runtime

const server = createServer(async (req, res) => {
  // TODO: Route requests through isolated-vm sandbox
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ message: "Hello from isolated-vm sandbox!" }));
});

const PORT = process.env.PORT ?? 3000;

server.listen(PORT, () => {
  console.log(`Demo server running at http://localhost:${PORT}`);
});

export { server };
