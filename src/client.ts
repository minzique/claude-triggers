/**
 * Claude Triggers API client.
 *
 * Full implementation of the trigger, environment, session, and files APIs
 * reverse-engineered from Claude Code v2.1.81.
 *
 * Includes features the CLI doesn't expose:
 *   - Direct session creation (POST /v1/sessions)
 *   - Session event streaming via SSE
 *   - File upload for seed bundles
 *   - GitHub token sync check
 *   - Session outcomes/branches extraction
 */

import { getCredentials, getCredentialsSync, clearCredentialCache } from "./credentials.js";
import {
  type ClaudeCredentials,
  type OrgProfile,
  type Environment,
  type CreateEnvironmentConfig,
  type Trigger,
  type TriggerListResponse,
  type TriggerResponse,
  type TriggerRunResponse,
  type CreateTriggerBody,
  type UpdateTriggerBody,
  type Session,
  type SessionListResponse,
  type SessionContext,
  type McpConnection,
  type ApiResponse,
  type ClientOptions,
  TriggerApiError,
  AuthError,
} from "./types.js";
import { validateCron } from "./cron.js";

// ─── Constants (from Claude Code v2.1.81) ───

const DEFAULT_BASE_URL = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";
const TRIGGERS_BETA = "ccr-triggers-2026-01-30";
const CCR_BETA = "ccr-byoc-2025-07-29";
const FILES_BETA = "files-api-2025-04-14";
const DEFAULT_TIMEOUT = 20_000;
const DEFAULT_MAX_RETRIES = 3;

const DEFAULT_TOOLS = ["Bash", "Read", "Write", "Edit", "Glob", "Grep"];
const DEFAULT_MODEL = "claude-sonnet-4-6";

// ─── Client ───

export class ClaudeTriggersClient {
  private accessToken: string;
  private refreshToken: string | null = null;
  private orgUUID: string | null;
  private baseUrl: string;
  private timeout: number;
  private maxRetries: number;

  constructor(options: ClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.orgUUID = options.orgUUID ?? null;

    if (options.accessToken) {
      this.accessToken = options.accessToken;
    } else {
      const creds = getCredentialsSync();
      if (!creds) {
        throw new AuthError(
          "No Claude Code credentials found. Run `claude` to authenticate first."
        );
      }
      this.accessToken = creds.accessToken;
      this.refreshToken = creds.refreshToken;
    }
  }

  /**
   * Async initialization — refreshes token if needed, fetches org UUID.
   * Call this before making API requests.
   */
  async init(): Promise<this> {
    const creds = await getCredentials();
    if (creds) {
      this.accessToken = creds.accessToken;
      this.refreshToken = creds.refreshToken;
    }
    await this.ensureOrgUUID();
    return this;
  }

  /**
   * Create a pre-initialized client. Preferred over constructor + init().
   */
  static async create(options: ClientOptions = {}): Promise<ClaudeTriggersClient> {
    const client = new ClaudeTriggersClient(options);
    await client.init();
    return client;
  }

  // ─── HTTP layer ───

  private headers(beta: string): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      "Content-Type": "application/json",
      "anthropic-version": ANTHROPIC_VERSION,
      "anthropic-beta": beta,
    };
    if (this.orgUUID) {
      h["x-organization-uuid"] = this.orgUUID;
    }
    return h;
  }

  private async request<T>(
    method: string,
    path: string,
    beta: string,
    body?: unknown
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${path}`;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);

      try {
        const resp = await fetch(url, {
          method,
          headers: this.headers(beta),
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        // 401 — try token refresh once
        if (resp.status === 401 && attempt === 0) {
          clearCredentialCache();
          const creds = await getCredentials(true);
          if (creds) {
            this.accessToken = creds.accessToken;
            this.refreshToken = creds.refreshToken;
            continue;
          }
        }

        // 429/529 — retry with backoff
        if ((resp.status === 429 || resp.status === 529) && attempt < this.maxRetries) {
          const retryAfter = resp.headers.get("retry-after");
          const delay = retryAfter
            ? parseInt(retryAfter, 10) * 1000
            : (attempt + 1) * 2000;
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        let data: T;
        const contentType = resp.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
          data = (await resp.json()) as T;
        } else {
          data = (await resp.text()) as unknown as T;
        }

        if (!resp.ok) {
          throw new TriggerApiError(
            `${method} ${path} failed: ${resp.status} ${resp.statusText}`,
            resp.status,
            data
          );
        }

        return { status: resp.status, data };
      } catch (e) {
        if (e instanceof TriggerApiError) throw e;
        if (e instanceof Error && e.name === "AbortError") {
          throw new TriggerApiError(`Request timeout after ${this.timeout}ms`, 0);
        }
        throw e;
      } finally {
        clearTimeout(timer);
      }
    }

    throw new TriggerApiError("Max retries exceeded", 0);
  }

  // ─── Profile / Org UUID ───

  async fetchProfile(): Promise<OrgProfile> {
    const resp = await fetch(`${this.baseUrl}/api/oauth/profile`, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!resp.ok) {
      throw new TriggerApiError(
        `Profile fetch failed: ${resp.status}`,
        resp.status,
        await resp.json().catch(() => null)
      );
    }

    const profile = (await resp.json()) as OrgProfile;
    this.orgUUID = profile.organization.uuid;
    return profile;
  }

  async ensureOrgUUID(): Promise<string> {
    if (this.orgUUID) return this.orgUUID;
    const profile = await this.fetchProfile();
    return profile.organization.uuid;
  }

  getOrgUUID(): string | null {
    return this.orgUUID;
  }

  // ─── Environments ───

  async listEnvironments(): Promise<Environment[]> {
    await this.ensureOrgUUID();
    const resp = await this.request<{ environments: Environment[] }>(
      "GET",
      "/v1/environment_providers",
      CCR_BETA
    );
    return resp.data.environments;
  }

  async createEnvironment(
    name = "claude-code-default",
    config?: Partial<CreateEnvironmentConfig>
  ): Promise<Environment> {
    await this.ensureOrgUUID();
    const resp = await this.request<Environment>(
      "POST",
      "/v1/environment_providers/cloud/create",
      CCR_BETA,
      {
        name,
        kind: "anthropic_cloud",
        description: "",
        config: {
          environment_type: "anthropic",
          cwd: "/home/user",
          init_script: null,
          environment: {},
          languages: [
            { name: "python", version: "3.11" },
            { name: "node", version: "20" },
          ],
          network_config: {
            allowed_hosts: [],
            allow_default_hosts: true,
          },
          ...config,
        },
      }
    );
    return resp.data;
  }

  async ensureEnvironment(): Promise<Environment> {
    const envs = await this.listEnvironments();
    if (envs.length > 0) return envs[0];
    return this.createEnvironment();
  }

  // ─── Triggers ───

  async listTriggers(): Promise<TriggerListResponse> {
    await this.ensureOrgUUID();
    const resp = await this.request<TriggerListResponse>(
      "GET",
      "/v1/code/triggers",
      TRIGGERS_BETA
    );
    return resp.data;
  }

  async getTrigger(triggerId: string): Promise<Trigger> {
    await this.ensureOrgUUID();
    const resp = await this.request<TriggerResponse>(
      "GET",
      `/v1/code/triggers/${triggerId}`,
      TRIGGERS_BETA
    );
    return resp.data.trigger;
  }

  async createTrigger(body: CreateTriggerBody): Promise<Trigger> {
    // Validate cron before sending
    const cronError = validateCron(body.cron_expression);
    if (cronError) throw new Error(cronError);

    await this.ensureOrgUUID();
    const resp = await this.request<TriggerResponse>(
      "POST",
      "/v1/code/triggers",
      TRIGGERS_BETA,
      body
    );
    return resp.data.trigger;
  }

  async updateTrigger(triggerId: string, body: UpdateTriggerBody): Promise<Trigger> {
    if (body.cron_expression) {
      const cronError = validateCron(body.cron_expression);
      if (cronError) throw new Error(cronError);
    }

    await this.ensureOrgUUID();
    const resp = await this.request<TriggerResponse>(
      "POST",
      `/v1/code/triggers/${triggerId}`,
      TRIGGERS_BETA,
      body
    );
    return resp.data.trigger;
  }

  async runTrigger(triggerId: string): Promise<TriggerRunResponse> {
    await this.ensureOrgUUID();
    const resp = await this.request<TriggerRunResponse>(
      "POST",
      `/v1/code/triggers/${triggerId}/run`,
      TRIGGERS_BETA,
      {}
    );
    return resp.data;
  }

  async enableTrigger(triggerId: string): Promise<Trigger> {
    return this.updateTrigger(triggerId, { enabled: true });
  }

  async disableTrigger(triggerId: string): Promise<Trigger> {
    return this.updateTrigger(triggerId, { enabled: false });
  }

  // ─── Sessions (beyond what /schedule exposes) ───

  async listSessions(): Promise<SessionListResponse> {
    await this.ensureOrgUUID();
    const resp = await this.request<SessionListResponse>(
      "GET",
      "/v1/sessions",
      CCR_BETA
    );
    return resp.data;
  }

  async getSession(sessionId: string): Promise<Session> {
    await this.ensureOrgUUID();
    const resp = await this.request<Session>(
      "GET",
      `/v1/sessions/${sessionId}`,
      CCR_BETA
    );
    return resp.data;
  }

  /**
   * Create a remote CCR session directly.
   * This is what triggers spawn under the hood — exposed here
   * for direct session creation without a trigger/cron schedule.
   */
  async createSession(opts: {
    title?: string;
    environmentId: string;
    repoUrl?: string;
    revision?: string;
    seedBundleFileId?: string;
    environmentVariables?: Record<string, string>;
    model?: string;
    prompt?: string;
  }): Promise<{ id: string; title: string }> {
    await this.ensureOrgUUID();

    const sources: SessionContext["sources"] = [];
    if (opts.repoUrl) {
      sources.push({
        git_repository: {
          url: opts.repoUrl,
          ...(opts.revision ? { revision: opts.revision } : {}),
        } as { url: string },
      });
    }

    const body: Record<string, unknown> = {
      title: opts.title ?? "Remote session",
      events: opts.prompt
        ? [
            {
              uuid: crypto.randomUUID(),
              session_id: "",
              type: "user",
              parent_tool_use_id: null,
              message: { content: opts.prompt, role: "user" },
            },
          ]
        : [],
      session_context: {
        sources,
        ...(opts.seedBundleFileId
          ? { seed_bundle_file_id: opts.seedBundleFileId }
          : {}),
        outcomes: [],
        environment_variables: {
          CLAUDE_CODE_OAUTH_TOKEN: this.accessToken,
          ...opts.environmentVariables,
        },
      },
      environment_id: opts.environmentId,
    };

    const resp = await this.request<{ id: string; title?: string }>(
      "POST",
      "/v1/sessions",
      CCR_BETA,
      body
    );

    return {
      id: resp.data.id,
      title: resp.data.title ?? opts.title ?? "Remote session",
    };
  }

  /**
   * Send a user message to a running session.
   */
  async sendSessionEvent(
    sessionId: string,
    content: string,
    uuid?: string
  ): Promise<ApiResponse> {
    await this.ensureOrgUUID();
    return this.request(
      "POST",
      `/v1/sessions/${sessionId}/events`,
      CCR_BETA,
      {
        events: [
          {
            uuid: uuid ?? crypto.randomUUID(),
            session_id: sessionId,
            type: "user",
            parent_tool_use_id: null,
            message: { role: "user", content },
          },
        ],
      }
    );
  }

  /**
   * Get the branch name from session outcomes (after session completes).
   */
  getSessionBranch(session: Session): string | undefined {
    const outcomes = (session as Record<string, unknown>).session_context as
      | { outcomes?: Array<{ type: string; git_info?: { branches: string[] } }> }
      | undefined;
    return outcomes?.outcomes?.find((o) => o.type === "git_repository")?.git_info
      ?.branches[0];
  }

  // ─── Files API (for seed bundles) ───

  async uploadFile(
    fileContent: Buffer | Uint8Array,
    filename: string,
    purpose = "user_data"
  ): Promise<{ id: string; filename: string; size: number }> {
    await this.ensureOrgUUID();
    const boundary = `----FormBoundary${crypto.randomUUID().replace(/-/g, "")}`;

    const parts: Buffer[] = [];
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`
      )
    );
    parts.push(Buffer.from(fileContent));
    parts.push(Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\n${purpose}\r\n`));
    parts.push(Buffer.from(`--${boundary}--\r\n`));

    const body = Buffer.concat(parts);

    const resp = await fetch(`${this.baseUrl}/v1/files`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "anthropic-version": ANTHROPIC_VERSION,
        "anthropic-beta": FILES_BETA,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        ...(this.orgUUID ? { "x-organization-uuid": this.orgUUID } : {}),
      },
      body,
      signal: AbortSignal.timeout(60_000),
    });

    if (!resp.ok) {
      throw new TriggerApiError(
        `File upload failed: ${resp.status}`,
        resp.status,
        await resp.json().catch(() => null)
      );
    }

    const data = (await resp.json()) as { id: string; filename: string; size_bytes: number };
    return { id: data.id, filename: data.filename, size: data.size_bytes };
  }

  // ─── GitHub integration ───

  /**
   * Check if GitHub token is synced for remote sessions.
   * Requires tengu_cobalt_lantern feature flag.
   */
  async checkGitHubTokenSync(): Promise<boolean> {
    await this.ensureOrgUUID();
    try {
      const resp = await fetch(
        `${this.baseUrl}/api/oauth/organizations/${this.orgUUID}/sync/github/auth`,
        {
          headers: {
            ...this.headers(CCR_BETA),
          },
          signal: AbortSignal.timeout(15_000),
        }
      );
      if (resp.status !== 200) return false;
      const data = (await resp.json()) as { is_authenticated?: boolean };
      return data.is_authenticated === true;
    } catch {
      return false;
    }
  }

  /**
   * Check if the Claude GitHub App is installed on a repo.
   */
  async checkGitHubAppInstalled(
    owner: string,
    repo: string
  ): Promise<{ installed: boolean; status?: string }> {
    await this.ensureOrgUUID();
    try {
      const resp = await fetch(
        `${this.baseUrl}/api/oauth/organizations/${this.orgUUID}/code/repos/${owner}/${repo}`,
        {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            "x-organization-uuid": this.orgUUID!,
          },
          signal: AbortSignal.timeout(15_000),
        }
      );
      if (resp.status !== 200) return { installed: false };
      const data = (await resp.json()) as { status?: { app_installed?: boolean } };
      return {
        installed: data.status?.app_installed === true,
        status: JSON.stringify(data.status),
      };
    } catch {
      return { installed: false };
    }
  }
}

// ─── Helper: Build trigger body ───

export function buildTriggerBody(opts: {
  name: string;
  cron: string;
  prompt: string;
  environmentId: string;
  repoUrl?: string;
  model?: string;
  tools?: string[];
  mcpConnections?: McpConnection[];
  enabled?: boolean;
}): CreateTriggerBody {
  return {
    name: opts.name,
    cron_expression: opts.cron,
    enabled: opts.enabled ?? true,
    job_config: {
      ccr: {
        environment_id: opts.environmentId,
        session_context: {
          model: opts.model ?? DEFAULT_MODEL,
          sources: opts.repoUrl
            ? [{ git_repository: { url: opts.repoUrl } }]
            : [],
          allowed_tools: opts.tools ?? DEFAULT_TOOLS,
        },
        events: [
          {
            data: {
              uuid: crypto.randomUUID(),
              session_id: "",
              type: "user",
              parent_tool_use_id: null,
              message: {
                content: opts.prompt,
                role: "user",
              },
            },
          },
        ],
      },
    },
    ...(opts.mcpConnections?.length ? { mcp_connections: opts.mcpConnections } : {}),
  };
}
