# Architecture

> Reverse-engineered from Claude Code v2.1.81. All endpoints use undocumented beta headers that may change without notice.

## Overview

Claude Code v2.1.81 introduced `/schedule` — a command that creates **remote triggers** running in Anthropic's cloud. This is separate from the pre-existing local `/loop` + Kairos cron system.

```
┌─────────────────────────────────────────────────────────────┐
│                       USER / HARNESS                         │
├────────────────────────────┬────────────────────────────────┤
│  /schedule (remote)        │  /loop (local)                 │
│                            │                                │
│  claude-triggers client    │  Kairos scheduler engine       │
│         │                  │  (in-memory + file cron)       │
│         ▼                  │         │                      │
│  POST /v1/code/triggers    │  .claude/scheduled_tasks.json  │
│  POST /v1/sessions         │         │                      │
│         │                  │         ▼                      │
│         ▼                  │  REPL prompt injection         │
│  Anthropic Cloud (CCR)     │  (fires when idle)             │
│  Sandboxed environment     │                                │
└────────────────────────────┴────────────────────────────────┘
```

## Feature Flags

| Flag | Default | Controls |
|:-----|:--------|:---------|
| `tengu_surreal_dali` | `false` | `/schedule` command + RemoteTrigger tool |
| `tengu_cobalt_lantern` | `false` | GitHub token sync |
| `tengu_kairos_cron` | `true` | Local `/loop` scheduler |
| `allow_remote_sessions` | org policy | Organization-level gate |

## API Surface

All requests require:
```
Authorization: Bearer {oauth_token}
Content-Type: application/json
anthropic-version: 2023-06-01
anthropic-beta: {endpoint-specific}
x-organization-uuid: {org_uuid}
```

### Triggers (`ccr-triggers-2026-01-30`)

| Method | Endpoint | Purpose |
|:-------|:---------|:--------|
| `GET` | `/v1/code/triggers` | List all triggers |
| `GET` | `/v1/code/triggers/{id}` | Get trigger |
| `POST` | `/v1/code/triggers` | Create trigger |
| `POST` | `/v1/code/triggers/{id}` | Update trigger |
| `POST` | `/v1/code/triggers/{id}/run` | Run now |
| — | — | No DELETE endpoint |

**Create body:**
```json
{
  "name": "daily-review",
  "cron_expression": "0 9 * * 1-5",
  "enabled": true,
  "job_config": {
    "ccr": {
      "environment_id": "env_...",
      "session_context": {
        "model": "claude-sonnet-4-6",
        "sources": [{"git_repository": {"url": "https://github.com/org/repo"}}],
        "allowed_tools": ["Bash", "Read", "Write", "Edit", "Glob", "Grep"]
      },
      "events": [{
        "data": {
          "uuid": "<v4>",
          "session_id": "",
          "type": "user",
          "parent_tool_use_id": null,
          "message": {"content": "prompt text", "role": "user"}
        }
      }]
    }
  },
  "mcp_connections": [
    {"connector_uuid": "...", "name": "slack", "url": "https://..."}
  ]
}
```

### Sessions (`ccr-byoc-2025-07-29`)

| Method | Endpoint | Purpose |
|:-------|:---------|:--------|
| `GET` | `/v1/sessions` | List sessions |
| `GET` | `/v1/sessions/{id}` | Get session detail |
| `POST` | `/v1/sessions` | Create session |
| `GET` | `/v1/sessions/{id}/events` | Fetch conversation history |
| `POST` | `/v1/sessions/{id}/events` | Send user message |

### Environments (`ccr-byoc-2025-07-29`)

| Method | Endpoint | Purpose |
|:-------|:---------|:--------|
| `GET` | `/v1/environment_providers` | List environments |
| `POST` | `/v1/environment_providers/cloud/create` | Create environment |

### Files (`files-api-2025-04-14`)

| Method | Endpoint | Purpose |
|:-------|:---------|:--------|
| `POST` | `/v1/files` | Upload file (multipart) |

### Auth & GitHub

| Method | Endpoint | Purpose |
|:-------|:---------|:--------|
| `GET` | `/api/oauth/profile` | Account + org UUID |
| `POST` | `platform.claude.com/v1/oauth/token` | Token refresh |
| `GET` | `/api/oauth/organizations/{org}/sync/github/auth` | GitHub token sync |
| `GET` | `/api/oauth/organizations/{org}/code/repos/{owner}/{repo}` | GitHub App check |

## Session Creation Flow

Claude Code creates sessions in two steps:

```
1. POST /v1/sessions
   Body: { title, events: [], session_context: { sources, outcomes: [], ... }, environment_id }
   → Returns: { id: "session_..." }

2. POST /v1/sessions/{id}/events
   Body: { events: [{ uuid, session_id, type: "user", message: { role: "user", content } }] }
   → Sends the initial prompt
```

Sending events inline in step 1 returns `400` — `type field value mismatch: expected "event", got "user"`.

## Session Lifecycle

```
pending  ──▶  running  ──▶  idle  ──▶  (follow-up via sendSessionEvent)
                │                          │
                ▼                          ▼
             failed                    completed
```

- **pending** — Environment provisioning (git clone, MCP setup)
- **running** — Agent executing (tool calls, thinking)
- **idle** — Agent finished processing, waiting for input
- **completed/failed/stopped** — Terminal

## Auto-Provisioned GitHub MCP

When a session references a GitHub repo, the backend auto-attaches a scoped MCP server:

```json
{
  "mcp_config": {
    "mcpServers": {
      "github": {
        "type": "http",
        "url": "https://api.anthropic.com/v2/ccr-sessions/{cse_id}/github/mcp"
      }
    }
  }
}
```

The session's system prompt is automatically extended with GitHub integration instructions and repo scope restrictions. No manual MCP configuration needed.

## Token Refresh

Tokens are refreshed via direct OAuth grant:

```
POST https://platform.claude.com/v1/oauth/token
{
  "grant_type": "refresh_token",
  "refresh_token": "...",
  "client_id": "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
  "scope": "user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload"
}
```

Refreshed tokens are written back to macOS Keychain and `~/.claude/.credentials.json` so Claude Code and other tools pick them up.

## Credential Sources

Checked in order:
1. macOS Keychain — `"Claude Code-credentials"` service
2. `~/.claude/.credentials.json` — JSON with `claudeAiOauth.{accessToken, refreshToken, expiresAt}`

## Cron Constraints

- 5-field standard: `minute hour day-of-month month day-of-week`
- Always **UTC** — no timezone field
- **Minimum interval: 1 hour** — sub-hour expressions rejected
- Server adds small jitter to prevent thundering herd
- Triggers auto-expire after 7 days in the local Kairos scheduler (cloud triggers don't expire)

## Symbol Map

Key minified symbols from `cli.js` v2.1.81:

| Symbol | Name | Purpose |
|:-------|:-----|:--------|
| `XEY` | `registerScheduleSkill` | `/schedule` registration |
| `MEY` | `buildSchedulePrompt` | System prompt builder |
| `k16` | `"RemoteTrigger"` | Tool name |
| `$p_` | `RemoteTriggerTool` | Tool implementation |
| `Eh` | `"CronCreate"` | Local cron tool |
| `i8A` | `createCronScheduler` | Kairos factory |
| `Gx` | `fetchEnvironments` | GET /v1/environment_providers |
| `Ze4` | `createEnvironment` | POST env create |
| `Fa` | `getRepoInfo` | Git remote parser |
| `hA` | `getAuthState` | OAuth token |
| `AX` | `getOrgUUID` | Organization UUID |
| `l8` | `getFeatureFlag` | GrowthBook/Statsig |
| `X2` | `checkPolicyPermission` | Org policy gate |
| `R0` | `enqueuePrompt` | REPL injection |
| `JQ6` | `parseCron` | Cron parser |
| `Op_` | `"ccr-triggers-2026-01-30"` | Triggers beta header |
| `Lg` | `DEFAULT_JITTER_CONFIG` | Jitter constants |

Full symbol map (40+ entries) in `notes/schedule-command-analysis.md` in the [claude-code-re](https://github.com/minzique/claude-code-re) repo.
