# claude-triggers

Standalone package for managing Claude Code scheduled remote agents (triggers).
Replicates and extends `/schedule` from Claude Code v2.1.81.

## Project Structure

```
src/
  client.ts      API client (triggers, sessions, envs, files, github)
  credentials.ts OAuth token reader + direct refresh
  cron.ts        Parser, validator, describer, interval converter
  cli.ts         CLI entry point
  types.ts       All type definitions
  index.ts       Public API exports
  e2e.ts         Integration test suite
```

## Development

```bash
pnpm install
pnpm build          # TypeScript → dist/
pnpm lint           # Type check only
pnpm test:e2e       # Full E2E against live API (needs Claude Code auth)
pnpm dev -- test    # Quick CLI connectivity test
```

## Releasing

Versioning follows semver. Releases are automated via GitHub Actions.

### How to release

```bash
pnpm release          # patch: 0.1.0 → 0.1.1
pnpm release:minor    # minor: 0.1.x → 0.2.0  
pnpm release:major    # major: 0.x.x → 1.0.0
```

Each command: builds → bumps version in package.json → commits → tags → pushes.
The `v*` tag push triggers `.github/workflows/publish.yml` → npm publish + GitHub Release.

### When to bump what

- **patch**: bug fixes, dependency updates, docs, internal refactors
- **minor**: new features, new API methods, new CLI commands, non-breaking additions
- **major**: breaking API changes, removed methods, changed type signatures

### Manual publish (if CI fails)

```bash
pnpm build
npm publish --access public
```

The `.npmrc` in the repo root (gitignored) has the npm token for local publishing.

## API Versions / Beta Headers

These are reverse-engineered from Claude Code and may change:

| API | Beta Header | Added |
|-----|-------------|-------|
| Triggers | `ccr-triggers-2026-01-30` | v2.1.81 |
| Sessions/Envs | `ccr-byoc-2025-07-29` | pre-2.1.78 |
| Files | `files-api-2025-04-14` | pre-2.1.78 |

### Updating beta headers

When Anthropic updates these, grep for the old header in `src/client.ts` and replace.
Check new Claude Code versions by extracting `cli.js` from the npm package:

```bash
npm pack @anthropic-ai/claude-code@latest
tar xzf anthropic-ai-claude-code-*.tgz
grep -o 'ccr[a-z0-9_-]*\d\{4\}-\d\{2\}-\d\{2\}' package/cli.js | sort -u
```

## OAuth Constants

From Claude Code v2.1.81 — update if Anthropic changes these:

| Constant | Value |
|----------|-------|
| TOKEN_URL | `https://platform.claude.com/v1/oauth/token` |
| CLIENT_ID | `9d1c250a-e61b-44d9-88ed-5944d1962f5e` |
| Keychain service | `Claude Code-credentials` |
| Credentials file | `~/.claude/.credentials.json` |
| Scopes | `user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload` |

## Feature Flags

The trigger API is gated by feature flags on Anthropic's side:

- `tengu_surreal_dali` — gates `/schedule` command and RemoteTrigger tool
- `tengu_cobalt_lantern` — gates GitHub token sync
- `tengu_kairos_cron` — gates local cron scheduler (not relevant to this package)
- `allow_remote_sessions` — org-level policy gate

If users get 403/404 on trigger endpoints, they likely don't have the flag enabled yet.

## Testing

- `pnpm test:e2e` runs full CRUD against the live API
- Tests create a trigger with a far-future cron (`0 3 1 1 *` — Jan 1 at 3am), so it won't actually fire
- Tests disable the trigger after, but can't delete via API — manual cleanup at https://claude.ai/code/scheduled
- Set `DEBUG=1` for full error stack traces

## Upstream Tracking

This package tracks Claude Code's npm releases. When a new version drops:

1. Extract and diff `cli.js` for trigger/schedule/CCR changes
2. Check for new beta headers, API endpoints, or body fields
3. Update `src/client.ts` and `src/types.ts` accordingly
4. Run E2E tests
5. Release with appropriate version bump
