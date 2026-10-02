#!/usr/bin/env python3
"""Archive the historical tail of SESSION-HANDOFF.md exactly once."""
from pathlib import Path
import hashlib
ROOT = Path(__file__).resolve().parents[2]
LIVE = ROOT / "docs/SESSION-HANDOFF.md"
ARCHIVE = ROOT / "docs/SESSION-HANDOFF-HISTORY-2026-09-28.md"
MARKER = b"## Historical handoff (2026-09-25, cascade 34 closing)"
ARCHIVE_HEADER = b"# Session handoff history (archived 2026-09-28)\n\n"
source = LIVE.read_bytes()
if ARCHIVE.exists(): raise SystemExit(f"refusing existing destination: {ARCHIVE}")
if source.count(MARKER) != 1: raise SystemExit("refusing unexpected input: historical marker count is not one")
prefix, tail = source.split(MARKER, 1); tail = MARKER + tail
if not prefix or not tail or not prefix.endswith(b"\n\n"): raise SystemExit("refusing unexpected input: invalid prefix or boundary")
prefix_hash = hashlib.sha256(prefix).hexdigest(); tail_hash = hashlib.sha256(tail).hexdigest()
archive_bytes = ARCHIVE_HEADER + tail
new_live = prefix + b"## Historical handoff\n\nThe historical handoff is archived in [SESSION-HANDOFF-HISTORY-2026-09-28.md](SESSION-HANDOFF-HISTORY-2026-09-28.md). Read it on demand.\n"
ARCHIVE.write_text(archive_bytes.decode("utf-8"), encoding="utf-8", newline="")
LIVE.write_text(new_live.decode("utf-8"), encoding="utf-8", newline="")
written_archive = ARCHIVE.read_bytes(); written_live = LIVE.read_bytes()
if written_archive != archive_bytes or written_live[:len(prefix)] != prefix: raise SystemExit("verification failed: preserved bytes changed")
if written_archive[len(ARCHIVE_HEADER):] != tail: raise SystemExit("verification failed: archived tail changed")
print(f"before bytes={len(source)} chars={len(source.decode('utf-8'))}")
print(f"after live bytes={len(written_live)} chars={len(written_live.decode('utf-8'))}")
print(f"archive bytes={len(written_archive)} chars={len(written_archive.decode('utf-8'))}")
print(f"scopecheck prefix_sha256={prefix_hash} tail_sha256={tail_hash} prefix_exact=true tail_exact=true")
