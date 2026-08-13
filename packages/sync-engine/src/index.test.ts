import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import {
  IndexedDbLocalStore,
  LocalStoreError,
  type CachedContentReleaseRecord,
} from "./index.js";

let databaseCounter = 0;

function createStore(): IndexedDbLocalStore {
  databaseCounter += 1;
  return new IndexedDbLocalStore({
    databaseName: `zetema-test-${databaseCounter}`,
    indexedDB: new IDBFactory(),
    keyRange: IDBKeyRange,
  });
}

function preflightEvidence() {
  return {
    eligibility: {
      minimumAge: 18 as const,
      declaration: "age_18_or_over" as const,
      confirmedAt: "2026-08-07T23:58:00.000Z",
    },
    consent: {
      purposeId: "mvp-0.2-interview-participation-v1",
      textVersion: "2026.08.1",
      scopes: ["INTERVIEW_STORAGE"],
      mechanism: "in_app_explicit" as const,
      acceptedAt: "2026-08-07T23:59:00.000Z",
    },
  };
}

async function createActiveSession(store: IndexedDbLocalStore) {
  return store.createSession({
    sessionId: "session-1",
    contentReleaseId: "release-1",
    operationId: "operation-start",
    startedAt: "2026-08-08T00:00:00.000Z",
    ...preflightEvidence(),
  });
}

describe("IndexedDbLocalStore", () => {
  it("caches immutable content releases and rejects conflicting content", async () => {
    const store = createStore();
    const record: CachedContentReleaseRecord = {
      releaseId: "release-1",
      locale: "en",
      cachedAt: "2026-08-08T00:00:00.000Z",
      payload: {
        schemaVersion: 1,
        questions: ["god-exists"],
      },
    };

    await expect(store.cacheContentRelease(record)).resolves.toEqual(record);
    await expect(
      store.cacheContentRelease({
        ...record,
        cachedAt: "2026-08-08T00:05:00.000Z",
      }),
    ).resolves.toEqual(record);

    await expect(
      store.cacheContentRelease({
        ...record,
        payload: {
          schemaVersion: 1,
          questions: ["different-question"],
        },
      }),
    ).rejects.toMatchObject<Partial<LocalStoreError>>({
      code: "CONTENT_RELEASE_CONFLICT",
    });

    await expect(store.getCachedContentRelease("release-1")).resolves.toEqual(record);
    await store.close();
  });

  it("creates a session and start command atomically and idempotently", async () => {
    const store = createStore();
    const created = await createActiveSession(store);

    expect(created.session).toMatchObject({
      sessionId: "session-1",
      state: "active",
      lastLocalSequence: 1,
      eligibility: preflightEvidence().eligibility,
      consent: preflightEvidence().consent,
    });
    expect(created.command).toMatchObject({
      command: "start_interview_session",
      operationId: "operation-start",
      localSequence: 1,
      state: "pending",
      payload: preflightEvidence(),
    });

    const retry = await createActiveSession(store);
    expect(retry).toEqual(created);

    const snapshot = await store.getSessionSnapshot("session-1");
    expect(snapshot.outbox).toHaveLength(1);
    expect(snapshot.revisions).toHaveLength(0);
    expect(snapshot.exposures).toHaveLength(0);

    await expect(
      store.createSession({
        sessionId: "session-1",
        contentReleaseId: "release-1",
        operationId: "different-operation",
        startedAt: "2026-08-08T00:00:00.000Z",
        ...preflightEvidence(),
      }),
    ).rejects.toMatchObject<Partial<LocalStoreError>>({
      code: "SESSION_ALREADY_EXISTS",
    });

    await store.close();
  });

  it("records question exposure once and rejects a conflicting outcome", async () => {
    const store = createStore();
    await createActiveSession(store);

    const exposure = {
      questionId: "god-exists",
      outcome: "presented" as const,
      reason: {
        kind: "base_sequence" as const,
      },
    };

    const recorded = await store.recordQuestionExposure({
      sessionId: "session-1",
      exposure,
      recordedAt: "2026-08-08T00:01:00.000Z",
    });

    expect(recorded.exposure).toEqual(exposure);

    const retry = await store.recordQuestionExposure({
      sessionId: "session-1",
      exposure,
      recordedAt: "2026-08-08T00:02:00.000Z",
    });
    expect(retry).toEqual(recorded);

    await expect(
      store.recordQuestionExposure({
        sessionId: "session-1",
        exposure: {
          questionId: "god-exists",
          outcome: "not_presented_interview_ended",
          reason: {
            kind: "interview_ended",
          },
        },
        recordedAt: "2026-08-08T00:03:00.000Z",
      }),
    ).rejects.toMatchObject<Partial<LocalStoreError>>({
      code: "EXPOSURE_CONFLICT",
    });

    const exposures = await store.listQuestionExposures("session-1");
    expect(exposures).toHaveLength(1);
    await store.close();
  });

  it("appends response revisions with monotonically increasing local sequences", async () => {
    const store = createStore();
    await createActiveSession(store);

    const first = await store.appendResponseRevision({
      revisionId: "revision-1",
      operationId: "operation-response-1",
      sessionId: "session-1",
      questionId: "god-exists",
      answer: { kind: "yes_no", value: "yes" },
      createdAt: "2026-08-08T00:01:00.000Z",
    });

    const second = await store.appendResponseRevision({
      revisionId: "revision-2",
      operationId: "operation-response-2",
      sessionId: "session-1",
      questionId: "god-exists",
      answer: { kind: "yes_no", value: "no" },
      createdAt: "2026-08-08T00:02:00.000Z",
    });

    expect(first.revision.localSequence).toBe(2);
    expect(second.revision.localSequence).toBe(3);

    const retry = await store.appendResponseRevision({
      revisionId: "revision-2",
      operationId: "operation-response-2",
      sessionId: "session-1",
      questionId: "god-exists",
      answer: { kind: "yes_no", value: "no" },
      createdAt: "2026-08-08T00:02:00.000Z",
    });
    expect(retry).toEqual(second);

    const revisions = await store.listResponseRevisions("session-1");
    expect(revisions.map((revision) => revision.localSequence)).toEqual([2, 3]);

    const effective = await store.getEffectiveResponses("session-1");
    expect(effective).toEqual([
      {
        questionId: "god-exists",
        answer: { kind: "yes_no", value: "no" },
        localSequence: 3,
      },
    ]);

    const outbox = await store.listOutbox("session-1");
    expect(outbox.map((command) => command.localSequence)).toEqual([1, 2, 3]);
    await store.close();
  });

  it("does not mutate local state when an operation id conflicts", async () => {
    const store = createStore();
    await createActiveSession(store);

    await store.appendResponseRevision({
      revisionId: "revision-1",
      operationId: "operation-response",
      sessionId: "session-1",
      questionId: "god-exists",
      answer: { kind: "yes_no", value: "yes" },
      createdAt: "2026-08-08T00:01:00.000Z",
    });

    await expect(
      store.appendResponseRevision({
        revisionId: "revision-2",
        operationId: "operation-response",
        sessionId: "session-1",
        questionId: "personal-god",
        answer: { kind: "yes_no", value: "no" },
        createdAt: "2026-08-08T00:02:00.000Z",
      }),
    ).rejects.toMatchObject<Partial<LocalStoreError>>({
      code: "OPERATION_ID_CONFLICT",
    });

    const snapshot = await store.getSessionSnapshot("session-1");
    expect(snapshot.session.lastLocalSequence).toBe(2);
    expect(snapshot.revisions).toHaveLength(1);
    expect(snapshot.outbox).toHaveLength(2);
    await store.close();
  });

  it("does not enqueue a command when a revision id conflicts", async () => {
    const store = createStore();
    await createActiveSession(store);

    await store.appendResponseRevision({
      revisionId: "revision-1",
      operationId: "operation-response-1",
      sessionId: "session-1",
      questionId: "god-exists",
      answer: { kind: "yes_no", value: "yes" },
      createdAt: "2026-08-08T00:01:00.000Z",
    });

    await expect(
      store.appendResponseRevision({
        revisionId: "revision-1",
        operationId: "operation-response-2",
        sessionId: "session-1",
        questionId: "god-exists",
        answer: { kind: "yes_no", value: "no" },
        createdAt: "2026-08-08T00:02:00.000Z",
      }),
    ).rejects.toMatchObject<Partial<LocalStoreError>>({
      code: "REVISION_ID_CONFLICT",
    });

    const snapshot = await store.getSessionSnapshot("session-1");
    expect(snapshot.session.lastLocalSequence).toBe(2);
    expect(snapshot.revisions).toHaveLength(1);
    expect(snapshot.outbox.map((command) => command.operationId)).toEqual([
      "operation-start",
      "operation-response-1",
    ]);
    await store.close();
  });

  it("completes locally with a finalize command and blocks further answers", async () => {
    const store = createStore();
    await createActiveSession(store);

    await store.appendResponseRevision({
      revisionId: "revision-1",
      operationId: "operation-response-1",
      sessionId: "session-1",
      questionId: "god-exists",
      answer: { kind: "special", value: "skip" },
      createdAt: "2026-08-08T00:01:00.000Z",
    });

    const completed = await store.completeSessionLocally({
      sessionId: "session-1",
      operationId: "operation-finalize",
      mode: "complete",
      completedAt: "2026-08-08T00:03:00.000Z",
    });

    expect(completed.session).toMatchObject({
      state: "completed_locally",
      finalizeOperationId: "operation-finalize",
      lastLocalSequence: 3,
    });
    expect(completed.command).toMatchObject({
      command: "finalize_interview_session",
      localSequence: 3,
      payload: { mode: "complete" },
    });

    await expect(
      store.completeSessionLocally({
        sessionId: "session-1",
        operationId: "operation-finalize",
        mode: "complete",
        completedAt: "2026-08-08T00:03:00.000Z",
      }),
    ).resolves.toEqual(completed);

    await expect(
      store.appendResponseRevision({
        revisionId: "revision-after-complete",
        operationId: "operation-after-complete",
        sessionId: "session-1",
        questionId: "personal-god",
        answer: { kind: "yes_no", value: "yes" },
        createdAt: "2026-08-08T00:04:00.000Z",
      }),
    ).rejects.toMatchObject<Partial<LocalStoreError>>({
      code: "SESSION_NOT_ACTIVE",
    });

    await store.close();
  });

  it("does not create outbox data for an unknown session", async () => {
    const store = createStore();

    await expect(
      store.appendResponseRevision({
        revisionId: "revision-1",
        operationId: "operation-response-1",
        sessionId: "missing-session",
        questionId: "god-exists",
        answer: { kind: "yes_no", value: "yes" },
        createdAt: "2026-08-08T00:01:00.000Z",
      }),
    ).rejects.toMatchObject<Partial<LocalStoreError>>({
      code: "SESSION_NOT_FOUND",
    });

    await expect(store.listOutbox()).resolves.toEqual([]);
    await store.close();
  });

  it("persists sync metadata alongside the local session snapshot", async () => {
    const store = createStore();
    await createActiveSession(store);

    await store.putSyncMetadata({
      sessionId: "session-1",
      highestAcknowledgedLocalSequence: 1,
      highestServerSequence: 7,
      lastSuccessfulSyncAt: "2026-08-08T00:05:00.000Z",
    });

    const snapshot = await store.getSessionSnapshot("session-1");
    expect(snapshot.syncMetadata).toEqual({
      sessionId: "session-1",
      highestAcknowledgedLocalSequence: 1,
      highestServerSequence: 7,
      lastSuccessfulSyncAt: "2026-08-08T00:05:00.000Z",
    });
    await store.close();
  });
});
