# Glossary

Bisellium's product-facing contract uses Latin names. The wire-level
`workflow.*` attribute names and the lifecycle state ids stay English
everywhere, including inside Latin-named files — see `docs/ADOPTION.md`.

| Latin | English | Meaning |
|---|---|---|
| Patron | Owner | the human who greenlights, funds and answers escalations. |
| Collegium | Department | a group of sellae with a shared lex and magister. |
| Magister | Lead | the collegium's default reviewer and escalation point. |
| Sella | Seat / actor | one human or agent identity in the studio. |
| Lex | Charter | a collegium's standing rules, in `leges/<collegium>.md`. |
| Acta | Digest | an inform-and-proceed entry, not a request for approval. |
| Petitio | Ask / thread | a question to the Patron not tied to one opus. |
| Opus | Work item | one unit of work, tracked in `opera/<id>.md`. |
| Probatio | Gate | one thing that must pass before an opus is done. |
| Traditio | Handoff | the record of who has an opus now and what's next. |
| Aerarium | Budget | a collegium's spend allowance for a period. |
| Stipendium | Allowance | one sella's share of an aerarium. |
| Officina | Studio | a directory of the files this glossary describes. |
| Cascade | Build round | one batch of opera run together by a set of builders. |
| Retrospectio | Retro | a cascade's closing review, written after it lands. |
| Seat | Seat | a sella template, one per build tier, declared in `sellae`. |
| Instance | Instance | `<seat>.<opus-id>`, minted at dispatch; carries no state of its own. |

## Probatio kinds

- `automated` — a shell command; passes iff it exits 0.
- `agent` — a sella's verdict, recorded as evidence.
- `human` — the Patron's own call.
