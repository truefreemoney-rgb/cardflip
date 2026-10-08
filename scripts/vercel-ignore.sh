#!/bin/sh
# Vercel ignored build step (vercel.json "ignoreCommand"): exit 0 = SKIP the build, exit 1 = build.
# Skips deploys that only touch docs/ or *.md (STATE.md saves were costing a full build each; Chris 10-08).
# Compares against the last deployed commit, not HEAD^, so a docs commit on top of a code commit still builds.
base="${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}"
git fetch --depth=100 origin "${VERCEL_GIT_COMMIT_REF:-main}" >/dev/null 2>&1 || true
if git diff --quiet "$base" HEAD -- . ":(exclude)docs" ":(exclude)*.md" 2>/dev/null; then
  echo "docs-only change, skipping build"; exit 0
fi
exit 1
