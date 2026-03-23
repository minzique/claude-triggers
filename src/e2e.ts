/**
 * End-to-end integration test.
 * Tests: auth → profile → envs → trigger CRUD → run → cleanup
 *
 * Run: pnpm test:e2e
 */

import { ClaudeTriggersClient, buildTriggerBody } from "./client.js";
import { getCredentials } from "./credentials.js";
import { describeCron, validateCron, parseCron, nextCronDate, intervalToCron } from "./cron.js";

const PASS = "\x1b[32m✓\x1b[0m";
const FAIL = "\x1b[31m✗\x1b[0m";
const WARN = "\x1b[33m⚠\x1b[0m";

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`  ${PASS} ${msg}`);
    passed++;
  } else {
    console.log(`  ${FAIL} ${msg}`);
    failed++;
  }
}

async function main(): Promise<void> {
  console.log("=== claude-triggers E2E Test ===\n");

  // ─── Cron unit tests ───
  console.log("Cron parser:");
  assert(parseCron("*/5 * * * *") !== null, "parse */5 * * * *");
  assert(parseCron("0 9 * * 1-5") !== null, "parse 0 9 * * 1-5");
  assert(parseCron("bad") === null, "reject invalid");
  assert(parseCron("0 9 * * * *") === null, "reject 6 fields");
  assert(validateCron("0 9 * * 1-5") === null, "validate weekdays at 9am UTC");
  assert(validateCron("*/5 * * * *")?.includes("1 hour") === true, "reject sub-hour interval");
  assert(describeCron("0 9 * * 1-5", { utc: true }) === "Weekdays at 9:00am UTC", "describe weekdays");
  assert(describeCron("0 0 * * *") === "Daily at 12:00am", "describe daily midnight");
  assert(describeCron("*/30 * * * *") === "Every 30 minutes", "describe every 30m");
  assert(intervalToCron("5m") === "*/5 * * * *", "interval 5m");
  assert(intervalToCron("2h") === "0 */2 * * *", "interval 2h");
  assert(intervalToCron("1d") === "0 0 */1 * *", "interval 1d");

  const fields = parseCron("0 9 * * 1-5")!;
  const next = nextCronDate(fields, new Date());
  assert(next !== null && next > new Date(), "nextCronDate returns future date");

  // ─── Credentials ───
  console.log("\nCredentials:");
  const creds = await getCredentials();
  assert(creds !== null, "credentials loaded");
  if (!creds) {
    console.error("\nCannot continue without credentials. Run `claude` first.");
    process.exit(1);
  }
  assert(creds.expiresAt > Date.now(), "token not expired");
  assert(creds.accessToken.startsWith("sk-ant-"), "token format valid");

  // ─── Client init ───
  console.log("\nClient:");
  const client = await ClaudeTriggersClient.create({ accessToken: creds.accessToken });
  assert(client.getOrgUUID() !== null, "org UUID resolved");

  // ─── Profile ───
  console.log("\nProfile:");
  const profile = await client.fetchProfile();
  assert(!!profile.account.uuid, `account: ${profile.account.display_name}`);
  assert(!!profile.organization.uuid, `org: ${profile.organization.organization_type}`);

  // ─── Environments ───
  console.log("\nEnvironments:");
  const envs = await client.listEnvironments();
  assert(envs.length > 0, `${envs.length} environment(s)`);
  const env = envs[0];
  assert(!!env.environment_id, `env: ${env.environment_id} (${env.name})`);

  // ─── Triggers CRUD ───
  console.log("\nTriggers:");
  const listBefore = await client.listTriggers();
  const countBefore = listBefore.data.length;
  assert(true, `${countBefore} existing trigger(s)`);

  // Create
  console.log("\n  Creating test trigger...");
  const body = buildTriggerBody({
    name: `e2e-test-${Date.now()}`,
    cron: "0 3 1 1 *", // Jan 1 at 3am UTC — won't actually fire
    prompt: "E2E test — respond with E2E_TEST_OK",
    environmentId: env.environment_id,
    model: "claude-sonnet-4-6",
  });
  const created = await client.createTrigger(body);
  assert(!!created.id, `created: ${created.id}`);
  assert(created.name.startsWith("e2e-test-"), "name matches");
  assert(created.enabled === true, "enabled by default");
  assert(created.cron_expression === "0 3 1 1 *", "cron matches");

  // Get
  const fetched = await client.getTrigger(created.id);
  assert(fetched.id === created.id, "get returns same trigger");
  assert(fetched.job_config.ccr.session_context.model === "claude-sonnet-4-6", "model preserved");

  // Update name
  const renamed = await client.updateTrigger(created.id, { name: `${created.name}-updated` });
  assert(renamed.name.endsWith("-updated"), "name updated");

  // Disable
  const disabled = await client.disableTrigger(created.id);
  assert(disabled.enabled === false, "disabled");

  // Enable
  const enabled = await client.enableTrigger(created.id);
  assert(enabled.enabled === true, "re-enabled");

  // Update cron
  const rescheduled = await client.updateTrigger(created.id, { cron_expression: "0 4 1 1 *" });
  assert(rescheduled.cron_expression === "0 4 1 1 *", "cron updated");

  // List should have one more
  const listAfter = await client.listTriggers();
  assert(listAfter.data.length === countBefore + 1, `count: ${countBefore} → ${listAfter.data.length}`);

  // Run (spawns a session)
  console.log("\n  Running trigger...");
  let runResult: unknown = null;
  try {
    runResult = await client.runTrigger(created.id);
    assert(true, `run succeeded: ${JSON.stringify(runResult).slice(0, 100)}`);
  } catch (e) {
    // Run may fail if account doesn't have CCR access
    console.log(`  ${WARN} run failed (may need CCR access): ${e instanceof Error ? e.message : e}`);
  }

  // ─── Sessions ───
  console.log("\nSessions:");
  try {
    const sessions = await client.listSessions();
    assert(sessions.data.length >= 0, `${sessions.data.length} session(s)`);
  } catch (e) {
    console.log(`  ${WARN} sessions: ${e instanceof Error ? e.message : e}`);
  }

  // ─── GitHub ───
  console.log("\nGitHub:");
  try {
    const tokenSync = await client.checkGitHubTokenSync();
    assert(true, `token sync: ${tokenSync}`);
  } catch {
    console.log(`  ${WARN} github check failed`);
  }

  // ─── Cleanup: disable the test trigger ───
  // Can't delete via API, but disable it so it doesn't fire
  console.log("\nCleanup:");
  await client.disableTrigger(created.id);
  assert(true, `disabled test trigger ${created.id}`);
  console.log(`  ℹ Delete manually: https://claude.ai/code/scheduled/${created.id}`);

  // ─── Summary ───
  console.log(`\n${"─".repeat(40)}`);
  console.log(`${PASS} ${passed} passed  ${failed > 0 ? `${FAIL} ${failed} failed` : ""}`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(`\nFatal: ${e instanceof Error ? e.message : e}`);
  if (process.env.DEBUG) console.error(e);
  process.exit(1);
});
