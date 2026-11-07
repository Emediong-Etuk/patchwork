import { ensureRuntime } from "./src/orchestration/runtime";

// Connect every agent identity to Switch as soon as the server starts.
if (process.env.PATCHWORK_DISABLE_RUNTIME !== "1") {
  ensureRuntime().catch((e) => console.error("[patchwork] runtime failed to start", e));
}
