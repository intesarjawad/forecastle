#!/usr/bin/env bash
# Usage: scripts/lint_workflows.sh [dir]; dir defaults to .github/workflows.
set -euo pipefail
for f in "${1:-.github/workflows}"/*.yml; do
  yq -e '.defaults.run.shell == "bash"' "$f" > /dev/null 2>&1 || { echo "::error file=$f::top-level defaults.run.shell must be bash"; exit 1; }
  if grep -Eq '(^|[^[:alnum:]_-])gh (issue|api|run|workflow|variable|label|release)' "$f"; then
    grep -q 'GH_TOKEN' "$f" || { echo "::error file=$f::calls gh without GH_TOKEN"; exit 1; }
  fi
done
