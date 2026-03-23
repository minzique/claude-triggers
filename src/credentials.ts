/**
 * Claude Code credential management.
 *
 * Reads OAuth tokens from:
 *   1. macOS Keychain ("Claude Code-credentials")
 *   2. ~/.claude/.credentials.json
 *
 * Refreshes tokens via:
 *   1. Direct OAuth refresh_token grant (same as Claude Code)
 *   2. Fallback: shell out to `claude` CLI
 *
 * Token storage after refresh writes back to the same credential store
 * so other tools (Claude Code, opencode, etc.) pick up the new token.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type { ClaudeCredentials, OAuthTokenResponse } from "./types.js";
import { AuthError } from "./types.js";

// ─── Constants (from Claude Code v2.1.81) ───

const KEYCHAIN_SERVICE = "Claude Code-credentials";
const CREDENTIALS_PATH = join(homedir(), ".claude", ".credentials.json");
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const DEFAULT_SCOPES = [
  "user:profile",
  "user:inference",
  "user:sessions:claude_code",
  "user:mcp_servers",
  "user:file_upload",
];

const CACHE_TTL_MS = 30_000;
const REFRESH_BUFFER_MS = 60_000; // Refresh if expires within 60s

// ─── Cache ───

let cached: ClaudeCredentials | null = null;
let cachedAt = 0;

/**
 * Clear the in-memory credential cache. Call after external token refresh.
 */
export function clearCredentialCache(): void {
  cached = null;
  cachedAt = 0;
}

// ─── Keychain (macOS) ───

function readKeychain(): ClaudeCredentials | null {
  if (process.platform !== "darwin") return null;

  let raw: string;
  try {
    raw = execSync(`security find-generic-password -s "${KEYCHAIN_SERVICE}" -w`, {
      timeout: 3000,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }

  return parseCredentialJson(raw);
}

function writeKeychain(creds: ClaudeCredentials): boolean {
  if (process.platform !== "darwin") return false;

  const payload = JSON.stringify({
    claudeAiOauth: {
      accessToken: creds.accessToken,
      refreshToken: creds.refreshToken,
      expiresAt: creds.expiresAt,
      scopes: creds.scopes ?? DEFAULT_SCOPES,
    },
  });

  try {
    // Delete existing first (security won't overwrite)
    try {
      execSync(`security delete-generic-password -s "${KEYCHAIN_SERVICE}"`, {
        stdio: "pipe",
        timeout: 3000,
      });
    } catch {
      // May not exist
    }

    execSync(
      `security add-generic-password -s "${KEYCHAIN_SERVICE}" -a "claude-code" -w "${payload.replace(/"/g, '\\"')}"`,
      { stdio: "pipe", timeout: 3000 }
    );
    return true;
  } catch {
    return false;
  }
}

// ─── Credentials File ───

function readCredentialsFile(): ClaudeCredentials | null {
  try {
    const raw = readFileSync(CREDENTIALS_PATH, "utf-8");
    return parseCredentialJson(raw);
  } catch {
    return null;
  }
}

function writeCredentialsFile(creds: ClaudeCredentials): boolean {
  try {
    let existing: Record<string, unknown> = {};
    try {
      existing = JSON.parse(readFileSync(CREDENTIALS_PATH, "utf-8"));
    } catch {
      // Fresh file
    }

    existing.claudeAiOauth = {
      accessToken: creds.accessToken,
      refreshToken: creds.refreshToken,
      expiresAt: creds.expiresAt,
      scopes: creds.scopes ?? DEFAULT_SCOPES,
    };

    const dir = dirname(CREDENTIALS_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(CREDENTIALS_PATH, JSON.stringify(existing, null, 2), "utf-8");
    return true;
  } catch {
    return false;
  }
}

// ─── Parsing ───

function parseCredentialJson(raw: string): ClaudeCredentials | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const data = (parsed.claudeAiOauth ?? parsed) as Record<string, unknown>;

    if (
      typeof data.accessToken !== "string" ||
      typeof data.refreshToken !== "string" ||
      typeof data.expiresAt !== "number"
    ) {
      return null;
    }

    return {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresAt: data.expiresAt,
      scopes: Array.isArray(data.scopes) ? data.scopes as string[] : undefined,
    };
  } catch {
    return null;
  }
}

// ─── Token Refresh ───

/**
 * Refresh OAuth token directly via Anthropic's token endpoint.
 * This is the same flow Claude Code uses internally (mB6/refreshOAuthToken).
 */
async function refreshTokenDirect(refreshToken: string): Promise<ClaudeCredentials | null> {
  const body = {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: CLIENT_ID,
    scope: DEFAULT_SCOPES.join(" "),
  };

  try {
    const resp = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) return null;

    const data = (await resp.json()) as OAuthTokenResponse;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? refreshToken,
      expiresAt: Date.now() + data.expires_in * 1000,
      scopes: data.scope?.split(" ").filter(Boolean),
    };
  } catch {
    return null;
  }
}

/**
 * Fallback: refresh via Claude CLI invocation.
 */
function refreshViaCli(): boolean {
  try {
    execSync("claude -p . --model haiku", {
      timeout: 60_000,
      encoding: "utf-8",
      env: { ...process.env, TERM: "dumb" },
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

// ─── Store refreshed tokens ───

function storeCredentials(creds: ClaudeCredentials): void {
  // Write to both keychain and file for cross-tool compat
  if (process.platform === "darwin") {
    writeKeychain(creds);
  }
  writeCredentialsFile(creds);
  cached = creds;
  cachedAt = Date.now();
}

// ─── Public API ───

/**
 * Read credentials from the Claude Code credential store (keychain or file).
 * Does NOT refresh — returns whatever is stored.
 */
export function readCredentials(): ClaudeCredentials | null {
  return readKeychain() ?? readCredentialsFile();
}

/**
 * Get valid credentials, refreshing if needed.
 *
 * 1. Check in-memory cache
 * 2. Read from store
 * 3. If expired/near-expiry: refresh via direct OAuth grant
 * 4. Fallback: refresh via Claude CLI
 * 5. Store refreshed tokens back
 */
export async function getCredentials(forceRefresh = false): Promise<ClaudeCredentials | null> {
  const now = Date.now();

  // Cache hit
  if (
    !forceRefresh &&
    cached &&
    now - cachedAt < CACHE_TTL_MS &&
    cached.expiresAt > now + REFRESH_BUFFER_MS
  ) {
    return cached;
  }

  // Read from store
  let creds = readCredentials();

  // Valid and not near expiry
  if (creds && !forceRefresh && creds.expiresAt > now + REFRESH_BUFFER_MS) {
    cached = creds;
    cachedAt = now;
    return creds;
  }

  // Need refresh
  if (creds?.refreshToken) {
    // Try direct OAuth refresh first
    const refreshed = await refreshTokenDirect(creds.refreshToken);
    if (refreshed && refreshed.expiresAt > Date.now() + REFRESH_BUFFER_MS) {
      storeCredentials(refreshed);
      return refreshed;
    }
  }

  // Fallback: CLI refresh
  if (refreshViaCli()) {
    creds = readCredentials();
    if (creds && creds.expiresAt > Date.now() + REFRESH_BUFFER_MS) {
      cached = creds;
      cachedAt = Date.now();
      return creds;
    }
  }

  // Return whatever we have, even if expired (caller decides)
  if (creds) {
    cached = creds;
    cachedAt = now;
  }
  return creds;
}

/**
 * Get credentials synchronously (no refresh). For quick checks.
 */
export function getCredentialsSync(): ClaudeCredentials | null {
  const now = Date.now();
  if (cached && now - cachedAt < CACHE_TTL_MS && cached.expiresAt > now + REFRESH_BUFFER_MS) {
    return cached;
  }
  const creds = readCredentials();
  if (creds) {
    cached = creds;
    cachedAt = now;
  }
  return creds;
}
