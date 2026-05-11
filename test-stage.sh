#!/usr/bin/env bash
# Generate and stage fake files for testing gcmds commit
set -e

count=${1:-5}
dir=".test-files"

rm -rf "$dir"
mkdir -p "$dir"

for i in $(seq 1 "$count"); do
  echo "// fake file $i" > "$dir/file-$i.ts"
done

git add "$dir"
echo "Staged $count files in $dir/"
git diff --cached --name-only
