#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "Usage: scripts/copy_lint.sh <files...>" >&2
  exit 2
fi

status=0
for file in "$@"; do
  if LC_ALL=C grep -nEi -- '@[[:alnum:]][[:alnum:].-]*\.[[:alpha:]]{2,}' "$file"; then
    echo "Copy lint failed: $file" >&2
    status=1
  else
    result=$?
    if [ "$result" -ne 1 ]; then
      status=1
    fi
  fi
done
exit "$status"
