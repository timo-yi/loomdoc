#!/usr/bin/env bash
# Model-check the loomdoc ui run slot (model/RunSlot.tla) with TLC, then confirm each mutant
# (a known way to break the code, mirrored in the model) is caught. See ../SKILL.md.
#   check.sh            model + mutants + drift report
#   check.sh --model    the model only
set -euo pipefail

SKILL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(cd "$SKILL/../../.." && pwd)"
TLA_VERSION="1.7.4"
TLA_SHA256="936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88"
JAR="${TLA2TOOLS_JAR:-$HOME/.cache/tlaplus/tla2tools-$TLA_VERSION.jar}"
SYNC_COMMIT="$(sed -nE 's/^- \*\*Sync commit:\*\* `([0-9a-f]+)`.*/\1/p' "$SKILL/SKILL.md")"
COVERED="src/ui/server.ts"

die() { echo "check.sh: $*" >&2; exit 2; }

find_java() {
  for j in "${JAVA:-}" /opt/homebrew/opt/openjdk/bin/java /usr/local/opt/openjdk/bin/java; do
    [ -n "$j" ] && [ -x "$j" ] && "$j" -version >/dev/null 2>&1 && { echo "$j"; return; }
  done
  command -v java >/dev/null && java -version >/dev/null 2>&1 && { command -v java; return; }
  die "no Java runtime. Install one (macOS: brew install openjdk) or set JAVA=/path/to/java"
}

ensure_jar() {
  if [ ! -f "$JAR" ]; then
    mkdir -p "$(dirname "$JAR")"
    echo "downloading tla2tools $TLA_VERSION to $JAR"
    curl -fsSL -o "$JAR.part" "https://github.com/tlaplus/tlaplus/releases/download/v$TLA_VERSION/tla2tools.jar"
    mv "$JAR.part" "$JAR"
  fi
  local got; got="$(shasum -a 256 "$JAR" | cut -d' ' -f1)"
  [ "$got" = "$TLA_SHA256" ] || die "$JAR has sha256 $got, expected $TLA_SHA256"
}

# tlc <dir>: run TLC on <dir>/RunSlot.tla, save its output to <dir>/tlc.out, return its exit code
tlc() {
  local dir="$1" out code=0
  out="$(cd "$dir" && "$JAVA" -XX:+UseParallelGC -cp "$JAR" tlc2.TLC -workers auto -cleanup \
    -metadir "$dir/.tlc" -config RunSlot.cfg RunSlot.tla 2>&1)" || code=$?
  echo "$out" > "$dir/tlc.out"
  return "$code"
}

JAVA="$(find_java)"
ensure_jar
WORK="$(mktemp -d "${TMPDIR:-/tmp}/run-slot-check.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/model"
cp "$SKILL/model/RunSlot.tla" "$SKILL/model/RunSlot.cfg" "$WORK/model/"
if tlc "$WORK/model"; then
  echo "MODEL: PASS ($(grep -oE '[0-9]+ distinct states found' "$WORK/model/tlc.out" | tail -1))"
else
  echo "MODEL: FAIL. TLC output (read the trace with /pstack:statechart):"
  cat "$WORK/model/tlc.out"
  exit 1
fi
[ "${1:-}" = "--model" ] && exit 0

# Each mutant mirrors a real break in src/ui/server.ts (see mutants.py). A mutant that passes
# means the model went blind to that break.
total=0; caught=0
while IFS=$'\t' read -r name expected; do
  total=$((total + 1))
  dir="$WORK/$name"; mkdir -p "$dir"
  cp "$SKILL/model/RunSlot.cfg" "$dir/"
  if ! python3 -I "$SKILL/scripts/mutants.py" apply "$name" "$SKILL/model/RunSlot.tla" "$dir/RunSlot.tla"; then
    echo "MUTANT $name: NOT APPLIED (the model text changed; update mutants.py)"; continue
  fi
  if tlc "$dir"; then
    echo "MUTANT $name: MISSED (TLC passed; the model no longer catches this break)"
  elif grep -qE "$expected" "$dir/tlc.out"; then
    echo "MUTANT $name: caught ($expected)"; caught=$((caught + 1))
  else
    echo "MUTANT $name: FAILED FOR ANOTHER REASON (expected \"$expected\"):"; tail -20 "$dir/tlc.out"
  fi
done < <(python3 -I "$SKILL/scripts/mutants.py" list)

echo
if git -C "$REPO" cat-file -e "$SYNC_COMMIT^{commit}" 2>/dev/null; then
  if git -C "$REPO" diff --quiet "$SYNC_COMMIT" -- "$COVERED"; then
    echo "DRIFT: $COVERED matches sync commit $SYNC_COMMIT"
  else
    echo "DRIFT: $COVERED differs from sync commit $SYNC_COMMIT (committed or uncommitted). Review the hunks:"
    echo "  git diff $SYNC_COMMIT -- $COVERED"
  fi
else
  echo "DRIFT: sync commit '$SYNC_COMMIT' not found in this checkout"
fi

[ "$caught" -eq "$total" ] || { echo "MUTANTS: $caught/$total caught"; exit 1; }
echo "MUTANTS: $caught/$total caught"
