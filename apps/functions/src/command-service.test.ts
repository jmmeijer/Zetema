import { beforeEach, describe, expect, it } from "vitest";

import type {
  AppendResponseRevisionRequest,
  FinalizeInterviewSessionRequest,
  StartInterviewSessionRequest,
} from "@zetema/shared-types";
import {
  CommandGatewayError,
  CommandGatewayService,
  type CommandStore,
  type CommandTransaction,
  type StoredConsentEvent,
  type StoredEligibilityEvent,
  type StoredOperation,
  type StoredRevision,
  type StoredSession,
} from "./command-service.js";

class InMemoryCommandStore implements CommandStore, CommandTransaction {
  readonly sessions = new Map<string, StoredSession>();
  readonly operations = new Map<string, StoredOperation>();
  readonly revisions = new Map<string, StoredRevision>();
  readonly eligibilityEvents = new Map<string, StoredEligibilityEvent>();
  readonly participationEvents = new Map<string, StoredConsentEvent>();

  transact<T>(work: (transaction: CommandTransaction) => Promise<T>): Promise<T> {
    return work(this);
  }

  getSession(sessionId: string): Promise<StoredSession | undefined> {
    return Promise.resolve(this.sessions.get(sessionId));
  }

  getOperation(sessionId: string, operationId: string): Promise<StoredOperation | undefined> {
    return Promise.resolve(this.operations.get(`${sessionId}:${operationId}`));
  }

  getRevision(sessionId: string, revisionId: string): Promise<StoredRevision | undefined> {
    return Promise.resolve(this.revisions.get(`${sessionId}:${revisionId}`));
  }

  putSession(session: StoredSession): Promise<void> {
    this.sessions.set(session.sessionId, session);
    return Promise.resolve();
  }

  putOperation(sessionId: string, operation: StoredOperation): Promise<void> {
    this.operations.set(`${sessionId}:${operation.operationId}`, operation);
    return Promise.resolve();
  }

  putRevision(revision: StoredRevision): Promise<void> {
    this.revisions.set(`${revision.sessionId}:${revision.revisionId}`, revision);
    return Promise.resolve();
  }

  putEligibilityEvent(sessionId: string, event: StoredEligibilityEvent): Promise<void> {
    this.eligibilityEvents.set(`${sessionId}:${event.eventId}`, event);
    return Promise.resolve();
  }

  putConsentEvent(sessionId: string, event: StoredConsentEvent): Promise<void> {
    this.participationEvents.set(`${sessionId}:${event.eventId}`, event);
    return Promise.resolve();
  }
}

const USER = "participant-1";
const OTHER_USER = "participant-2";
const SERVER_NOW = "2026-08-08T12:00:00.000Z";

function startRequest(overrides: Partial<StartInterviewSessionRequest> = {}): StartInterviewSessionRequest {
  return {
    sessionId: "session-1",
    operationId: "operation-start-1",
    contentReleaseId: "mvp-0.2.beliefs-and-background.v2",
    startedAt: "2026-08-08T11:00:00.000Z",
    eligibility: {
      minimumAge: 18,
      declaration: "age_18_or_over",
      confirmedAt: "2026-08-08T10:58:00.000Z",
    },
    consent: {
      purposeId: "mvp-0.2-interview-participation-v1",
      textVersion: "2026.08.1",
      scopes: ["INTERVIEW_STORAGE"],
      mechanism: "in_app_explicit",
      acceptedAt: "2026-08-08T10:59:00.000Z",
    },
    ...overrides,
  };
}

function appendRequest(
  overrides: Partial<AppendResponseRevisionRequest> = {},
): AppendResponseRevisionRequest {
  return {
    sessionId: "session-1",
    operationId: "operation-response-1",
    revisionId: "revision-1",
    questionId: "god-exists",
    answer: { kind: "yes_no", value: "yes" },
    clientCreatedAt: "2026-08-08T11:01:00.000Z",
    ...overrides,
  };
}

function finalizeRequest(
  overrides: Partial<FinalizeInterviewSessionRequest> = {},
): FinalizeInterviewSessionRequest {
  return {
    sessionId: "session-1",
    operationId: "operation-finalize-1",
    mode: "complete",
    completedAt: "2026-08-08T11:10:00.000Z",
    ...overrides,
  };
}

async function expectGatewayError(
  promise: Promise<unknown>,
  code: CommandGatewayError["code"],
): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}

describe("CommandGatewayService", () => {
  let store: InMemoryCommandStore;
  let service: CommandGatewayService;

  beforeEach(() => {
    store = new InMemoryCommandStore();
    service = new CommandGatewayService(store, () => SERVER_NOW);
  });

  it("starts a new session with versioned eligibility and participation evidence", async () => {
    const result = await service.startInterviewSession(USER, startRequest());

    expect(result).toEqual({
      sessionId: "session-1",
      status: "in_progress",
      sessionVersion: 1,
      idempotentReplay: false,
    });
    expect(store.sessions.get("session-1")).toMatchObject({
      ownerUid: USER,
      status: "in_progress",
      sessionVersion: 1,
      lastServerSequence: 0,
      createdAt: SERVER_NOW,
      eligibilityState: "age_18_or_over",
      consentState: "confirmed",
      consentPurposeId: "mvp-0.2-interview-participation-v1",
      consentTextVersion: "2026.08.1",
    });
    expect(store.eligibilityEvents.get("session-1:operation-start-1")).toMatchObject({
      actorUid: USER,
      minimumAge: 18,
      declaration: "age_18_or_over",
      mechanism: "self_declaration",
      clientConfirmedAt: "2026-08-08T10:58:00.000Z",
      occurredAt: SERVER_NOW,
      schemaVersion: 1,
    });
    expect(store.participationEvents.get("session-1:operation-start-1")).toMatchObject({
      subjectUid: USER,
      purposeId: "mvp-0.2-interview-participation-v1",
      consentTextVersion: "2026.08.1",
      scopes: ["INTERVIEW_STORAGE"],
      previousState: "pending",
      newState: "confirmed",
      occurredAt: SERVER_NOW,
      schemaVersion: 1,
    });
  });

  it("replays an identical start operation without applying it twice", async () => {
    await service.startInterviewSession(USER, startRequest());
    const replay = await service.startInterviewSession(USER, startRequest());

    expect(replay.idempotentReplay).toBe(true);
    expect(replay.sessionVersion).toBe(1);
    expect(store.operations.size).toBe(1);
    expect(store.eligibilityEvents.size).toBe(1);
    expect(store.participationEvents.size).toBe(1);
  });

  it("rejects reuse of a start operation ID with a changed payload", async () => {
    await service.startInterviewSession(USER, startRequest());

    await expectGatewayError(
      service.startInterviewSession(
        USER,
        startRequest({ contentReleaseId: "different-release" }),
      ),
      "OPERATION_ID_CONFLICT",
    );
  });

  it("includes participation evidence in the start-operation fingerprint", async () => {
    await service.startInterviewSession(USER, startRequest());

    await expectGatewayError(
      service.startInterviewSession(
        USER,
        startRequest({
          consent: {
            ...startRequest().consent,
            acceptedAt: "2026-08-08T10:59:30.000Z",
          },
        }),
      ),
      "OPERATION_ID_CONFLICT",
    );
  });

  it("rejects a second start operation for the same session", async () => {
    await service.startInterviewSession(USER, startRequest());

    await expectGatewayError(
      service.startInterviewSession(
        USER,
        startRequest({ operationId: "operation-start-2" }),
      ),
      "SESSION_CONFLICT",
    );
  });

  it("appends revisions with monotonic server sequence and session version", async () => {
    await service.startInterviewSession(USER, startRequest());

    const first = await service.appendResponseRevision(USER, appendRequest());
    const second = await service.appendResponseRevision(
      USER,
      appendRequest({
        operationId: "operation-response-2",
        revisionId: "revision-2",
        questionId: "personal-god",
        answer: { kind: "yes_no", value: "no" },
        clientCreatedAt: "2026-08-08T11:02:00.000Z",
      }),
    );

    expect(first).toMatchObject({ serverSequence: 1, sessionVersion: 2 });
    expect(second).toMatchObject({ serverSequence: 2, sessionVersion: 3 });
    expect(store.sessions.get("session-1")).toMatchObject({
      lastServerSequence: 2,
      sessionVersion: 3,
    });
  });

  it("replays an identical response operation with its original sequence", async () => {
    await service.startInterviewSession(USER, startRequest());
    const first = await service.appendResponseRevision(USER, appendRequest());
    const replay = await service.appendResponseRevision(USER, appendRequest());

    expect(replay).toEqual({ ...first, idempotentReplay: true });
    expect(store.revisions.size).toBe(1);
  });

  it("rejects reuse of a revision ID by another operation", async () => {
    await service.startInterviewSession(USER, startRequest());
    await service.appendResponseRevision(USER, appendRequest());

    await expectGatewayError(
      service.appendResponseRevision(
        USER,
        appendRequest({ operationId: "operation-response-2" }),
      ),
      "REVISION_ID_CONFLICT",
    );
  });

  it("denies commands from a user who does not own the session", async () => {
    await service.startInterviewSession(USER, startRequest());

    await expectGatewayError(
      service.appendResponseRevision(OTHER_USER, appendRequest()),
      "PERMISSION_DENIED",
    );
    await expectGatewayError(
      service.startInterviewSession(OTHER_USER, startRequest()),
      "PERMISSION_DENIED",
    );
  });

  it("rejects new response operations after finalization", async () => {
    await service.startInterviewSession(USER, startRequest());
    await service.finalizeInterviewSession(USER, finalizeRequest());

    await expectGatewayError(
      service.appendResponseRevision(USER, appendRequest()),
      "SESSION_NOT_ACTIVE",
    );
  });

  it("finalizes a completed session and increments its version", async () => {
    await service.startInterviewSession(USER, startRequest());
    await service.appendResponseRevision(USER, appendRequest());

    const result = await service.finalizeInterviewSession(USER, finalizeRequest());

    expect(result).toEqual({
      sessionId: "session-1",
      status: "completed",
      sessionVersion: 3,
      idempotentReplay: false,
    });
    expect(store.sessions.get("session-1")).toMatchObject({
      status: "completed",
      sessionVersion: 3,
      completedAt: "2026-08-08T11:10:00.000Z",
      finalizedAt: SERVER_NOW,
    });
  });

  it("replays the original finalize operation after the session is finalized", async () => {
    await service.startInterviewSession(USER, startRequest());
    const first = await service.finalizeInterviewSession(USER, finalizeRequest());
    const replay = await service.finalizeInterviewSession(USER, finalizeRequest());

    expect(replay).toEqual({ ...first, idempotentReplay: true });
  });

  it("maps incomplete finalization to abandoned without inventing answers", async () => {
    await service.startInterviewSession(USER, startRequest());

    const result = await service.finalizeInterviewSession(
      USER,
      finalizeRequest({ mode: "incomplete" }),
    );

    expect(result.status).toBe("abandoned");
    expect(store.sessions.get("session-1")?.status).toBe("abandoned");
    expect(store.revisions.size).toBe(0);
  });
});
