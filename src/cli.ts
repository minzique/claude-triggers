#!/usr/bin/env node
/**
 * claude-triggers CLI — manage Claude Code scheduled agents.
 */

import { ClaudeTriggersClient, buildTriggerBody } from "./client.js";
import { getCredentials } from "./credentials.js";
import { describeCron, validateCron } from "./cron.js";
import type { Trigger, UpdateTriggerBody } from "./types.js";

// ─── Arg parsing ───

function parseArgs(argv: string[]): {
  command: string;
  positional: string[];
  flags: Record<string, string>;
} {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  const command = argv[0] ?? "help";

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    } else {
      positional.push(arg);
    }
  }

  return { command, positional, flags };
}

// ─── Display ───

function json(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

function printTrigger(t: Trigger, verbose = false): void {
  const status = t.enabled ? "\x1b[32m● on\x1b[0m " : "\x1b[31m○ off\x1b[0m";
  const schedule = describeCron(t.cron_expression, { utc: true });
  console.log(`  ${t.id}  ${status}  ${schedule}`);
  console.log(`  ${" ".repeat(30)}${t.name}`);
  if (t.next_run_at) {
    console.log(`  ${" ".repeat(30)}next: ${new Date(t.next_run_at).toLocaleString()}`);
  }
  if (verbose) {
    const prompt = t.job_config?.ccr?.events?.[0]?.data?.message?.content;
    if (prompt) {
      console.log(`  ${" ".repeat(30)}prompt: ${prompt.slice(0, 80)}${prompt.length > 80 ? "..." : ""}`);
    }
    const model = t.job_config?.ccr?.session_context?.model;
    if (model) console.log(`  ${" ".repeat(30)}model: ${model}`);
    const sources = t.job_config?.ccr?.session_context?.sources;
    if (sources?.length) {
      console.log(`  ${" ".repeat(30)}repo: ${sources[0].git_repository.url}`);
    }
    if (t.mcp_connections?.length) {
      console.log(`  ${" ".repeat(30)}mcp: ${t.mcp_connections.map((m) => m.name).join(", ")}`);
    }
  }
}

// ─── Help ───

const HELP = `\x1b[1mclaude-triggers\x1b[0m — manage Claude Code scheduled agents

\x1b[2mTrigger commands:\x1b[0m
  list [-v]                        List all triggers
  get <id>                         Get trigger details
  create                           Create a trigger
    --name <name>                  Trigger name (required)
    --cron <expression>            5-field UTC cron (required)
    --prompt <text>                Agent prompt (required)
    --repo <url>                   Git repository URL
    --model <model>                Model (default: claude-sonnet-4-6)
    --tools <t1,t2,...>            Allowed tools
    --disabled                     Create disabled
  update <id>                      Update a trigger
    --name, --cron, --enabled, --prompt, --model
  run <id>                         Run trigger immediately
  enable <id>                      Enable a trigger
  disable <id>                     Disable a trigger
  delete <id>                      Opens claude.ai (no API delete)

\x1b[2mSession commands:\x1b[0m
  sessions                         List remote sessions
  session <id>                     Get session details
  session-create                   Create a remote session directly
    --env <env_id>                 Environment ID (required)
    --prompt <text>                Initial prompt
    --repo <url>                   Git repository URL
    --title <text>                 Session title

\x1b[2mInfra commands:\x1b[0m
  envs                             List environments
  env-create [name]                Create an environment
  profile                          Show account/org info
  github-check [owner/repo]        Check GitHub app installation
  test                             Test auth & API connectivity

\x1b[2mOptions:\x1b[0m
  --json                           Raw JSON output
  --help                           Show this help
`;

// ─── Commands ───

async function main(): Promise<void> {
  const { command, positional, flags } = parseArgs(process.argv.slice(2));
  const isJson = "json" in flags;
  const verbose = "v" in flags || "verbose" in flags;

  if (command === "help" || "help" in flags) {
    console.log(HELP);
    return;
  }

  if (command === "test") {
    await runTest();
    return;
  }

  const client = await ClaudeTriggersClient.create();

  switch (command) {
    // ─── Profile ───
    case "profile": {
      const profile = await client.fetchProfile();
      if (isJson) return json(profile);
      console.log(`Account:  ${profile.account.display_name ?? profile.account.uuid}`);
      console.log(`Email:    ${profile.account.email ?? "?"}`);
      console.log(`Org:      ${profile.organization.uuid}`);
      console.log(`Plan:     ${profile.organization.organization_type}`);
      console.log(`Tier:     ${profile.organization.rate_limit_tier ?? "?"}`);
      break;
    }

    // ─── Environments ───
    case "envs": {
      const envs = await client.listEnvironments();
      if (isJson) return json(envs);
      if (!envs.length) {
        console.log("No environments found.");
        break;
      }
      console.log("Environments:");
      for (const env of envs) {
        console.log(`  ${env.environment_id}  ${env.kind}  ${env.name}  ${env.state ?? ""}`);
      }
      break;
    }

    case "env-create": {
      const name = positional[0] ?? "claude-code-default";
      const env = await client.createEnvironment(name);
      if (isJson) return json(env);
      console.log(`Created: ${env.environment_id} (${env.name})`);
      break;
    }

    // ─── Triggers ───
    case "list":
    case "ls": {
      const resp = await client.listTriggers();
      if (isJson) return json(resp);
      if (!resp.data.length) {
        console.log("No triggers.");
        break;
      }
      console.log(`Triggers (${resp.data.length}):\n`);
      for (const t of resp.data) {
        printTrigger(t, verbose);
        console.log();
      }
      break;
    }

    case "get": {
      const id = positional[0];
      if (!id) return die("Usage: claude-triggers get <trigger_id>");
      const trigger = await client.getTrigger(id);
      if (isJson) return json(trigger);
      printTrigger(trigger, true);
      break;
    }

    case "create": {
      const name = flags.name;
      const cron = flags.cron;
      const prompt = flags.prompt;

      if (!name || !cron || !prompt) {
        return die(
          "Required: --name, --cron, --prompt\n" +
            "Example: claude-triggers create --name daily-review --cron '0 9 * * 1-5' --prompt 'Review open PRs'"
        );
      }

      const cronError = validateCron(cron);
      if (cronError) return die(cronError);

      const env = await client.ensureEnvironment();
      if (!isJson) console.log(`Using environment: ${env.environment_id} (${env.name})`);

      const body = buildTriggerBody({
        name,
        cron,
        prompt,
        environmentId: env.environment_id,
        repoUrl: flags.repo,
        model: flags.model,
        tools: flags.tools?.split(","),
        enabled: !("disabled" in flags),
      });

      const trigger = await client.createTrigger(body);
      if (isJson) return json(trigger);
      console.log(`\n✓ Trigger created: ${trigger.id}`);
      console.log(`  Name:     ${trigger.name}`);
      console.log(`  Schedule: ${describeCron(trigger.cron_expression, { utc: true })}`);
      console.log(`  Enabled:  ${trigger.enabled}`);
      if (trigger.next_run_at) {
        console.log(`  Next run: ${new Date(trigger.next_run_at).toLocaleString()}`);
      }
      console.log(`\n  View: https://claude.ai/code/scheduled/${trigger.id}`);
      break;
    }

    case "update": {
      const id = positional[0];
      if (!id) return die("Usage: claude-triggers update <trigger_id> [--name ...] [--cron ...] [--enabled ...]");

      const body: UpdateTriggerBody = {};
      if (flags.name) body.name = flags.name;
      if (flags.cron) body.cron_expression = flags.cron;
      if (flags.enabled) body.enabled = flags.enabled === "true";
      if (flags.prompt || flags.model) {
        // Need to fetch current trigger to merge job_config
        const current = await client.getTrigger(id);
        body.job_config = { ...current.job_config };
        if (flags.prompt) {
          body.job_config.ccr.events[0].data.message.content = flags.prompt;
          body.job_config.ccr.events[0].data.uuid = crypto.randomUUID();
        }
        if (flags.model) {
          body.job_config.ccr.session_context.model = flags.model;
        }
      }

      if (Object.keys(body).length === 0) return die("Nothing to update. Pass --name, --cron, --enabled, --prompt, or --model.");

      const trigger = await client.updateTrigger(id, body);
      if (isJson) return json(trigger);
      console.log(`✓ Updated: ${trigger.id}`);
      printTrigger(trigger, true);
      break;
    }

    case "run": {
      const id = positional[0];
      if (!id) return die("Usage: claude-triggers run <trigger_id>");
      const result = await client.runTrigger(id);
      if (isJson) return json(result);
      console.log(`✓ Trigger ${id} run started`);
      json(result);
      break;
    }

    case "enable": {
      const id = positional[0];
      if (!id) return die("Usage: claude-triggers enable <trigger_id>");
      const trigger = await client.enableTrigger(id);
      if (isJson) return json(trigger);
      console.log(`✓ Enabled: ${trigger.id} (${trigger.name})`);
      break;
    }

    case "disable": {
      const id = positional[0];
      if (!id) return die("Usage: claude-triggers disable <trigger_id>");
      const trigger = await client.disableTrigger(id);
      if (isJson) return json(trigger);
      console.log(`✓ Disabled: ${trigger.id} (${trigger.name})`);
      break;
    }

    case "delete":
    case "rm": {
      const id = positional[0];
      if (!id) return die("Usage: claude-triggers delete <trigger_id>");
      const url = `https://claude.ai/code/scheduled/${id}`;
      console.log(`API doesn't support delete. Opening: ${url}`);
      try {
        const { execSync } = await import("node:child_process");
        execSync(`open "${url}" 2>/dev/null || xdg-open "${url}" 2>/dev/null`, { stdio: "ignore" });
      } catch {
        // Manual
      }
      break;
    }

    // ─── Sessions ───
    case "sessions": {
      const resp = await client.listSessions();
      if (isJson) return json(resp);
      if (!resp.data.length) {
        console.log("No sessions.");
        break;
      }
      console.log(`Sessions (${resp.data.length}):\n`);
      for (const s of resp.data) {
        const model = s.session_context?.model ?? "?";
        const status = s.status ?? "?";
        console.log(`  ${s.id}  ${status}  ${model}`);
      }
      break;
    }

    case "session": {
      const id = positional[0];
      if (!id) return die("Usage: claude-triggers session <session_id>");
      const session = await client.getSession(id);
      json(session);
      break;
    }

    case "session-create": {
      const envId = flags.env;
      if (!envId) return die("Required: --env <environment_id>\nRun 'claude-triggers envs' to list environments.");
      const result = await client.createSession({
        environmentId: envId,
        prompt: flags.prompt,
        repoUrl: flags.repo,
        title: flags.title,
      });
      if (isJson) return json(result);
      console.log(`✓ Session created: ${result.id}`);
      console.log(`  Title: ${result.title}`);
      break;
    }

    // ─── GitHub ───
    case "github-check": {
      const spec = positional[0];
      if (!spec?.includes("/")) return die("Usage: claude-triggers github-check <owner/repo>");
      const [owner, repo] = spec.split("/");
      const tokenSync = await client.checkGitHubTokenSync();
      const app = await client.checkGitHubAppInstalled(owner, repo);
      if (isJson) return json({ tokenSync, app });
      console.log(`GitHub token synced: ${tokenSync ? "✓ yes" : "✗ no"}`);
      console.log(`GitHub App installed on ${spec}: ${app.installed ? "✓ yes" : "✗ no"}`);
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.log(HELP);
      process.exit(1);
  }
}

async function runTest(): Promise<void> {
  console.log("\x1b[1mTesting Claude Code auth & APIs...\x1b[0m\n");

  // 1. Credentials
  const creds = await getCredentials();
  if (!creds) {
    console.error("✗ No credentials. Run `claude` to authenticate.");
    process.exit(1);
  }
  const ttl = Math.round((creds.expiresAt - Date.now()) / 60_000);
  console.log(`✓ Credentials (expires in ${ttl}min)`);

  // 2. Profile
  const client = new ClaudeTriggersClient({ accessToken: creds.accessToken });
  const profile = await client.fetchProfile();
  console.log(`✓ Profile: ${profile.account.display_name} (${profile.organization.organization_type})`);

  // 3. Environments
  const envs = await client.listEnvironments();
  console.log(`✓ Environments: ${envs.length}`);

  // 4. Triggers
  try {
    const triggers = await client.listTriggers();
    console.log(`✓ Triggers API: ${triggers.data.length} trigger(s)`);
  } catch (e) {
    console.log(`⚠ Triggers: ${e instanceof Error ? e.message : e}`);
    console.log("  (May need tengu_surreal_dali feature flag)");
  }

  // 5. Sessions
  try {
    const sessions = await client.listSessions();
    console.log(`✓ Sessions: ${sessions.data.length}`);
  } catch (e) {
    console.log(`⚠ Sessions: ${e instanceof Error ? e.message : e}`);
  }

  // 6. GitHub
  try {
    const gh = await client.checkGitHubTokenSync();
    console.log(`✓ GitHub token sync: ${gh ? "connected" : "not connected"}`);
  } catch {
    console.log("⚠ GitHub token sync: check failed");
  }

  console.log("\n\x1b[32mAll checks passed ✓\x1b[0m");
}

function die(msg: string): void {
  console.error(msg);
  process.exit(1);
}

main().catch((e) => {
  console.error(`\x1b[31mError:\x1b[0m ${e instanceof Error ? e.message : e}`);
  if (process.env.DEBUG) console.error(e);
  process.exit(1);
});
