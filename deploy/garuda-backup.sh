#!/bin/sh
# The entire database is one JSON file. Copy it, keep 14 days, and verify the
# copy parses before trusting it -- an unparseable backup is worse than none,
# because it is discovered only during a restore.
set -eu
DATA=/opt/garuda/data/garuda.json
DEST=/opt/garuda/backups
STAMP=$(date -u +%Y%m%dT%H%M%SZ)

[ -f "$DATA" ] || { echo "no data file at $DATA"; exit 0; }
mkdir -p "$DEST"
cp "$DATA" "$DEST/garuda-$STAMP.json"

# Reject a copy that is not valid JSON rather than keeping a broken one.
if ! python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$DEST/garuda-$STAMP.json" 2>/dev/null; then
  echo "backup did not parse as JSON, discarding: garuda-$STAMP.json"
  rm -f "$DEST/garuda-$STAMP.json"
  exit 1
fi

gzip -9 "$DEST/garuda-$STAMP.json"
find "$DEST" -name 'garuda-*.json.gz' -mtime +14 -delete
echo "backup ok: garuda-$STAMP.json.gz"
