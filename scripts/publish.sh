#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -e "console.log(require('./package.json').version)")
echo "Publishing claude-triggers v${VERSION}"

pnpm build
npm publish --access public

git tag "v${VERSION}"
git push origin main --tags

echo ""
echo "Published: https://www.npmjs.com/package/claude-triggers"
