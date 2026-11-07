# PATCHWORK

**A team that fixes things together.**

PATCHWORK takes a software bug from report to verified fix with a team of four specialised AI agents — **Triage**, **Investigator**, **Fixer** and **QA** — that collaborate in a shared [Switch](https://github.com/sandbox-quantum/switch) room. Every handoff between agents is a Switch message. A human developer watches the work as it happens, can talk to the agents in the same room, and makes the final call: nothing is merged or deployed without explicit approval.

> PATCHWORK turns isolated AI coding assistants into a coordinated engineering team.

---

## Contents

- [What it does](#what-it-does)
- [How Switch powers PATCHWORK](#how-switch-powers-patchwork)
- [Architecture](#architecture)
- [The four agents](#the-four-agents)
- [The Evidence Trail](#the-evidence-trail)
- [Workflow](#workflow)
- [Security model](#security-model)
- [Setup](#setup)
- [Connecting Switch](#connecting-switch)
- [Connecting GitHub](#connecting-github)
- [Running the demo](#running-the-demo)
- [Testing](#testing)
- [Limitations and manual configuration](#limitations-and-manual-configuration)
- [Project structure](#project-structure)

---

## What it does

1. A developer reports a bug against a connected repository.
2. PATCHWORK creates a **Switch room** for the incident and adds its four agents plus a relay identity.
3. **Triage** classifies the report, sets severity, writes a testable hypothesis and delegates to the Investigator — by @mentioning it in the room.
4. **Investigator** reads the repository (read-only), runs the tests to reproduce the failure, and reports the root cause with evidence.
5. **Fixer** makes the smallest safe change on an isolated branch `patchwork/incident-<n>-fix`. PATCHWORK commits it and captures the diff.
6. **QA** independently reviews the diff and runs the tests. On failure it sends the evidence back to the Fixer (up to 3 automatic attempts, then the incident is **BLOCKED** for a human).
7. When QA passes, Triage asks for **human approval**. Approving opens a GitHub pull request (or preserves the branch for a local repository). **Approval never merges.**

Everything is visible live: agent status, the room conversation, every tool call, every test run, and the Evidence Trail.

## How Switch powers PATCHWORK

Switch is the open-source layer that puts AI agents and people into shared rooms (bridged to Slack, Teams, Discord, Telegram or Mattermost). PATCHWORK is a **custom Switch agent client**: it implements the [Switch agent protocol](https://docs.switchagents.ai/flintai/switch/internals/agent-protocol) ("SSE down, HTTP up") directly. The integration lives in [`src/lib/switch/`](src/lib/switch).

| Protocol piece (Switch docs) | What PATCHWORK does with it |
| --- | --- |
| `POST /agents` with the server's registration token | Registers five agents once: `patchwork-triage`, `-investigator`, `-fixer`, `-qa`, and `-relay` (the PATCHWORK Console voice for humans). Connection model `always_on`. API keys are stored AES-256-GCM encrypted and re-verified with `GET /agents/{id}/ops` on boot. |
| `GET /agents/{id}/events` (SSE) | One stream per agent. The four agents use `filter=addressed`, so they only wake for messages that @mention them. The relay uses `filter=all` to record what humans say in the room and confirm delivery of PATCHWORK's own messages. |
| `POST /agents/{id}/connection/beat` | Heartbeat at the interval the server announces in `connection_state` (2 s). A 404/409 reopens the stream with the **same client-owned connection id** and `Last-Event-ID`; `evicted` frames reconnect with backoff; `gap` frames are carried onto the next event; duplicate sequences are dropped. |
| `create_room` operation | One room per incident (`patchwork-inc-<n>`) with all five agents and room instructions describing the team. Bridged to the server's default messaging app unless `SWITCH_ROOM_INTERNAL_ONLY=true`. |
| `POST /agents/{id}/message` with `@name` mentions | Every handoff. The message is readable text for people in the room, plus a short HMAC-signed `[pw:…]` marker carrying the incident id, task key and attempt. Switch delivers it to the mentioned agent's stream as an **addressed** event, and that delivery is what starts the agent's work. |
| `list_participants`, `read_context` | Verifying room membership; reading history. |

What this gives the workflow:

- **Agents only act on what Switch delivers.** The orchestrator never calls the next agent directly. A handoff that is not picked up within 60 s is redelivered once through Switch, then the incident fails loudly ("agent did not respond via Switch").
- **Forgery-resistant routing.** Work is only accepted from PATCHWORK's own identities with a valid signed marker. Anyone else who @mentions an agent is recorded as a room message and becomes shared context, but cannot drive the workflow.
- **People are first-class participants.** Messages typed in the PATCHWORK UI are relayed into the room by `patchwork-relay` and answered by the addressed agent; in a bridged room, people can also write directly from Slack/Mattermost and PATCHWORK records it.
- **Idempotency.** Each handoff carries a task key; duplicate deliveries collapse onto one task (`AgentTask @@unique([incidentId, key])`).
- **Visible connection state.** The header pill, Settings page and incident metadata show the mode, room id and per-identity stream state. Each room message shows "Delivered through Switch" once the relay sees it come back.

### Live mode vs. the local simulator

`SWITCH_MODE=live` talks to a real Switch server. `SWITCH_MODE=simulator` (the default, so the app runs out of the box) uses [`simulator.ts`](src/lib/switch/simulator.ts): an in-process implementation of the same semantics (rooms, membership, @mention addressing, per-agent sequenced buffers). **It is not Switch**, and the UI says so everywhere: the header shows "Switch simulator", the dashboard shows a banner, incidents show "Simulated locally", and messages say "Delivered through Switch simulator". Both modes implement the same `SwitchBackend` interface, so the workflow code is identical.

## Architecture

```
Browser (Next.js App Router, TanStack Query, SSE)
   │  REST + Server-Sent Events (Last-Event-ID resume)
Next.js route handlers ── auth, validation (Zod), authorization per workspace
   │
Orchestrator (src/orchestration) ── state machine, idempotent tasks, retry limits,
   │                                 watchdog, honesty checks, approval gate
   ├── Switch collaboration (src/lib/switch) ── 5 identities, SSE streams, rooms, messages
   ├── Agents (src/agents) ── Anthropic tool-use loop, structured outputs, workspace tools
   ├── Repository workspaces (src/lib/execution) ── git checkout per incident, allowlisted commands
   ├── GitHub (src/lib/github) ── repos, clone, push branch, open PR (never merge)
   └── PostgreSQL via Prisma ── incidents, messages, evidence, diffs, test runs, approvals, events
```

- **Events are persisted before they are broadcast** (`ActivityEvent.seq` is the SSE id). Clients resume with `Last-Event-ID`, dedupe by sequence and sort, so drops, duplicates and out-of-order delivery converge.
- **Background runtime** starts in `instrumentation.ts`: it seeds agent records, connects all Switch identities, and on restart marks interrupted work as FAILED with a Retry path (findings are preserved).
- **AI provider abstraction** ([`src/lib/ai`](src/lib/ai)): the agent loop depends on a small `LLMProvider` interface; the Anthropic implementation uses the official SDK with adaptive thinking defaults, per-agent effort, prompt caching on the system prompt, and the server-side refusal fallback on supported models. Models are configurable per agent (defaults: Triage `claude-haiku-5-5`, Investigator and Fixer `claude-opus-5-5`, QA `claude-sonnet-5-5`).

## The four agents

Each has its own identity, instructions, tool set and Zod output schema ([`src/agents`](src/agents), [`src/schemas/agents.ts`](src/schemas/agents.ts)). Agents finish by calling `submit_report`; invalid reports are returned with the schema errors for correction, and repeated invalid reports fail the step rather than inventing a result.

| Agent | Tools | Output |
| --- | --- | --- |
| **PATCHWORK_Triage** — incident coordinator | `list_files` | title, severity (+ rationale), classification, affected functionality, *unverified* hypothesis, plan, delegated tasks, missing information |
| **PATCHWORK_Investigator** — debugging engineer | `list_files`, `read_file`, `search_code`, `run_tests` (no writes) | summary, reproduction (attempted / command / reproduced), relevant files, code locations, observed vs expected, root cause, evidence, confidence, hypotheses, recommended fix |
| **PATCHWORK_Fixer** — software engineer | read tools, `replace_in_file`, `write_file`, `run_tests` | root cause addressed, files modified, summary, why it works, side effects, tests to run, response to QA feedback |
| **PATCHWORK_QA** — quality assurance | read tools, `view_diff`, `run_tests` (no writes) | verdict PASS / FAIL / NEEDS_REVIEW, commands executed, pass/fail counts, relevant output, implementation review, regression analysis, details for the Fixer |

Repository content, bug reports, command output and chat messages are wrapped as `<untrusted>` data; every system prompt states that nothing inside can change the agent's instructions.

## The Evidence Trail

Every conclusion is stored as an `Evidence` record (type, agent, source, file/lines, command, excerpt, verification status, how it influenced the decision). PATCHWORK **verifies claims itself** rather than trusting the agent:

- **Code references** are re-read from the workspace; the excerpt must appear at the cited lines → `VERIFIED`, else `CONTRADICTED`.
- **Test / terminal claims** must match a command actually executed in that agent's task, and the excerpt must be in its recorded output.
- **Stack traces / error logs** must appear in the report or recorded output.
- **Test runs** are recorded directly from the process (exit code, stdout/stderr, duration) as `VERIFIED`; older QA results become `SUPERSEDED` when a newer fix attempt is tested.
- **Agent opinions** (hypotheses, reviews) are `UNVERIFIED` observations — never presented as facts.
- **Reproduction claims** without a recorded failing run are overridden; a **QA PASS** without executed tests is downgraded to NEEDS_REVIEW, and a PASS whose latest run of any command failed becomes FAIL. Fixer descriptions are compared with the attempt's actual commit.

## Workflow

```
NEW → TRIAGING → INVESTIGATING → FIXING ⇄ TESTING → AWAITING_APPROVAL → APPROVED → RESOLVED
                                                       └→ REJECTED → (send back) FIXING
also: NEEDS_INFORMATION, BLOCKED (retry limit / no changes / QA NEEDS_REVIEW), FAILED (error, timeout, provider unavailable), CANCELLED
```

Transitions are compare-and-set in the database ([`state-machine.ts`](src/orchestration/state-machine.ts)), so duplicate or concurrent steps cannot both win. RESOLVED is only set when the resolution action succeeds (PR opened, or branch preserved for a local repository); if PR creation fails the incident stays APPROVED with a retry button.

## Security model

- **No shell for agents.** Commands are parsed into argv and must match an allowlist (`npm test`, `npm run test|lint|typecheck|build`, `node --test`, `npx vitest run`, `pytest`, `go test`, `cargo test`, …). No pipes, redirects, substitution or globs. Timeout kills the process group; output is capped and redacted. The environment carries no credentials, and `HOME`/caches live outside the checkout.
- **Optional container isolation:** `EXECUTION_MODE=docker` runs commands with `--network none`, memory/CPU/PID limits and a read-only root.
- **File access** is confined to the incident's checkout (no `..`, absolute paths, `.git`, or symlink escapes; `.env` writes blocked).
- **The default branch is never modified.** Merging and deploying are not implemented at all.
- **Secrets:** GitHub tokens and Switch agent keys are AES-256-GCM encrypted at rest, never sent to the browser or to agents (git auth goes through `GIT_CONFIG_*` env, not argv or `.git/config`), and redacted from stored text.
- **Authorization:** every API route checks the session and workspace membership server-side.

## Setup

**Requirements:** Node.js 20+ (22 recommended), PostgreSQL 14+, git. An Anthropic API key for agents to do real work.

```bash
npm install
```

```bash
cp .env.example .env
```

Fill in `AUTH_SECRET` and `ENCRYPTION_KEY` (each `openssl rand -hex 32`), `DATABASE_URL`, and `ANTHROPIC_API_KEY`. See [`.env.example`](.env.example) for every variable.

Create the database schema and seed a demo user and repository:

```bash
npx prisma migrate deploy
```

```bash
npm run db:seed
```

Run it:

```bash
npm run build && npm start
```

or for development:

```bash
npm run dev
```

Open http://localhost:3000, click **Open Workspace**, and sign in with any name and email plus the `PATCHWORK_ACCESS_CODE` (default `patchwork-demo`).

**Docker:** `docker compose up --build` starts PostgreSQL and PATCHWORK (migrations and seed run on start). Switch runs separately; the compose file points `SWITCH_BRIDGE_URL` at `host.docker.internal:8000` by default.

## Connecting Switch

1. **Run a Switch server.** Either install [Switch Console](https://github.com/sandbox-quantum/switch#get-started-in-two-steps) and let it run a server for you, or self-host the standalone Compose stack ([docs](https://docs.switchagents.ai/flintai/switch/deploy/self-host)) — it publishes the API on port 8000 and needs `AGENT_REGISTRATION_TOKEN` set before first start. Add the `collab` profile to get a Mattermost to watch the rooms in.
2. **Find the agent bridge URL.** It is the server's *API URL* (not the Gateway URL). Check it: `curl $SWITCH_BRIDGE_URL/health` → `{"status":"ok"}`.
3. **Configure PATCHWORK** in `.env`:
   ```
   SWITCH_MODE="live"
   SWITCH_BRIDGE_URL="http://localhost:8000"
   SWITCH_REGISTRATION_TOKEN="<the server's AGENT_REGISTRATION_TOKEN>"
   ```
   Optional: `SWITCH_HUMAN_USERNAMES` adds your chat usernames to every incident room; `SWITCH_ROOM_INTERNAL_ONLY=true` makes agent-only rooms.
4. **Verify end to end:**
   ```bash
   npm run switch:check
   ```
   It checks `/health`, registers (or reuses) the five agents, opens their streams, creates a room, has the relay @mention Triage, and waits until Switch delivers that message to Triage's stream.
5. Restart PATCHWORK. The header should read **Switch connected**.

PATCHWORK's agents share the registration token's owner, which Switch's default addressing policy (`owner_and_owner_agents`) allows to address one another. To let other people in a bridged room @mention the agents directly, change the agents' addressing in Switch Console.

## Connecting GitHub

On **Repositories**, either:

- paste a **fine-grained personal access token** with *Contents: read & write* (to push the fix branch) and *Pull requests: read & write* on the repositories you want to use, or
- configure a GitHub OAuth App (`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, callback `$APP_URL/api/github/oauth/callback`, scope `repo`) and click **Connect with GitHub**.

Then **Connect repository** and pick one. Each incident clones it into `PATCHWORK_WORKSPACES_DIR/<incident-id>` and creates `patchwork/incident-<n>-fix`. Approving a fix pushes that branch and opens a pull request with the issue, root cause, fix, QA results and evidence summary. It never merges.

## Running the demo

The bundled repository [`demo/broken-registration-app`](demo/broken-registration-app) is a dependency-free Node service whose `POST /api/register` returns **HTTP 500**: the handler reads `user.profile.displayName`, but `UserStore.createUser` never creates a profile. `npm test` has 8 tests; 4 fail before the fix. A tempting null-safe patch (`user.profile?.displayName`) still fails 3 of them, because the profile endpoint and `displayName` fallback need a real profile — so the QA → Fixer loop can happen naturally.

1. Make sure `ANTHROPIC_API_KEY` is set (and ideally `SWITCH_MODE=live`).
2. **Report a Bug** → **Use demo scenario** → **Start Investigation**.
   - Title: *Registration endpoint returns HTTP 500*
   - Description: *Users cannot complete registration. The endpoint returns a server error instead of creating an account. Please investigate and fix the problem.*
3. Watch the incident page (or the **Collaboration room**, or the bridged channel in your chat app): Triage classifies it, the Investigator reproduces the failure with `npm test` and cites the code, the Fixer commits to the incident branch, QA runs the tests and either passes it or sends the failure back.
4. In the room, try *"Do not modify the API response format."* — it is relayed through Switch, answered by the addressed agent, and included in every later agent's context.
5. Review the evidence, diff and test output, then **Approve Fix** (the local demo keeps the branch; a GitHub repo gets a pull request) or **Reject Fix** with a reason and send it back to the Fixer.

The agents' actual messages depend on what they find; nothing in the conversation is scripted.

**Suggested 3-minute pitch:** the problem (assistants without shared context) → PATCHWORK's team in one Switch room → live run of the demo, pausing on the Investigator's verified evidence and QA's executed tests → the approval gate → how Switch carries every handoff (show the Switch deliveries panel / `npm run switch:check`) → "PATCHWORK doesn't just give developers another AI assistant. It gives their AI assistants a team."

## Testing

```bash
npm test                 # unit + integration (Vitest; needs PostgreSQL, uses database patchwork_test)
```

```bash
npm run build && npm run test:e2e   # browser tests (Playwright, against a production build on :3100)
```

The integration tests run the **real** workflow — Prisma/PostgreSQL, Switch messaging, git workspaces, file edits, `npm test` execution in the demo repo, evidence verification — with only the language model replaced by a deterministic test script ([`tests/helpers/scripted-provider.ts`](tests/helpers/scripted-provider.ts)) whose decisions depend on the real tool output. That stand-in exists only in `tests/` and cannot be enabled in the app.

| Suite | Covers |
| --- | --- |
| `tests/unit/security.test.ts` | command allowlist (incl. injection attempts), secret redaction, encryption, session signing, path confinement and symlink escapes, signed handoff markers and forgery |
| `tests/unit/rules.test.ts` | state machine, QA verdict enforcement, incident/approval validation, agent output schemas |
| `tests/integration/workflow.test.ts` | full lifecycle incl. a QA failure loop; evidence verification (a fabricated reference is CONTRADICTED); branch isolation; message delivery; human message relay + agent reply; approval; retry limit → BLOCKED; PASS without tests refused; rejection |
| `tests/integration/switch-http.test.ts` | the live HTTP+SSE client against a protocol mock: registration, streams, full workflow over HTTP, heartbeat-404 reconnect with same connection id + `Last-Event-ID`, eviction recovery, room creation failure + retry, credential reuse, bad registration token |
| `tests/integration/failures.test.ts` | agent timeout, invalid agent responses, AI provider unavailable, cancellation, transient Switch delivery failures, dropped handoff redelivery, command timeout, GitHub permission errors, PR creation failure, lost simulator room |
| `tests/e2e/app.spec.ts` | sign-in, auth on APIs, form validation, reporting the demo bug, honest failure without an AI key, the room conversation, live updates without reload, every page |

Latest run: **57/57** Vitest tests and **3/3** Playwright tests passing.

## Limitations and manual configuration

- **Switch was not exercised against a real Switch server during development.** The sandbox this was built in could not run Switch Core. The live client was written from the official protocol documentation and source (`sandbox-quantum/switch`) and tested against a mock bridge that serves the documented endpoints. Run `npm run switch:check` against your server to confirm; if the server's responses differ from the docs, the check names the failing step.
- **An AI provider key is required for real agent work.** Without `ANTHROPIC_API_KEY`, incidents stop at triage with "AI provider unavailable" (no results are invented). Only an Anthropic provider is implemented; the `LLMProvider` interface is the extension point.
- **Simulator rooms live in memory.** After a restart in simulator mode, PATCHWORK recreates an incident's room on the next message. Live Switch rooms persist on the server.
- **Process isolation by default.** `EXECUTION_MODE=process` runs allowlisted test commands as child processes on the host with timeouts and a scrubbed environment; use `EXECUTION_MODE=docker` for container isolation (requires Docker on the host). Dependency installation for arbitrary repositories is not automated; projects whose tests need `npm ci` should allow `npm ci --ignore-scripts` (already allowlisted) or use a prepared image.
- **Sign-in is a demo access mechanism** (shared access code + name/email), not production authentication.
- **One PATCHWORK server process per database.** On boot it marks work interrupted by a restart as FAILED (with Retry); two app processes sharing a database would interfere.
- Docker Compose / Dockerfile were written but not built in the development sandbox.

## Project structure

```
app/                     Next.js App Router
  (marketing)/page.tsx   landing page
  (dashboard)/           dashboard, incidents, incident detail, room, agents, repositories, activity, settings
  api/                   typed route handlers (auth, workspaces, repositories, github, incidents, agents, events/SSE)
components/              UI (ui primitives, layout, incidents, evidence, collaboration, agents)
src/
  agents/                base loop + tools, triage, investigator, fixer, qa, consult
  orchestration/         workflow, state machine, task manager, context, approval, event handler, runtime
  lib/switch/            Switch agent-protocol client, simulator, identities, rooms, messages, adapter
  lib/ai/                provider interface + Anthropic implementation
  lib/execution/         git, workspaces, allowlisted runner, confined file tools
  lib/github/            REST client, encrypted token storage
  lib/security/          crypto, redaction, command policy, untrusted-content wrapping
  services/              incidents, evidence verification, repositories, room messages, status
  schemas/               Zod schemas (incident input, agent outputs)
prisma/                  schema, migrations, seed
demo/broken-registration-app/   demo repository with the deliberate bug
scripts/switch-check.ts  end-to-end Switch connectivity check
tests/                   unit, integration, e2e
```

Built for the [Flip the Switch hackathon](https://www.wemakedevs.org/hackathons/switch).
