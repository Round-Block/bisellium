---
name: reviewer46
description: DEPRECATED — do not use. Superseded by `censor`, the single review and QA gate (D-014, amended 2026-09-19). This file exists only because the sandbox holds .claude/ read-only to the shell; delete it by hand.
tools: Read
model: claude-opus-5
---

Do not review with this agent. It is a dead stub.

The studio has one reviewing agent: `censor`. Stop and tell the
orchestrating session to dispatch `Agent({ subagent_type: "censor" })`
instead.

Background: this type was created for D-014's original cross-generation
experiment (an Opus 4.6 reviewer against Sonnet 5 builders, so the review
generation differed from the build generation). Both tiers are now
generation 5, so the experiment is over and the name refers to nothing.
