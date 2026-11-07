import path from "path";

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/patchwork_test?schema=public";
process.env.AUTH_SECRET = "test-auth-secret-0123456789abcdef";
process.env.ENCRYPTION_KEY = "a".repeat(64);
process.env.SWITCH_MODE = process.env.SWITCH_MODE_FOR_TESTS ?? "simulator";
process.env.PATCHWORK_WORKSPACES_DIR = path.resolve("tests/.tmp/workspaces");
process.env.PATCHWORK_DEMO_REPO_PATH = path.resolve("demo/broken-registration-app");
process.env.ANTHROPIC_API_KEY = "";
process.env.PATCHWORK_HANDOFF_ACK_MS = "4000";
