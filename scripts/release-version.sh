#!/usr/bin/env bash
# The release number of a commit, shared by the Android app and the Docker image.
#
#   scripts/release-version.sh [<commit>]   # default HEAD; needs full history
#
# Prints GitHub Actions step outputs, so a workflow appends them to $GITHUB_OUTPUT:
#
#   code=<n>        the commit count: the APK's versionCode
#   name=1.0.<n>    the version the backend reports and the APK's versionName
#   tag=v1.0.<n>    the GitHub release tag and the Docker image tag on main
#
# The number is a release counter, not semver: the commit count on main's merge
# commit grows with every release, and every workflow that builds the same commit
# gets the same number from it.
set -euo pipefail

if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then
  echo "shallow clone: the commit count would be wrong; check out with fetch-depth: 0" >&2
  exit 1
fi

code=$(git rev-list --count "${1:-HEAD}")
printf 'code=%s\nname=1.0.%s\ntag=v1.0.%s\n' "$code" "$code" "$code"
