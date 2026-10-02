# Existing-read observation results

Observed 2026-09-28 in `/home/edckt/projects/bisellium`.

The architect artifact was originally found at the malformed nested path `/home/edckt/projects/bisellium/wsl.localhost/Ubuntu/home/edckt/projects/bisellium/docs/research/read-efficiency-trial-2026-09-28/spec.md`; the producer subsequently copied it byte-for-byte to this intended directory. The executed command sequences were retained before execution as `stage1.sh` and `stage2.sh`.

## Packet byte counts

Path/location headers are included. Targeted total is discovery/location plus body.

| Pass | Case | Baseline bytes | Targeted discovery/location bytes | Targeted body bytes | Targeted total | Required span |
|---|---|---:|---:|---:|---:|---|
| cold | `docs/ADOPTION.md` | 73,289 | 662 | 2,555 | 3,217 | exact |
| cold | `studio/leges/design.md` | 2,038 | 183 | 466 | 649 | exact |
| cold | `studio/leges/engineering.md` | 2,826 | 188 | 1,370 | 1,558 | exact |
| repeat | `docs/ADOPTION.md` | 73,289 | 662 | 2,555 | 3,217 | exact |
| repeat | `studio/leges/design.md` | 2,038 | 183 | 466 | 649 | exact |
| repeat | `studio/leges/engineering.md` | 2,826 | 188 | 1,370 | 1,558 | exact |

| Aggregate | Baseline bytes | Targeted discovery/location bytes | Targeted body bytes | Targeted total | Payload-byte savings |
|---|---:|---:|---:|---:|---:|
| cold | 78,153 | 1,033 | 4,391 | 5,424 | 93.06% |
| repeat | 78,153 | 1,033 | 4,391 | 5,424 | 93.06% |
| both passes | 156,306 | 2,066 | 8,782 | 10,848 | 93.06% |

## Evidence and limits

All six tools were available. Every captured stderr file was empty. Pre- and post-read SHA-256 hashes were identical for all three sources. For every case and pass, the SHA-256 hash of the complete required span extracted from the baseline packet equals the hash of the targeted body payload after its header. Cold and repeated targeted body bytes are equal and nonzero.

The raw packets, counts, hashes, span checks, timestamps and stderr artifacts are retained in this directory. The 73 KB ADOPTION baseline packets were retained on disk but not delivered in full through the model tool wrapper. These are therefore exact UTF-8 candidate payload byte sizes, not a claim of complete model-visible delivery. Measurement/report files, shell execution, hashes, stderr files and tool-wrapper overhead are excluded from packet counts; path, range and discovery headers are included. Transport envelopes and API tokenization are unmeasured. The result supports these existing targeted reads only for the three fixed known-file questions and makes no timing, answer-quality, cache, retained-knowledge, subscription-cost or general retrieval claim. No review verdict or opus/gate claim is implied.
