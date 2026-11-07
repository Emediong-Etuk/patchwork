export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.PATCHWORK_DISABLE_RUNTIME === "1") return;
  const { ensureRuntime } = await import("./src/orchestration/runtime");
  ensureRuntime().catch((e) => console.error("[patchwork] runtime failed to start", e));
}
