---
kind: research
date: 2026-09-19
status: watching
---

# Jev by TypeSafe AI

Non-autoregressive "System One" foundation model for structured machine
decisions inside software. Created by Diego Almeida (ChatGPT/RLHF co-creator).
Early access launched September 2026.

## What it does

- Single forward pass (not token-by-token). Typed input → structured answers
  with calibrated confidence scores.
- Use cases: request sorting, record scoring, jailbreak screening, real-time
  game/robotics decisions.
- $0.042/M input tokens, free output. Claims 100× speed/cost vs conventional
  LLMs on decision tasks.

## Links

- Docs: https://docs.typesafe.ai/introduction
- Blog: https://typesafe.ai/blog/introducing-system-one-models-and-jev

## Bisellium relevance

The `talk` command's deterministic query path already avoids a model for status
questions. Jev's structured-decision approach could extend that to judgment
calls that currently need a full LLM — posture evaluation, gate scoring,
priority sorting — at a fraction of the cost and latency.

Evaluate once past early access.
