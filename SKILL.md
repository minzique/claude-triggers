---
name: claude-triggers
description: Create, manage, and run Claude Code scheduled remote agents (triggers). Use when the user wants to schedule recurring AI tasks, set up cron-based automation, manage remote Claude sessions, or interact with the Anthropic trigger API. Works with any Claude Max/Pro account.
---

# Claude Triggers Skill

Manage Claude Code's scheduled remote agents (triggers) from any agent harness. Each trigger runs on a cron schedule, spawning an isolated cloud session with its own git checkout, tools, and optional MCP connections.

## Prerequisites

- Claude Code installed and authenticated (`claude` run at least once)
- Claude Max or Pro account (OAuth-based, not API key)
- Node.js 20+

## Setup

```bash
npm install -g claude-triggers
```

Or use directly via npx:
```bash
npx claude-triggers test
```

## Available Commands

### Trigger Management

```bash
# List all triggers
claude-triggers list
claude-triggers list -v              # verbose: show prompts, models, repos

# Create a trigger
claude-triggers create \
  --name "daily-pr-review" \
  --cron "0 9 * * 1-5" \
  --prompt "Review all open PRs. Post a summary comment on each." \
  --repo "https://github.com/org/repo" \
  --model "claude-sonnet-4-6"

# Get details
claude-triggers get <trigger_id>

# Update
claude-triggers update <trigger_id> --name "new-name"
claude-triggers update <trigger_id> --cron "0 */2 * * *"
claude-triggers update <trigger_id> --prompt "New instructions"
claude-triggers update <trigger_id> --enabled false

# Enable/disable
claude-triggers enable <trigger_id>
claude-triggers disable <trigger_id>

# Run immediately (without waiting for cron)
claude-triggers run <trigger_id>

# Delete (opens browser — API doesn't support delete)
claude-triggers delete <trigger_id>
```

### Session Management

```bash
# List remote sessions
claude-triggers sessions

# Get session details
claude-triggers session <session_id>

# Create a session directly (without a trigger)
claude-triggers session-create \
  --env <environment_id> \
  --prompt "Run the test suite" \
  --repo "https://github.com/org/repo"
```

### Infrastructure

```bash
# List environments
claude-triggers envs

# Create an environment
claude-triggers env-create "my-env"

# Account info
claude-triggers profile

# Check GitHub integration
claude-triggers github-check owner/repo

# Test connectivity
claude-triggers test
```

### Output Formats

All commands support `--json` for raw JSON output, useful for scripting:
```bash
claude-triggers list --json | jq '.data[].name'
```

## Library Usage

For integration into other tools, agents, or harnesses:

```typescript
import { ClaudeTriggersClient, buildTriggerBody } from "claude-triggers";

// Auto-reads credentials from Claude Code
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

// Run it now
await client.runTrigger(trigger.id);

// Create a one-off session (no cron needed)
const session = await client.createSession({
  environmentId: env.environment_id,
  prompt: "Refactor the auth module",
  repoUrl: "https://github.com/org/repo",
});
```

## Cron Expressions

Standard 5-field UTC cron: `minute hour day-of-month month day-of-week`

| Expression | Meaning |
|------------|---------|
| `0 9 * * 1-5` | Weekdays at 9am UTC |
| `0 */2 * * *` | Every 2 hours |
| `0 0 * * *` | Daily at midnight UTC |
| `30 14 * * 1` | Every Monday at 2:30pm UTC |
| `0 8 1 * *` | First of every month at 8am UTC |

**Minimum interval is 1 hour.** Sub-hour expressions like `*/30 * * * *` are rejected.

Cron expressions are always in **UTC**. Convert local times before creating triggers.

## Important Notes

- Triggers run **remotely** in Anthropic's cloud — they can't access local files or services
- The agent prompt must be self-contained (the remote agent starts with zero context)
- Cannot delete triggers via API — use https://claude.ai/code/scheduled
- The trigger feature requires the `tengu_surreal_dali` feature flag (rolling out)
- Sessions are created with `events: []`, then the prompt is sent via `sendSessionEvent()` — this is how Claude Code does it internally
- When a GitHub repo is attached, the backend auto-provisions a scoped GitHub MCP server
- Cron is always **UTC** — convert local times before creating triggers

## Session Lifecycle

1. **Create** → status `pending` (environment provisioning)
2. **Running** → agent is executing (tool calls, thinking)
3. **Idle** → agent finished, waiting for follow-up input
4. Use `getSessionEvents()` to read the conversation history
5. Use `sendSessionEvent()` to send follow-up prompts to idle sessions

## Disclaimer

This tool uses **reverse-engineered, undocumented Anthropic APIs** with beta headers that may change or break at any time. It uses your Claude Code OAuth credentials — Anthropic's ToS state that subscription tokens should only be used with official clients. **Use at your own risk.** The authors are not liable for account suspension, charges, or any other consequences. See the full [README disclaimer](https://github.com/minzique/claude-triggers#disclaimer) for details.
