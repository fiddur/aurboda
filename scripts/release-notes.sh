#!/usr/bin/env bash
# The release notes for a commit on main: the change list of the release PR that
# merged it (the "## Changes" section scripts/release-pr.sh writes), or nothing
# when the commit did not come from a PR into main.
#
#   scripts/release-notes.sh <commit sha>   # needs gh and GH_TOKEN
set -euo pipefail

sha=${1:?usage: scripts/release-notes.sh <commit sha>}
repo=${GITHUB_REPOSITORY:-fiddur/aurboda}

gh api "repos/${repo}/commits/${sha}/pulls" \
  --jq '[.[] | select(.base.ref == "main" and .merge_commit_sha == "'"${sha}"'")][0] | select(.) | "\(.body // "")\n\nRelease PR: #\(.number)"' |
  tr -d '\r' |
  awk '
    /^## Changes/ { keep = 1 }
    keep && /^## / && !/^## Changes/ { keep = 0 }
    keep || /^Release PR: #/ { print }
  '
