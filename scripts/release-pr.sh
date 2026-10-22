#!/usr/bin/env bash
# Open (or refresh) the release PR develop → main.
#
#   scripts/release-pr.sh            # needs gh, logged in, and a fetched origin
#
# The body lists the PRs merged to develop since the last release (main's head),
# taken from the first-parent merge commits, plus the release-gate checklist.
# The `release-tryout` label asks the release tryout routine (tryouts/routine.md)
# to gate the PR; it is re-added on every refresh so a moved head is re-tried.
# Merging the PR (merge commit, never squash) builds fiddur/aurboda:latest and
# the stable APK from main. Merge only on an instruction naming the PR.
set -euo pipefail

git fetch -q origin main develop
range="origin/main..origin/develop"
if [ -z "$(git log -1 --format=%H "$range")" ]; then
  echo "develop has nothing main does not have; no release to cut." >&2
  exit 0
fi

last_release=$(git log -1 --format='%cs (%h)' origin/main)
head_sha=$(git rev-parse --short=7 origin/develop)
changes=$(git log --first-parent --format='- %s' "$range" | grep -v -i '^- backmerge' || true)
count=$(printf '%s\n' "$changes" | grep -c . || true)
title="Release $(date +%F)"
body=$(cat <<BODY
Release of \`develop\` to \`main\`. Previous release: ${last_release}.

Merging this (as a **merge commit**) publishes \`fiddur/aurboda:latest\` and the stable Android release from main.

## Changes (${count})

${changes}

## Release gate

Ticked by the release tryout (\`tryouts/routine.md\`) for head \`${head_sha}\`; a new head needs a new run.

- [ ] Fresh boot of \`fiddur/aurboda:${head_sha}\` passes the release smoke
- [ ] Upgrade from \`fiddur/aurboda:latest\` on a seeded database migrates clean and keeps its data
- [ ] Tryout review on the current head starts with ✅ Approved
- [ ] Merged as a merge commit, on an instruction naming this PR
BODY
)

existing=$(gh pr list --base main --head develop --state open --json number --jq '.[0].number // empty')
if [ -n "$existing" ]; then
  gh pr edit "$existing" --title "$title" --body "$body" --add-label release-tryout
  echo "updated release PR #$existing"
else
  gh pr create --base main --head develop --title "$title" --body "$body" --label release-tryout
fi
