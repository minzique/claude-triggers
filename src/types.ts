/**
 * Type definitions for Claude Code trigger/schedule API.
 * Reverse-engineered from claude-code v2.1.81.
 */

// ─── Credentials ───

export interface ClaudeCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes?: string[];
}

export interface OAuthTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
  account?: {
    uuid: string;
    email_address: string;
  };
  organization?: {
    uuid: string;
  };
}

// ─── Profile ───

export interface OrgProfile {
  account: {
    uuid: string;
    full_name?: string;
    display_name?: string;
    email?: string;
    has_claude_max?: boolean;
    has_claude_pro?: boolean;
    created_at?: string;
  };
  organization: {
    uuid: string;
    name?: string;
    organization_type: string;
    billing_type?: string;
    rate_limit_tier?: string;
    has_extra_usage_enabled?: boolean;
    subscription_status?: string;
    subscription_created_at?: string;
  };
  application?: {
    uuid: string;
    name: string;
    slug: string;
  };
}

// ─── Environments ───

export interface Environment {
  kind: string;
  environment_id: string;
  name: string;
  created_at?: string;
  state?: string;
  config?: unknown;
  bridge_info?: unknown;
}

export interface CreateEnvironmentConfig {
  environment_type: string;
  cwd: string;
  init_script: string | null;
  environment: Record<string, string>;
  languages: Array<{ name: string; version: string }>;
  network_config: {
    allowed_hosts: string[];
    allow_default_hosts: boolean;
  };
}

// ─── Triggers ───

export interface TriggerEvent {
  data: {
    uuid: string;
    session_id: string;
    type: "user";
    parent_tool_use_id: null;
    message: {
      content: string;
      role: "user";
    };
  };
}

export interface SessionContext {
  model: string;
  sources?: Array<{ git_repository: { url: string } }>;
  allowed_tools: string[];
}

export interface TriggerJobConfig {
  ccr: {
    environment_id: string;
    session_context: SessionContext;
    events: TriggerEvent[];
  };
}

export interface McpConnection {
  connector_uuid: string;
  name: string;
  url: string;
}

export interface Trigger {
  id: string;
  name: string;
  cron_expression: string;
  enabled: boolean;
  job_config: TriggerJobConfig;
  mcp_connections: McpConnection[];
  persist_session: boolean;
  creator?: {
    account_uuid: string;
    display_name: string;
  };
  created_at?: string;
  updated_at?: string;
  next_run_at?: string;
}

export interface CreateTriggerBody {
  name: string;
  cron_expression: string;
  enabled?: boolean;
  job_config: TriggerJobConfig;
  mcp_connections?: McpConnection[];
}

export interface UpdateTriggerBody {
  name?: string;
  cron_expression?: string;
  enabled?: boolean;
  job_config?: TriggerJobConfig;
  mcp_connections?: McpConnection[];
  clear_mcp_connections?: boolean;
}

export interface TriggerListResponse {
  data: Trigger[];
  has_more: boolean;
}

export interface TriggerResponse {
  trigger: Trigger;
}

export interface TriggerRunResponse {
  session_id?: string;
  [key: string]: unknown;
}

// ─── Sessions ───

export interface Session {
  id: string;
  status?: string;
  session_context: SessionContext;
  created_at?: string;
  [key: string]: unknown;
}

export interface SessionListResponse {
  data: Session[];
  has_more: boolean;
}

// ─── API ───

export interface ApiResponse<T = unknown> {
  status: number;
  data: T;
  headers?: Record<string, string>;
}

export interface ClientOptions {
  /** OAuth access token. If not provided, reads from Claude Code credential store. */
  accessToken?: string;
  /** Organization UUID. If not provided, fetched via profile API. */
  orgUUID?: string;
  /** Base API URL. Defaults to https://api.anthropic.com */
  baseUrl?: string;
  /** Request timeout in ms. Defaults to 20000. */
  timeout?: number;
  /** Max retries on 429/529. Defaults to 3. */
  maxRetries?: number;
}

// ─── Errors ───

export class TriggerApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown
  ) {
    super(message);
    this.name = "TriggerApiError";
  }
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}
