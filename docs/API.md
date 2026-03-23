# API Reference

## `ClaudeTriggersClient`

### Construction

```typescript
// Auto-reads credentials, resolves org UUID
const client = await ClaudeTriggersClient.create();

// With options
const client = await ClaudeTriggersClient.create({
  accessToken: "sk-ant-...",     // Optional: explicit token
  orgUUID: "...",                // Optional: skip profile fetch
  baseUrl: "https://...",        // Default: api.anthropic.com
  timeout: 20000,                // Default: 20s
  maxRetries: 3,                 // Default: 3 (429/529 retry)
});

// Synchronous constructor (no token refresh)
const client = new ClaudeTriggersClient({ accessToken: "..." });
await client.init(); // async setup
```

### Profile

```typescript
client.fetchProfile(): Promise<OrgProfile>
client.ensureOrgUUID(): Promise<string>
client.getOrgUUID(): string | null
```

### Triggers

```typescript
client.listTriggers(): Promise<TriggerListResponse>
// { data: Trigger[], has_more: boolean }

client.getTrigger(id: string): Promise<Trigger>

client.createTrigger(body: CreateTriggerBody): Promise<Trigger>
// Validates cron client-side before sending

client.updateTrigger(id: string, body: UpdateTriggerBody): Promise<Trigger>
// Partial update: name, cron_expression, enabled, job_config, mcp_connections

client.runTrigger(id: string): Promise<TriggerRunResponse>
// Spawns a session immediately

client.enableTrigger(id: string): Promise<Trigger>
client.disableTrigger(id: string): Promise<Trigger>
```

### Sessions

```typescript
client.listSessions(): Promise<SessionListResponse>
// { data: Session[], has_more: boolean }

client.getSession(id: string): Promise<Session>
// Includes session_status, session_context, mcp_config

client.createSession(opts: {
  environmentId: string;        // Required
  prompt?: string;              // Sent via sendSessionEvent after creation
  repoUrl?: string;
  revision?: string;
  seedBundleFileId?: string;
  environmentVariables?: Record<string, string>;
  title?: string;
}): Promise<{ id: string; title: string }>

client.getSessionEvents(sessionId: string, afterId?: string): Promise<Array<Record<string, unknown>>>
// Paginated. Events have type: "user" | "assistant" | "tool_result"
// Assistant content is array of blocks: { type: "text" | "tool_use" | "thinking", ... }

client.sendSessionEvent(sessionId: string, content: string, uuid?: string): Promise<ApiResponse>
// Send a follow-up message to an idle session

client.getSessionBranch(session: Session): string | undefined
// Extract branch name from session outcomes
```

### Environments

```typescript
client.listEnvironments(): Promise<Environment[]>

client.createEnvironment(name?: string, config?: Partial<CreateEnvironmentConfig>): Promise<Environment>
// Default: anthropic_cloud, python 3.11, node 20

client.ensureEnvironment(): Promise<Environment>
// Returns first existing or creates "claude-code-default"
```

### Files

```typescript
client.uploadFile(
  content: Buffer | Uint8Array,
  filename: string,
  purpose?: string              // Default: "user_data"
): Promise<{ id: string; filename: string; size: number }>
```

### GitHub

```typescript
client.checkGitHubTokenSync(): Promise<boolean>
client.checkGitHubAppInstalled(owner: string, repo: string): Promise<{ installed: boolean; status?: string }>
```

---

## `buildTriggerBody`

Helper to construct a `CreateTriggerBody`:

```typescript
import { buildTriggerBody } from "claude-triggers";

const body = buildTriggerBody({
  name: "my-trigger",           // Required
  cron: "0 9 * * 1-5",         // Required, UTC
  prompt: "Do something",       // Required
  environmentId: "env_...",     // Required
  repoUrl: "https://...",      // Optional
  model: "claude-sonnet-4-6",  // Default: claude-sonnet-4-6
  tools: ["Bash", "Read"],     // Default: Bash,Read,Write,Edit,Glob,Grep
  mcpConnections: [...],        // Optional
  enabled: true,                // Default: true
});
```

---

## Cron Utilities

```typescript
import { parseCron, nextCronDate, validateCron, describeCron, intervalToCron } from "claude-triggers";

// Parse into field arrays
parseCron("0 9 * * 1-5"): CronFields | null

// Next matching date
nextCronDate(fields: CronFields, after: Date): Date | null

// Validate (returns error string or null)
validateCron("*/5 * * * *"): string | null
// "Minimum trigger interval is 1 hour. '*/5 * * * *' fires every 5 minutes."

// Human-readable
describeCron("0 9 * * 1-5", { utc: true }): string
// "Weekdays at 9:00am UTC"

// Shorthand to cron
intervalToCron("2h"): string | null
// "0 */2 * * *"
```

---

## Credentials

```typescript
import { getCredentials, getCredentialsSync, readCredentials, clearCredentialCache } from "claude-triggers";

// Async: reads, refreshes if needed, caches 30s
await getCredentials(): Promise<ClaudeCredentials | null>
await getCredentials(true): Promise<ClaudeCredentials | null>  // force refresh

// Sync: reads from cache/store, no refresh
getCredentialsSync(): ClaudeCredentials | null

// Raw read, no cache
readCredentials(): ClaudeCredentials | null

// Clear in-memory cache
clearCredentialCache(): void
```

---

## Error Types

```typescript
import { TriggerApiError, AuthError } from "claude-triggers";

// API errors (non-2xx responses)
TriggerApiError {
  message: string;
  status: number;     // HTTP status
  body?: unknown;     // Response body
}

// Auth errors (no credentials, expired)
AuthError {
  message: string;
}
```

---

## Types

```typescript
interface Trigger {
  id: string;
  name: string;
  cron_expression: string;
  enabled: boolean;
  job_config: TriggerJobConfig;
  mcp_connections: McpConnection[];
  persist_session: boolean;
  creator?: { account_uuid: string; display_name: string };
  created_at?: string;
  updated_at?: string;
  next_run_at?: string;
}

interface Environment {
  kind: string;
  environment_id: string;
  name: string;
  state?: string;
  created_at?: string;
}

interface Session {
  id: string;
  status?: string;
  session_context: SessionContext;
  created_at?: string;
}

interface OrgProfile {
  account: { uuid: string; display_name?: string; email?: string };
  organization: { uuid: string; organization_type: string; rate_limit_tier?: string };
}

interface ClaudeCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes?: string[];
}
```

Full type definitions in [`src/types.ts`](../src/types.ts).
