# claude-triggers

Manage Claude Code's scheduled remote agents from **any** harness — [pi](https://github.com/mariozechner/pi-coding-agent), [opencode](https://github.com/opencode-ai/opencode), your own tools, or plain CLI.

> **⚠️ Important: Read the [Disclaimer](#disclaimer) before using this package.**

---

## What This Is

A standalone TypeScript library and CLI that reimplements Claude Code's `/schedule` command as a portable module. It talks directly to Anthropic's trigger, session, environment, and file APIs using your existing Claude Code OAuth credentials.

This was reverse-engineered from Claude Code v2.1.81's bundled `cli.js`. The `/schedule` command and `RemoteTrigger` tool are new in that version (absent in v2.1.78).

## How It Works

```
┌──────────────────┐       ┌──────────────────────────────┐
│  Your Tool / CLI  │──────▶│  claude-triggers (this pkg)   │
│  pi / opencode    │       │                              │
└──────────────────┘       │  1. Read OAuth token from     │
                           │     macOS Keychain or         │
                           │     ~/.claude/.credentials    │
                           │  2. Resolve org UUID via      │
                           │     /api/oauth/profile        │
                           │  3. Call trigger/session APIs  │
                           │     with correct beta headers │
                           └──────────────┬───────────────┘
                                          │
                                          ▼
                           ┌──────────────────────────────┐
                           │  Anthropic API               │
                           │  api.anthropic.com            │
                           │                              │
                           │  /v1/code/triggers    (CRUD)  │
                           │  /v1/sessions         (CCR)   │
                           │  /v1/environment_providers     │
                           │  /v1/files            (upload)│
                           └──────────────┬───────────────┘
                                          │
                                          ▼
                           ┌──────────────────────────────┐
                           │  Anthropic Cloud (CCR)        │
                           │  Sandboxed environment with:  │
                           │  - Fresh git checkout         │
                           │  - Bash, Read, Write, Edit... │
                           │  - Optional MCP connections   │
                           │  - GitHub MCP (auto-attached) │
                           └──────────────────────────────┘
```

Each trigger fires on a UTC cron schedule, spawning an **isolated cloud session** (CCR — Claude Code Remote). The agent runs in a sandbox with its own git clone, tool access, and optional MCP connections. It cannot access your local machine.

## Install

```bash
npm install -g claude-triggers
```

Or without installing:

```bash
npx claude-triggers test
```

## Prerequisites

- **Claude Code** installed and logged in (run `claude` at least once to create credentials)
- **Claude Max or Pro** subscription (OAuth-based — API keys don't work for these endpoints)
- **Node.js 20+**
- The trigger API may require the `tengu_surreal_dali` feature flag on your account (currently rolling out)

---

## CLI Reference

### Auth & Connectivity

```bash
claude-triggers test                   # Test auth, profile, envs, triggers, sessions, github
claude-triggers profile                # Show account, org, plan, tier
claude-triggers profile --json         # Raw JSON (all commands support --json)
```

### Triggers

```bash
# List
claude-triggers list                   # Summary view
claude-triggers list -v                # Verbose: prompts, models, repos, MCP connections

# Create
claude-triggers create \
  --name "daily-pr-review" \
  --cron "0 9 * * 1-5" \
  --prompt "Review all open PRs and post summary comments" \
  --repo "https://github.com/org/repo" \
  --model "claude-sonnet-4-6" \
  --tools "Bash,Read,Write,Edit,Glob,Grep"

# Read / Update / Toggle
claude-triggers get <id>
claude-triggers update <id> --name "new-name"
claude-triggers update <id> --cron "0 */2 * * *"
claude-triggers update <id> --prompt "New instructions"
claude-triggers update <id> --model "claude-opus-4-6"
claude-triggers enable <id>
claude-triggers disable <id>

# Run immediately (doesn't wait for cron)
claude-triggers run <id>

# Delete (opens browser — the API has no DELETE endpoint)
claude-triggers delete <id>
```

### Sessions

```bash
# List all remote sessions
claude-triggers sessions

# Get session details (status, model, sources, MCP config)
claude-triggers session <id>

# Create a session directly — no trigger/cron needed
claude-triggers session-create \
  --env <environment_id> \
  --prompt "Run the test suite and report failures" \
  --repo "https://github.com/org/repo" \
  --title "One-off test run"
```

### Infrastructure

```bash
claude-triggers envs                          # List environments
claude-triggers env-create "staging"          # Create a new environment
claude-triggers github-check owner/repo       # Check GitHub App + token sync
```

---

## Library API

```typescript
import {
  ClaudeTriggersClient,
  buildTriggerBody,
  describeCron,
  validateCron,
} from "claude-triggers";

// Create client (auto-reads credentials, resolves org UUID)
const client = await ClaudeTriggersClient.create();

// Or with explicit token
const client = new ClaudeTriggersClient({ accessToken: "sk-ant-..." });
await client.init();
```

### Triggers

```typescript
// Create
const env = await client.ensureEnvironment();
const trigger = await client.createTrigger(
  buildTriggerBody({
    name: "nightly-tests",
    cron: "0 3 * * *",              // Daily 3am UTC
    prompt: "Run the full test suite and report failures",
    environmentId: env.environment_id,
    repoUrl: "https://github.com/org/repo",
    model: "claude-sonnet-4-6",     // Optional, defaults to sonnet 4.6
  })
);

// Read
const all = await client.listTriggers();        // { data: Trigger[], has_more }
const one = await client.getTrigger(trigger.id); // Trigger

// Update
await client.updateTrigger(trigger.id, { name: "new-name" });
await client.updateTrigger(trigger.id, { cron_expression: "0 */2 * * *" });
await client.enableTrigger(trigger.id);
await client.disableTrigger(trigger.id);

// Run immediately
await client.runTrigger(trigger.id);
```

### Sessions (Direct — No Trigger Needed)

```typescript
// Create a one-off remote session
const session = await client.createSession({
  environmentId: env.environment_id,
  prompt: "Refactor the auth module and open a PR",
  repoUrl: "https://github.com/org/repo",
  title: "Auth refactor",
});
// Returns { id, title }

// Send follow-up messages
await client.sendSessionEvent(session.id, "Also update the tests");

// Fetch conversation history
const events = await client.getSessionEvents(session.id);
// Returns array of { type, message: { role, content }, ... }

// Poll status
const detail = await client.getSession(session.id);
// session_status: "pending" | "running" | "idle" | "completed" | "failed"

// Extract git branch from session outcomes
const branch = client.getSessionBranch(detail);
```

### Files

```typescript
// Upload a file (for seed bundles)
const file = await client.uploadFile(buffer, "seed.bundle", "user_data");
// Returns { id, filename, size }
```

### GitHub Integration

```typescript
await client.checkGitHubTokenSync();               // boolean
await client.checkGitHubAppInstalled("org", "repo"); // { installed, status }
```

### Cron Utilities

```typescript
import { parseCron, nextCronDate, validateCron, describeCron, intervalToCron } from "claude-triggers";

parseCron("0 9 * * 1-5");              // CronFields | null
nextCronDate(fields, new Date());       // Date | null
validateCron("*/5 * * * *");            // "Minimum trigger interval is 1 hour..." | null
describeCron("0 9 * * 1-5", { utc: true }); // "Weekdays at 9:00am UTC"
intervalToCron("2h");                   // "0 */2 * * *"
```

---

## API Surface

All endpoints require OAuth Bearer auth + `x-organization-uuid` header.

### Trigger API

| Method | Endpoint | Beta Header |
|--------|----------|-------------|
| `GET` | `/v1/code/triggers` | `ccr-triggers-2026-01-30` |
| `GET` | `/v1/code/triggers/{id}` | `ccr-triggers-2026-01-30` |
| `POST` | `/v1/code/triggers` | `ccr-triggers-2026-01-30` |
| `POST` | `/v1/code/triggers/{id}` | `ccr-triggers-2026-01-30` |
| `POST` | `/v1/code/triggers/{id}/run` | `ccr-triggers-2026-01-30` |

### Session API

| Method | Endpoint | Beta Header |
|--------|----------|-------------|
| `GET` | `/v1/sessions` | `ccr-byoc-2025-07-29` |
| `GET` | `/v1/sessions/{id}` | `ccr-byoc-2025-07-29` |
| `POST` | `/v1/sessions` | `ccr-byoc-2025-07-29` |
| `GET` | `/v1/sessions/{id}/events` | `ccr-byoc-2025-07-29` |
| `POST` | `/v1/sessions/{id}/events` | `ccr-byoc-2025-07-29` |

### Environment API

| Method | Endpoint | Beta Header |
|--------|----------|-------------|
| `GET` | `/v1/environment_providers` | `ccr-byoc-2025-07-29` |
| `POST` | `/v1/environment_providers/cloud/create` | `ccr-byoc-2025-07-29` |

### Files API

| Method | Endpoint | Beta Header |
|--------|----------|-------------|
| `POST` | `/v1/files` | `files-api-2025-04-14` |

### Other Endpoints Used

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/oauth/profile` | Account + org UUID |
| `GET` | `/api/oauth/organizations/{org}/sync/github/auth` | GitHub token sync |
| `GET` | `/api/oauth/organizations/{org}/code/repos/{owner}/{repo}` | GitHub App check |
| `POST` | `platform.claude.com/v1/oauth/token` | Token refresh |

---

## Features Beyond Claude Code's /schedule

This package exposes several APIs that the `/schedule` slash command in Claude Code does not surface to the user:

| Feature | Claude Code `/schedule` | `claude-triggers` |
|---------|------------------------|-------------------|
| Trigger CRUD | ✓ (via LLM mediation) | ✓ (direct API) |
| Run trigger | ✓ | ✓ |
| Create session directly | ✗ | ✓ `createSession()` |
| Fetch session events | ✗ | ✓ `getSessionEvents()` |
| Send events to sessions | ✗ | ✓ `sendSessionEvent()` |
| File upload (seed bundles) | ✗ | ✓ `uploadFile()` |
| GitHub App install check | ✗ | ✓ `checkGitHubAppInstalled()` |
| GitHub token sync check | ✗ | ✓ `checkGitHubTokenSync()` |
| Session branch extraction | ✗ | ✓ `getSessionBranch()` |
| Update prompt/model in-place | ✗ (requires full replace) | ✓ (smart merge) |
| Cron validation before send | ✗ (server-side only) | ✓ (client-side + 1h min) |
| Direct OAuth token refresh | ✗ (shells to CLI) | ✓ (grant_type=refresh_token) |
| Programmatic/scriptable | ✗ (conversational UI) | ✓ (library + CLI + JSON) |

---

## Implementation Notes

### Session Creation Flow

Claude Code creates sessions with `events: []` (empty), then sends the initial prompt via a separate `POST /v1/sessions/{id}/events` call. This package follows the same two-step pattern. Sending events inline in the create request returns `400 Bad Request` (`type field value mismatch: expected "event", got "user"`).

### Token Refresh

Tokens are refreshed via a direct `POST` to `platform.claude.com/v1/oauth/token` with `grant_type: refresh_token` and Claude Code's client ID (`9d1c250a-e61b-44d9-88ed-5944d1962f5e`). Refreshed tokens are written back to both macOS Keychain and `~/.claude/.credentials.json` so other tools pick them up. Falls back to shelling out to `claude` CLI if the direct refresh fails.

### Credential Sources

Checked in order:
1. macOS Keychain entry `"Claude Code-credentials"`
2. `~/.claude/.credentials.json` (fallback, works on all platforms)

### Feature Flags

The trigger API is gated behind `tengu_surreal_dali` (default: off, rolling out) and the `allow_remote_sessions` organization policy. If your account doesn't have access, trigger API calls will return 403.

### Auto-Attached GitHub MCP

When a trigger or session has a GitHub repo source, Anthropic's backend automatically provisions a GitHub MCP server scoped to that repo. The session gets tools like `mcp__github__create_pull_request`, `mcp__github__list_issues`, etc. No manual MCP configuration needed for GitHub.

### Cron Constraints

- 5-field standard cron (minute hour day-of-month month day-of-week)
- **Always UTC** — there is no timezone field
- **Minimum interval: 1 hour** — expressions like `*/30 * * * *` are rejected by the API
- Anthropic adds a small server-side jitter to prevent thundering herd

---

## Disclaimer

**This software is provided as-is, without warranty of any kind.** By using this package, you acknowledge and accept the following:

### Reverse-Engineered APIs

This package interacts with **undocumented, internal Anthropic APIs** that were discovered through reverse engineering of Claude Code's client-side bundle. These APIs:

- Are **not publicly documented** and have no stability guarantees
- Use **beta headers** (`ccr-triggers-2026-01-30`, `ccr-byoc-2025-07-29`) that may be revoked at any time
- May **change, break, or be removed** without notice in any Claude Code update
- Are **gated behind feature flags** that Anthropic controls server-side

### Terms of Service

Anthropic's [Terms of Service](https://www.anthropic.com/terms) and [Acceptable Use Policy](https://www.anthropic.com/aup) govern all interactions with their APIs. Using OAuth credentials obtained through Claude Code with third-party tools **may violate these terms**. Specifically:

- Claude Pro/Max subscription tokens are intended for use with **official Anthropic clients**
- Programmatic access outside official clients may be considered unauthorized use
- Anthropic reserves the right to **suspend or terminate accounts** that violate their terms

### Your Responsibility

- **Use at your own risk.** The authors are not responsible for any consequences including but not limited to: account suspension, billing charges, data loss, or service interruption.
- **Do not use this for anything that violates Anthropic's AUP** — no automated abuse, no credential sharing, no circumventing rate limits.
- **You are solely responsible** for ensuring your use complies with all applicable terms, policies, and laws.
- This package does not bypass any authentication — it uses credentials **you** have already obtained through legitimate use of Claude Code.

### No Affiliation

This project is **not affiliated with, endorsed by, or sponsored by Anthropic**. "Claude", "Claude Code", and "Anthropic" are trademarks of Anthropic, PBC.

---

## License

MIT — see [LICENSE](./LICENSE).
