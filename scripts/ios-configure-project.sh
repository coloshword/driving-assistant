#!/usr/bin/env bash
# Runs ios-configure-project.rb with the Ruby + xcodeproj gem that ship with Homebrew CocoaPods.
set -euo pipefail
GEM_HOME="${DA_GEM_HOME:-}"
if [ -z "${GEM_HOME}" ]; then
  # Homebrew's `pod` is a shim that exports GEM_HOME; reuse it.
  GEM_HOME="$(grep -o 'GEM_HOME="[^"]*"' "$(command -v pod)" 2>/dev/null | head -1 | cut -d'"' -f2 || true)"
fi
[ -n "${GEM_HOME}" ] || { echo "could not determine CocoaPods GEM_HOME; set DA_GEM_HOME" >&2; exit 1; }
RUBY="$(command -v ruby)"
[ -x /opt/homebrew/opt/ruby/bin/ruby ] && RUBY=/opt/homebrew/opt/ruby/bin/ruby
export GEM_HOME
exec "${RUBY}" "$(dirname "${BASH_SOURCE[0]}")/ios-configure-project.rb" "$@"
