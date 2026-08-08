# Browser sync

MVP-0.1 keeps participant interaction local-first. `outbox-sync.ts` reads durable IndexedDB outbox commands in per-session sequence and submits them through the authenticated Firebase callable command gateway. Successful acknowledgements advance local sync metadata; commands remain durable for later recovery/compaction work.

The Firebase browser adapter is configured through Vite environment variables. Real participant data remains out of scope for MVP-0.1.
