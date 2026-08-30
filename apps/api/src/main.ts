import { createApiServer } from "./server.ts";

const LOOPBACK_HOST = "127.0.0.1";
const DEFAULT_PORT = 3_000;

function configuredPort(): number {
  const raw = process.env.PORT;
  if (raw === undefined) {
    return DEFAULT_PORT;
  }

  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error("PORT must be an integer from 1 through 65535");
  }
  return parsed;
}

const server = createApiServer();
const port = configuredPort();

server.listen(port, LOOPBACK_HOST, () => {
  console.log(`Credit Trade sandbox API listening on http://${LOOPBACK_HOST}:${port}`);
  console.log("Sandbox only: production payments and production vendor routes are unavailable.");
});

function shutdown(signal: string): void {
  console.log(`${signal} received; closing the sandbox API.`);
  server.close((error?: Error) => {
    if (error !== undefined) {
      process.exitCode = 1;
    }
  });
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
