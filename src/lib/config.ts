import { z } from "zod";

/**
 * Server configuration, read once from the environment. Every secret stays on
 * the server: nothing in this module is ever sent to the browser.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url().default("http://localhost:3000"),
  AUTH_SECRET: z.string().min(16, "AUTH_SECRET must be at least 16 characters"),
  ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i, "ENCRYPTION_KEY must be 64 hex characters (32 bytes)"),
  PATCHWORK_ACCESS_CODE: z.string().min(4).default("patchwork-demo"),

  // Switch
  SWITCH_MODE: z.enum(["live", "simulator"]).default("simulator"),
  SWITCH_BRIDGE_URL: z.string().url().optional(),
  SWITCH_REGISTRATION_TOKEN: z.string().optional(),
  SWITCH_AGENT_PREFIX: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/).default("patchwork"),
  SWITCH_ROOM_INTERNAL_ONLY: z.enum(["true", "false"]).default("false"),
  SWITCH_HUMAN_USERNAMES: z.string().default(""),

  // AI
  AI_PROVIDER: z.enum(["anthropic"]).default("anthropic"),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_BASE_URL: z.string().optional(),
  ANTHROPIC_FALLBACKS: z.enum(["true", "false"]).default("true"),
  TRIAGE_MODEL: z.string().default("claude-haiku-5-5"),
  INVESTIGATOR_MODEL: z.string().default("claude-opus-5-5"),
  FIXER_MODEL: z.string().default("claude-opus-5-5"),
  QA_MODEL: z.string().default("claude-sonnet-5-5"),
  AGENT_MAX_STEPS: z.coerce.number().int().min(4).max(200).default(40),
  AGENT_TIMEOUT_MS: z.coerce.number().int().min(10_000).default(600_000),

  // GitHub
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GITHUB_API_URL: z.string().url().default("https://api.github.com"),

  // Execution
  PATCHWORK_WORKSPACES_DIR: z.string().default(".patchwork/workspaces"),
  EXECUTION_MODE: z.enum(["process", "docker"]).default("process"),
  EXECUTION_DOCKER_IMAGE: z.string().default("node:22-bookworm-slim"),
  EXECUTION_TIMEOUT_MS: z.coerce.number().int().min(1000).default(120_000),
  EXECUTION_MAX_OUTPUT_BYTES: z.coerce.number().int().min(1024).default(200_000),
  MAX_FIX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
});

export type AppConfig = z.infer<typeof schema>;

let cached: AppConfig | null = null;

export function config(): AppConfig {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid PATCHWORK configuration: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test hook: forget the cached config after mutating process.env. */
export function resetConfigForTests() {
  cached = null;
}
