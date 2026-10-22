#!/usr/bin/env bash
# Open (or refresh) the release PR develop → main.
#
#   scripts/release-pr.sh            # needs gh, logged in, and a fetched origin
#
# The body lists the PRs merged to develop since the last release (main's head),
# taken from the first-parent merge commits. Merging the PR (merge commit, never
# squash) builds fiddur/aurboda:latest and the stable APK from main.
set -euo pipefail

git fetch -q origin main develop
range="origin/main..origin/develop"
if [ -z "$(git log -1 --format=%H "$range")" ]; then
  echo "develop has nothing main does not have; no release to cut." >&2
  exit 0
fi

last_release=$(git log -1 --format='%cs (%h)' origin/main)
changes=$(git log --first-parent --format='- %s' "$range" | grep -v -i '^- backmerge' || true)
count=$(printf '%s\n' "$changes" | grep -c . || true)
title="Release $(date +%F)"
body=$(cat <<BODY
Release of \`develop\` to \`main\`. Previous release: ${last_release}.

Merging this (as a **merge commit**) publishes \`fiddur/aurboda:latest\` and the stable Android release from main.

## Changes (${count})

${changes}
BODY
)

existing=$(gh pr list --base main --head develop --state open --json number --jq '.[0].number // empty')
if [ -n "$existing" ]; then
  gh pr edit "$existing" --title "$title" --body "$body"
  echo "updated release PR #$existing"
else
  gh pr create --base main --head develop --title "$title" --body "$body"
fi
