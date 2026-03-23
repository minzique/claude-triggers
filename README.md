<div align="center">

# claude-triggers

**Manage Claude Code scheduled agents from any harness.**

[![npm](https://img.shields.io/npm/v/claude-triggers?color=blue)](https://www.npmjs.com/package/claude-triggers)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![GitHub](https://img.shields.io/github/stars/minzique/claude-triggers?style=social)](https://github.com/minzique/claude-triggers)

Create, run, and manage remote Claude agents on cron schedules — from [pi](https://github.com/mariozechner/pi-coding-agent), [opencode](https://github.com/opencode-ai/opencode), your own tools, or the command line.

[Install](#install) · [Quick Start](#quick-start) · [CLI](#cli) · [Library](#library) · [Docs](./docs/ARCHITECTURE.md)

</div>

---

> **⚠️ This package uses [reverse-engineered, undocumented Anthropic APIs](#disclaimer).** It may break at any time and may violate Anthropic's Terms of Service. Use at your own risk.

## What It Does

Each trigger fires on a UTC cron schedule, spawning an **isolated cloud session** with its own git clone, tools, and optional MCP connections. The agent runs in Anthropic's infrastructure — it cannot access your local machine.

```
Your Tool ──▶ claude-triggers ──▶ Anthropic API ──▶ Sandboxed Cloud Agent
(pi, opencode,                     /v1/code/triggers     (git clone, Bash,
 CLI, scripts)                     /v1/sessions            Read, Write, Edit,
                                                           GitHub MCP, ...)
```

Beyond what Claude Code's `/schedule` exposes, this package also lets you:
- **Create sessions directly** (no cron needed)
- **Read conversation history** from remote sessions
- **Send follow-up messages** to idle sessions
- **Upload seed bundles** for session initialization
- **Check GitHub integration** status programmatically

## Install

```bash
npm install -g claude-triggers
```

**Prerequisites:** Claude Code installed & logged in (`claude` run once), Claude Max/Pro subscription, Node 20+.

## Quick Start

```bash
# Verify everything works
claude-triggers test

# Create a scheduled agent
claude-triggers create \
  --name "daily-review" \
  --cron "0 9 * * 1-5" \
  --prompt "Review open PRs and post summary comments" \
  --repo "https://github.com/org/repo"

# Run it now (don't wait for cron)
claude-triggers run <trigger_id>

# See what it did
claude-triggers sessions
```

## CLI

```bash
# ── Triggers ──
claude-triggers list [-v]                    # List (verbose: prompts, models)
claude-triggers create --name --cron --prompt [--repo] [--model] [--tools]
claude-triggers get <id>
claude-triggers update <id> [--name] [--cron] [--prompt] [--model] [--enabled]
claude-triggers enable <id>
claude-triggers disable <id>
claude-triggers run <id>                     # Run immediately
claude-triggers delete <id>                  # Opens browser (no API delete)

# ── Sessions ──
claude-triggers sessions                     # List remote sessions
claude-triggers session <id>                 # Session details
claude-triggers session-create --env <id> --prompt "..." [--repo] [--title]

# ── Infrastructure ──
claude-triggers envs                         # List environments
claude-triggers env-create [name]            # Create environment
claude-triggers profile                      # Account & org info
claude-triggers github-check owner/repo      # GitHub App + token sync
claude-triggers test                         # Full connectivity test

# All commands support --json for scripting
claude-triggers list --json | jq '.data[].name'
```

## Library

```typescript
import { ClaudeTriggersClient, buildTriggerBody } from "claude-triggers";

const client = await ClaudeTriggersClient.create();

// Schedule an agent
const env = await client.ensureEnvironment();
const trigger = await client.createTrigger(
  buildTriggerBody({
    name: "nightly-tests",
    cron: "0 3 * * *",
    prompt: "Run the test suite and report failures",
    environmentId: env.environment_id,
    repoUrl: "https://github.com/org/repo",
  })
);

// Run immediately
await client.runTrigger(trigger.id);

// Or create a one-off session (no cron)
const session = await client.createSession({
  environmentId: env.environment_id,
  prompt: "Refactor the auth module and open a PR",
  repoUrl: "https://github.com/org/repo",
});

// Read the conversation
const events = await client.getSessionEvents(session.id);

// Send a follow-up
await client.sendSessionEvent(session.id, "Also update the tests");
```

See the full [API reference →](./docs/API.md)

## Cron

Standard 5-field UTC cron. **Minimum interval: 1 hour.**

| Expression | Meaning |
|:-----------|:--------|
| `0 9 * * 1-5` | Weekdays at 9am UTC |
| `0 */2 * * *` | Every 2 hours |
| `0 0 * * *` | Daily at midnight UTC |
| `30 14 * * 1` | Every Monday 2:30pm UTC |

```typescript
import { validateCron, describeCron } from "claude-triggers";

validateCron("*/5 * * * *");  // "Minimum trigger interval is 1 hour..."
describeCron("0 9 * * 1-5", { utc: true });  // "Weekdays at 9:00am UTC"
```

## Docs

| Document | Contents |
|:---------|:---------|
| **[Architecture](./docs/ARCHITECTURE.md)** | How it works, API surface, session lifecycle, RE findings |
| **[API Reference](./docs/API.md)** | Full library API with types and examples |
| **[SKILL.md](./SKILL.md)** | Agent skill definition for pi and other harnesses |

## Disclaimer

**This software is provided as-is, without warranty of any kind.**

This package interacts with **undocumented, internal Anthropic APIs** discovered through reverse engineering of Claude Code v2.1.81. These APIs use beta headers (`ccr-triggers-2026-01-30`, `ccr-byoc-2025-07-29`) that may be revoked without notice.

Anthropic's [Terms of Service](https://www.anthropic.com/terms) state that Claude Pro/Max subscription tokens should only be used with official clients. Using these credentials with third-party tools **may violate those terms** and could result in **account suspension**.

- **Use at your own risk.** The authors are not liable for any consequences — account suspension, charges, data loss, or service interruption.
- This project is **not affiliated with, endorsed by, or sponsored by Anthropic.**
- "Claude", "Claude Code", and "Anthropic" are trademarks of Anthropic, PBC.

## License

[MIT](./LICENSE)
