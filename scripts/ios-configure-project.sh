#!/usr/bin/env bash
# Runs ios-configure-project.rb with the Ruby + xcodeproj gem that ship with Homebrew CocoaPods.
set -euo pipefail
POD_BIN="$(readlink -f "$(command -v pod)")"           # .../Cellar/cocoapods/<v>/libexec/bin/pod
GEM_HOME="$(cd "$(dirname "${POD_BIN}")/.." && pwd)"   # .../libexec
RUBY="$(command -v ruby)"
[ -x /opt/homebrew/opt/ruby/bin/ruby ] && RUBY=/opt/homebrew/opt/ruby/bin/ruby
export GEM_HOME
exec "${RUBY}" "$(dirname "${BASH_SOURCE[0]}")/ios-configure-project.rb" "$@"
