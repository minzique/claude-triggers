# claude-triggers

[![npm](https://img.shields.io/npm/v/claude-triggers)](https://www.npmjs.com/package/claude-triggers)

Manage Claude Code scheduled remote agents from **any** harness — [pi](https://github.com/mariozechner/pi-coding-agent), [opencode](https://github.com/opencode-ai/opencode), your own tools, or plain CLI.

Creates, lists, updates, and runs triggers via Anthropic's trigger API using your existing Claude Code credentials. Also exposes session creation, file upload, and GitHub integration APIs that Claude Code's `/schedule` command doesn't surface.

## Install

```bash
npm install -g claude-triggers
# or
npx claude-triggers test
```

## Prerequisites

- **Claude Code** installed and authenticated (run `claude` at least once)
- **Claude Max or Pro** account (OAuth-based auth)
- Node.js 20+

## CLI

```bash
# Test connectivity
claude-triggers test

# List triggers
claude-triggers list
claude-triggers list -v              # show prompts, models, repos

# Create a trigger
claude-triggers create \
  --name "daily-pr-review" \
  --cron "0 9 * * 1-5" \
  --prompt "Review all open PRs and post summary comments" \
  --repo "https://github.com/org/repo"

# Manage
claude-triggers enable <id>
claude-triggers disable <id>
claude-triggers update <id> --cron "0 */2 * * *"
claude-triggers update <id> --prompt "New instructions" --model "claude-opus-4-6"
claude-triggers run <id>             # run immediately
claude-triggers get <id>

# Sessions (beyond what /schedule exposes)
claude-triggers sessions
claude-triggers session <id>
claude-triggers session-create --env <env_id> --prompt "Run tests" --repo "https://..."

# Infrastructure
claude-triggers envs
claude-triggers env-create "staging"
claude-triggers profile
claude-triggers github-check owner/repo

# All commands support --json for scripting
claude-triggers list --json | jq '.data[].name'
```

## Library

```typescript
import { ClaudeTriggersClient, buildTriggerBody } from "claude-triggers";

const client = await ClaudeTriggersClient.create();

// Create a trigger
const env = await client.ensureEnvironment();
const trigger = await client.createTrigger(
  buildTriggerBody({
    name: "nightly-tests",
    cron: "0 3 * * *",
    prompt: "Run the full test suite and report failures",
    environmentId: env.environment_id,
    repoUrl: "https://github.com/org/repo",
  })
);

// Run immediately
await client.runTrigger(trigger.id);

// Direct session creation (no cron schedule needed)
const session = await client.createSession({
  environmentId: env.environment_id,
  prompt: "Refactor the auth module",
  repoUrl: "https://github.com/org/repo",
});
```

## Features Beyond Claude Code's /schedule

The CLI and library expose APIs that Claude Code's `/schedule` command doesn't:

| Feature | /schedule | claude-triggers |
|---------|-----------|-----------------|
| Trigger CRUD | ✓ | ✓ |
| Run trigger | ✓ | ✓ |
| Direct session creation | ✗ | ✓ `createSession()` |
| Send events to sessions | ✗ | ✓ `sendSessionEvent()` |
| File upload (seed bundles) | ✗ | ✓ `uploadFile()` |
| GitHub app check | ✗ | ✓ `checkGitHubAppInstalled()` |
| GitHub token sync check | ✗ | ✓ `checkGitHubTokenSync()` |
| Session branch extraction | ✗ | ✓ `getSessionBranch()` |
| Update prompt/model | ✗ (full replace) | ✓ (merges with existing) |
| Cron validation | client-side | client-side + min interval |
| Token refresh | via CLI shelling | direct OAuth grant |

## Cron Expressions

Standard 5-field UTC cron. Minimum interval: 1 hour.

```
0 9 * * 1-5    Weekdays at 9am UTC
0 */2 * * *    Every 2 hours
0 0 * * *      Daily at midnight UTC
30 14 * * 1    Every Monday at 2:30pm UTC
0 8 1 * *      First of every month at 8am UTC
```

## How It Works

Reads OAuth tokens from Claude Code's credential store (macOS Keychain or `~/.claude/.credentials.json`), resolves the org UUID via the profile API, then calls the trigger/session/environment APIs with the correct beta headers.

Token refresh uses the same direct OAuth grant flow as Claude Code itself — no need to shell out to `claude` CLI.

## Agent Skill

A `SKILL.md` is included for use with pi and other skill-aware harnesses. Install the package and point your agent config at the skill file.

## API Reference

### Trigger API

| Method | Endpoint | Beta |
|--------|----------|------|
| GET | `/v1/code/triggers` | `ccr-triggers-2026-01-30` |
| GET | `/v1/code/triggers/{id}` | `ccr-triggers-2026-01-30` |
| POST | `/v1/code/triggers` | `ccr-triggers-2026-01-30` |
| POST | `/v1/code/triggers/{id}` | `ccr-triggers-2026-01-30` |
| POST | `/v1/code/triggers/{id}/run` | `ccr-triggers-2026-01-30` |

### Session API

| Method | Endpoint | Beta |
|--------|----------|------|
| GET | `/v1/sessions` | `ccr-byoc-2025-07-29` |
| GET | `/v1/sessions/{id}` | `ccr-byoc-2025-07-29` |
| POST | `/v1/sessions` | `ccr-byoc-2025-07-29` |
| POST | `/v1/sessions/{id}/events` | `ccr-byoc-2025-07-29` |

### Files API

| Method | Endpoint | Beta |
|--------|----------|------|
| POST | `/v1/files` | `files-api-2025-04-14` |

## Disclaimer

This package uses Claude Code's OAuth credentials to interact with Anthropic's API. This is a community tool — Anthropic may change their API at any time. Use at your own discretion.

## License

MIT
