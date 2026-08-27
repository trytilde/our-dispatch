---
"@tryopenbot/inference-provider": patch
---

Bound the default Vercel AI SDK agent tool loop at 50 steps to prevent unbounded cyclic runs.
