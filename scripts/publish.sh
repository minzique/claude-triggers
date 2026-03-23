#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -e "console.log(require('./package.json').version)")
echo "Tagging v${VERSION} — GitHub Actions will publish to npm via trusted publishing"

pnpm build
git add -A
git diff --cached --quiet || git commit -m "chore: release v${VERSION}"
git tag "v${VERSION}"
git push origin main --tags

echo ""
echo "Tag pushed. GitHub Actions will:"
echo "  1. Build"
echo "  2. Publish to npm via OIDC (no token needed)"
echo "  3. Create GitHub release"
echo ""
echo "Watch: https://github.com/minzique/claude-triggers/actions"
