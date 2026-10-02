from hashlib import sha256
from pathlib import Path

repo = Path(__file__).resolve().parents[6]
source = repo / "studio/ci/reds/W-107/08.log"
out = Path(__file__).resolve().parent / "pre-utc-08.log"
data = source.read_bytes()
out.write_bytes(data)
(Path(__file__).resolve().parent / "pre-utc-08.sha256").write_text(sha256(data).hexdigest() + "\n")
