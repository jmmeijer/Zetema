import type {
  ContentReleaseId,
  IsoDateTime,
  OperationId,
  QuestionExposure,
  QuestionId,
  ResponseRevisionId,
  SessionId,
  StructuredAnswer,
} from "@zetema/domain";

const DATABASE_VERSION = 1;
const DEFAULT_DATABASE_NAME = "zetema-local";

const STORES = {
  contentReleases: "contentReleases",
  localSessions: "localSessions",
  responseRevisions: "responseRevisions",
  questionExposures: "questionExposures",
  outbox: "outbox",
  syncMetadata: "syncMetadata",
} as const;

const INDEXES = {
  bySession: "bySession",
  bySessionSequence: "bySessionSequence",
  byOperationId: "byOperationId",
  byState: "byState",
} as const;

export type LocalSessionState =
  | "active"
  | "completed_locally"
  | "finalizing"
  | "completed"
  | "recovery_pending"
  | "abandoned";

export interface CachedContentReleaseRecord {
  releaseId: ContentReleaseId;
  locale: string;
  cachedAt: IsoDateTime;
  payload: unknown;
}

export interface LocalSessionRecord {
  sessionId: SessionId;
  contentReleaseId: ContentReleaseId;
  state: LocalSessionState;
  startOperationId: OperationId;
  finalizeOperationId?: OperationId;
  startedAt: IsoDateTime;
  completedAt?: IsoDateTime;
  updatedAt: IsoDateTime;
  lastLocalActivityAt: IsoDateTime;
  lastLocalSequence: number;
}

export interface LocalResponseRevision {
  revisionId: ResponseRevisionId;
  operationId: OperationId;
  sessionId: SessionId;
  questionId: QuestionId;
  answer: StructuredAnswer;
  localSequence: number;
  createdAt: IsoDateTime;
  serverSequence?: number;
  serverCreatedAt?: IsoDateTime;
}

export interface StoredQuestionExposure {
  key: string;
  sessionId: SessionId;
  questionId: QuestionId;
  exposure: QuestionExposure;
  recordedAt: IsoDateTime;
}

export type OutboxState = "pending" | "in_flight" | "failed";

interface OutboxBase {
  operationId: OperationId;
  sessionId: SessionId;
  localSequence: number;
  state: OutboxState;
  attemptCount: number;
  createdAt: IsoDateTime;
  lastAttemptAt?: IsoDateTime;
  lastErrorCode?: string;
}

export interface StartInterviewSessionOutboxCommand extends OutboxBase {
  command: "start_interview_session";
  payload: {
    contentReleaseId: ContentReleaseId;
    startedAt: IsoDateTime;
  };
}

export interface AppendResponseRevisionOutboxCommand extends OutboxBase {
  command: "append_response_revision";
  payload: {
    revisionId: ResponseRevisionId;
    questionId: QuestionId;
    answer: StructuredAnswer;
    clientCreatedAt: IsoDateTime;
  };
}

export interface FinalizeInterviewSessionOutboxCommand extends OutboxBase {
  command: "finalize_interview_session";
  payload: {
    mode: "complete" | "incomplete";
    completedAt: IsoDateTime;
  };
}

export type OutboxCommand =
  | StartInterviewSessionOutboxCommand
  | AppendResponseRevisionOutboxCommand
  | FinalizeInterviewSessionOutboxCommand;

export interface SyncMetadataRecord {
  sessionId: SessionId;
  highestAcknowledgedLocalSequence: number;
  highestServerSequence?: number;
  lastSuccessfulSyncAt?: IsoDateTime;
}

export interface EffectiveLocalResponse {
  questionId: QuestionId;
  answer: StructuredAnswer;
  localSequence: number;
}

export interface LocalSessionSnapshot {
  session: LocalSessionRecord;
  revisions: readonly LocalResponseRevision[];
  exposures: readonly StoredQuestionExposure[];
  outbox: readonly OutboxCommand[];
  syncMetadata: SyncMetadataRecord | undefined;
}

export type LocalStoreErrorCode =
  | "INDEXEDDB_UNAVAILABLE"
  | "SESSION_ALREADY_EXISTS"
  | "SESSION_NOT_FOUND"
  | "SESSION_NOT_ACTIVE"
  | "OPERATION_ID_CONFLICT"
  | "REVISION_ID_CONFLICT"
  | "EXPOSURE_CONFLICT"
  | "CONTENT_RELEASE_CONFLICT";

export class LocalStoreError extends Error {
  readonly code: LocalStoreErrorCode;

  constructor(code: LocalStoreErrorCode, message: string) {
    super(message);
    this.name = "LocalStoreError";
    this.code = code;
  }
}

export interface IndexedDbLocalStoreOptions {
  databaseName?: string;
  indexedDB?: IDBFactory;
  keyRange?: typeof IDBKeyRange;
}

export interface CreateLocalSessionInput {
  sessionId: SessionId;
  contentReleaseId: ContentReleaseId;
  operationId: OperationId;
  startedAt: IsoDateTime;
}

export interface AppendLocalResponseInput {
  revisionId: ResponseRevisionId;
  operationId: OperationId;
  sessionId: SessionId;
  questionId: QuestionId;
  answer: StructuredAnswer;
  createdAt: IsoDateTime;
}

export interface RecordQuestionExposureInput {
  sessionId: SessionId;
  exposure: QuestionExposure;
  recordedAt: IsoDateTime;
}

export interface CompleteLocalSessionInput {
  sessionId: SessionId;
  operationId: OperationId;
  mode: "complete" | "incomplete";
  completedAt: IsoDateTime;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
  });
}

function answersEqual(left: StructuredAnswer, right: StructuredAnswer): boolean {
  if (left.kind !== right.kind) {
    return false;
  }

  switch (left.kind) {
    case "yes_no":
      return right.kind === "yes_no" && left.value === right.value;
    case "single_choice":
      return right.kind === "single_choice" && left.optionId === right.optionId;
    case "likert":
      return right.kind === "likert" && left.value === right.value;
    case "special":
      return right.kind === "special" && left.value === right.value;
  }
}

function exposuresEqual(left: QuestionExposure, right: QuestionExposure): boolean {
  if (left.questionId !== right.questionId || left.outcome !== right.outcome) {
    return false;
  }

  if (left.reason.kind !== right.reason.kind) {
    return false;
  }

  if (left.reason.kind === "follow_up_rule") {
    return (
      right.reason.kind === "follow_up_rule" &&
      left.reason.ruleId === right.reason.ruleId &&
      left.reason.sourceQuestionId === right.reason.sourceQuestionId
    );
  }

  return true;
}

function questionExposureKey(sessionId: SessionId, questionId: QuestionId): string {
  return `${sessionId}\u0000${questionId}`;
}

function assertActiveSession(session: LocalSessionRecord): void {
  if (session.state !== "active") {
    throw new LocalStoreError(
      "SESSION_NOT_ACTIVE",
      `Session '${session.sessionId}' is '${session.state}' and cannot accept new interview events.`,
    );
  }
}

export class IndexedDbLocalStore {
  readonly databaseName: string;

  private readonly factory: IDBFactory;
  private readonly keyRange: typeof IDBKeyRange;
  private databasePromise: Promise<IDBDatabase> | undefined;

  constructor(options: IndexedDbLocalStoreOptions = {}) {
    const factory = options.indexedDB ?? globalThis.indexedDB;
    const keyRange = options.keyRange ?? globalThis.IDBKeyRange;

    if (factory === undefined || keyRange === undefined) {
      throw new LocalStoreError(
        "INDEXEDDB_UNAVAILABLE",
        "IndexedDB is unavailable in this environment.",
      );
    }

    this.databaseName = options.databaseName ?? DEFAULT_DATABASE_NAME;
    this.factory = factory;
    this.keyRange = keyRange;
  }

  async close(): Promise<void> {
    if (this.databasePromise === undefined) {
      return;
    }

    const database = await this.databasePromise;
    database.close();
    this.databasePromise = undefined;
  }

  async cacheContentRelease(record: CachedContentReleaseRecord): Promise<CachedContentReleaseRecord> {
    const database = await this.openDatabase();
    const transaction = database.transaction(STORES.contentReleases, "readwrite");
    const done = transactionToPromise(transaction);
    const store = transaction.objectStore(STORES.contentReleases);
    const existing = await requestToPromise(
      store.get(record.releaseId) as IDBRequest<CachedContentReleaseRecord | undefined>,
    );

    if (existing !== undefined) {
      const sameRecord =
        existing.locale === record.locale &&
        JSON.stringify(existing.payload) === JSON.stringify(record.payload);

      if (!sameRecord) {
        throw new LocalStoreError(
          "CONTENT_RELEASE_CONFLICT",
          `Content release '${record.releaseId}' is already cached with different content.`,
        );
      }

      return existing;
    }

    await requestToPromise(store.add(record));
    await done;
    return record;
  }

  async getCachedContentRelease(
    releaseId: ContentReleaseId,
  ): Promise<CachedContentReleaseRecord | undefined> {
    const database = await this.openDatabase();
    const transaction = database.transaction(STORES.contentReleases, "readonly");
    const store = transaction.objectStore(STORES.contentReleases);
    return requestToPromise(
      store.get(releaseId) as IDBRequest<CachedContentReleaseRecord | undefined>,
    );
  }

  async createSession(
    input: CreateLocalSessionInput,
  ): Promise<{ session: LocalSessionRecord; command: StartInterviewSessionOutboxCommand }> {
    const database = await this.openDatabase();
    const transaction = database.transaction(
      [STORES.localSessions, STORES.outbox],
      "readwrite",
    );
    const done = transactionToPromise(transaction);
    const sessionStore = transaction.objectStore(STORES.localSessions);
    const outboxStore = transaction.objectStore(STORES.outbox);
    const existing = await requestToPromise(
      sessionStore.get(input.sessionId) as IDBRequest<LocalSessionRecord | undefined>,
    );

    if (existing !== undefined) {
      if (
        existing.startOperationId === input.operationId &&
        existing.contentReleaseId === input.contentReleaseId &&
        existing.startedAt === input.startedAt
      ) {
        const existingCommand = await requestToPromise(
          outboxStore.get(input.operationId) as IDBRequest<OutboxCommand | undefined>,
        );

        if (existingCommand?.command === "start_interview_session") {
          return { session: existing, command: existingCommand };
        }
      }

      throw new LocalStoreError(
        "SESSION_ALREADY_EXISTS",
        `Session '${input.sessionId}' already exists.`,
      );
    }

    const existingOperation = await requestToPromise(
      outboxStore.get(input.operationId) as IDBRequest<OutboxCommand | undefined>,
    );

    if (existingOperation !== undefined) {
      throw new LocalStoreError(
        "OPERATION_ID_CONFLICT",
        `Operation '${input.operationId}' is already used by another local command.`,
      );
    }

    const session: LocalSessionRecord = {
      sessionId: input.sessionId,
      contentReleaseId: input.contentReleaseId,
      state: "active",
      startOperationId: input.operationId,
      startedAt: input.startedAt,
      updatedAt: input.startedAt,
      lastLocalActivityAt: input.startedAt,
      lastLocalSequence: 1,
    };

    const command: StartInterviewSessionOutboxCommand = {
      operationId: input.operationId,
      sessionId: input.sessionId,
      localSequence: 1,
      state: "pending",
      attemptCount: 0,
      createdAt: input.startedAt,
      command: "start_interview_session",
      payload: {
        contentReleaseId: input.contentReleaseId,
        startedAt: input.startedAt,
      },
    };

    await requestToPromise(sessionStore.add(session));
    await requestToPromise(outboxStore.add(command));
    await done;

    return { session, command };
  }

  async getSession(sessionId: SessionId): Promise<LocalSessionRecord | undefined> {
    const database = await this.openDatabase();
    const transaction = database.transaction(STORES.localSessions, "readonly");
    const store = transaction.objectStore(STORES.localSessions);
    return requestToPromise(
      store.get(sessionId) as IDBRequest<LocalSessionRecord | undefined>,
    );
  }

  async recordQuestionExposure(
    input: RecordQuestionExposureInput,
  ): Promise<StoredQuestionExposure> {
    const database = await this.openDatabase();
    const transaction = database.transaction(
      [STORES.localSessions, STORES.questionExposures],
      "readwrite",
    );
    const done = transactionToPromise(transaction);
    const sessionStore = transaction.objectStore(STORES.localSessions);
    const exposureStore = transaction.objectStore(STORES.questionExposures);
    const session = await requestToPromise(
      sessionStore.get(input.sessionId) as IDBRequest<LocalSessionRecord | undefined>,
    );

    if (session === undefined) {
      throw new LocalStoreError(
        "SESSION_NOT_FOUND",
        `Session '${input.sessionId}' does not exist.`,
      );
    }

    assertActiveSession(session);

    const key = questionExposureKey(input.sessionId, input.exposure.questionId);
    const existing = await requestToPromise(
      exposureStore.get(key) as IDBRequest<StoredQuestionExposure | undefined>,
    );

    if (existing !== undefined) {
      if (exposuresEqual(existing.exposure, input.exposure)) {
        return existing;
      }

      throw new LocalStoreError(
        "EXPOSURE_CONFLICT",
        `Question '${input.exposure.questionId}' already has a different exposure outcome for session '${input.sessionId}'.`,
      );
    }

    const record: StoredQuestionExposure = {
      key,
      sessionId: input.sessionId,
      questionId: input.exposure.questionId,
      exposure: input.exposure,
      recordedAt: input.recordedAt,
    };

    const updatedSession: LocalSessionRecord = {
      ...session,
      updatedAt: input.recordedAt,
      lastLocalActivityAt: input.recordedAt,
    };

    await requestToPromise(exposureStore.add(record));
    await requestToPromise(sessionStore.put(updatedSession));
    await done;

    return record;
  }

  async appendResponseRevision(
    input: AppendLocalResponseInput,
  ): Promise<{ revision: LocalResponseRevision; command: AppendResponseRevisionOutboxCommand }> {
    const database = await this.openDatabase();
    const transaction = database.transaction(
      [STORES.localSessions, STORES.responseRevisions, STORES.outbox],
      "readwrite",
    );
    const done = transactionToPromise(transaction);
    const sessionStore = transaction.objectStore(STORES.localSessions);
    const revisionStore = transaction.objectStore(STORES.responseRevisions);
    const outboxStore = transaction.objectStore(STORES.outbox);
    const session = await requestToPromise(
      sessionStore.get(input.sessionId) as IDBRequest<LocalSessionRecord | undefined>,
    );

    if (session === undefined) {
      throw new LocalStoreError(
        "SESSION_NOT_FOUND",
        `Session '${input.sessionId}' does not exist.`,
      );
    }

    assertActiveSession(session);

    const existingOperation = await requestToPromise(
      outboxStore.get(input.operationId) as IDBRequest<OutboxCommand | undefined>,
    );

    if (existingOperation !== undefined) {
      if (
        existingOperation.command === "append_response_revision" &&
        existingOperation.sessionId === input.sessionId &&
        existingOperation.payload.revisionId === input.revisionId &&
        existingOperation.payload.questionId === input.questionId &&
        existingOperation.payload.clientCreatedAt === input.createdAt &&
        answersEqual(existingOperation.payload.answer, input.answer)
      ) {
        const existingRevision = await requestToPromise(
          revisionStore.get(input.revisionId) as IDBRequest<LocalResponseRevision | undefined>,
        );

        if (existingRevision !== undefined) {
          return { revision: existingRevision, command: existingOperation };
        }
      }

      throw new LocalStoreError(
        "OPERATION_ID_CONFLICT",
        `Operation '${input.operationId}' is already used by a different local command.`,
      );
    }

    const existingRevision = await requestToPromise(
      revisionStore.get(input.revisionId) as IDBRequest<LocalResponseRevision | undefined>,
    );

    if (existingRevision !== undefined) {
      throw new LocalStoreError(
        "REVISION_ID_CONFLICT",
        `Revision '${input.revisionId}' already exists.`,
      );
    }

    const localSequence = session.lastLocalSequence + 1;
    const revision: LocalResponseRevision = {
      revisionId: input.revisionId,
      operationId: input.operationId,
      sessionId: input.sessionId,
      questionId: input.questionId,
      answer: input.answer,
      localSequence,
      createdAt: input.createdAt,
    };

    const command: AppendResponseRevisionOutboxCommand = {
      operationId: input.operationId,
      sessionId: input.sessionId,
      localSequence,
      state: "pending",
      attemptCount: 0,
      createdAt: input.createdAt,
      command: "append_response_revision",
      payload: {
        revisionId: input.revisionId,
        questionId: input.questionId,
        answer: input.answer,
        clientCreatedAt: input.createdAt,
      },
    };

    const updatedSession: LocalSessionRecord = {
      ...session,
      updatedAt: input.createdAt,
      lastLocalActivityAt: input.createdAt,
      lastLocalSequence: localSequence,
    };

    await requestToPromise(revisionStore.add(revision));
    await requestToPromise(outboxStore.add(command));
    await requestToPromise(sessionStore.put(updatedSession));
    await done;

    return { revision, command };
  }

  async completeSessionLocally(
    input: CompleteLocalSessionInput,
  ): Promise<{ session: LocalSessionRecord; command: FinalizeInterviewSessionOutboxCommand }> {
    const database = await this.openDatabase();
    const transaction = database.transaction(
      [STORES.localSessions, STORES.outbox],
      "readwrite",
    );
    const done = transactionToPromise(transaction);
    const sessionStore = transaction.objectStore(STORES.localSessions);
    const outboxStore = transaction.objectStore(STORES.outbox);
    const session = await requestToPromise(
      sessionStore.get(input.sessionId) as IDBRequest<LocalSessionRecord | undefined>,
    );

    if (session === undefined) {
      throw new LocalStoreError(
        "SESSION_NOT_FOUND",
        `Session '${input.sessionId}' does not exist.`,
      );
    }

    if (
      session.state === "completed_locally" &&
      session.finalizeOperationId === input.operationId &&
      session.completedAt === input.completedAt
    ) {
      const existingCommand = await requestToPromise(
        outboxStore.get(input.operationId) as IDBRequest<OutboxCommand | undefined>,
      );

      if (
        existingCommand?.command === "finalize_interview_session" &&
        existingCommand.payload.mode === input.mode
      ) {
        return { session, command: existingCommand };
      }
    }

    assertActiveSession(session);

    const existingOperation = await requestToPromise(
      outboxStore.get(input.operationId) as IDBRequest<OutboxCommand | undefined>,
    );

    if (existingOperation !== undefined) {
      throw new LocalStoreError(
        "OPERATION_ID_CONFLICT",
        `Operation '${input.operationId}' is already used by another local command.`,
      );
    }

    const localSequence = session.lastLocalSequence + 1;
    const updatedSession: LocalSessionRecord = {
      ...session,
      state: "completed_locally",
      finalizeOperationId: input.operationId,
      completedAt: input.completedAt,
      updatedAt: input.completedAt,
      lastLocalActivityAt: input.completedAt,
      lastLocalSequence: localSequence,
    };

    const command: FinalizeInterviewSessionOutboxCommand = {
      operationId: input.operationId,
      sessionId: input.sessionId,
      localSequence,
      state: "pending",
      attemptCount: 0,
      createdAt: input.completedAt,
      command: "finalize_interview_session",
      payload: {
        mode: input.mode,
        completedAt: input.completedAt,
      },
    };

    await requestToPromise(outboxStore.add(command));
    await requestToPromise(sessionStore.put(updatedSession));
    await done;

    return { session: updatedSession, command };
  }

  async listResponseRevisions(sessionId: SessionId): Promise<readonly LocalResponseRevision[]> {
    const database = await this.openDatabase();
    const transaction = database.transaction(STORES.responseRevisions, "readonly");
    const index = transaction
      .objectStore(STORES.responseRevisions)
      .index(INDEXES.bySessionSequence);
    const range = this.keyRange.bound(
      [sessionId, Number.MIN_SAFE_INTEGER],
      [sessionId, Number.MAX_SAFE_INTEGER],
    );
    const revisions = await requestToPromise(
      index.getAll(range) as IDBRequest<LocalResponseRevision[]>,
    );
    return revisions.sort((left, right) => left.localSequence - right.localSequence);
  }

  async getEffectiveResponses(sessionId: SessionId): Promise<readonly EffectiveLocalResponse[]> {
    const revisions = await this.listResponseRevisions(sessionId);
    const effective = new Map<QuestionId, EffectiveLocalResponse>();

    for (const revision of revisions) {
      effective.set(revision.questionId, {
        questionId: revision.questionId,
        answer: revision.answer,
        localSequence: revision.localSequence,
      });
    }

    return [...effective.values()];
  }

  async listQuestionExposures(sessionId: SessionId): Promise<readonly StoredQuestionExposure[]> {
    const database = await this.openDatabase();
    const transaction = database.transaction(STORES.questionExposures, "readonly");
    const index = transaction.objectStore(STORES.questionExposures).index(INDEXES.bySession);
    const exposures = await requestToPromise(
      index.getAll(sessionId) as IDBRequest<StoredQuestionExposure[]>,
    );
    return exposures.sort((left, right) => left.recordedAt.localeCompare(right.recordedAt));
  }

  async listOutbox(sessionId?: SessionId): Promise<readonly OutboxCommand[]> {
    const database = await this.openDatabase();
    const transaction = database.transaction(STORES.outbox, "readonly");
    const store = transaction.objectStore(STORES.outbox);

    if (sessionId === undefined) {
      const commands = await requestToPromise(store.getAll() as IDBRequest<OutboxCommand[]>);
      return commands.sort((left, right) => {
        if (left.sessionId === right.sessionId) {
          return left.localSequence - right.localSequence;
        }
        return left.sessionId.localeCompare(right.sessionId);
      });
    }

    const index = store.index(INDEXES.bySessionSequence);
    const range = this.keyRange.bound(
      [sessionId, Number.MIN_SAFE_INTEGER],
      [sessionId, Number.MAX_SAFE_INTEGER],
    );
    const commands = await requestToPromise(index.getAll(range) as IDBRequest<OutboxCommand[]>);
    return commands.sort((left, right) => left.localSequence - right.localSequence);
  }

  async putSyncMetadata(metadata: SyncMetadataRecord): Promise<void> {
    const database = await this.openDatabase();
    const transaction = database.transaction(STORES.syncMetadata, "readwrite");
    const done = transactionToPromise(transaction);
    await requestToPromise(transaction.objectStore(STORES.syncMetadata).put(metadata));
    await done;
  }

  async getSyncMetadata(sessionId: SessionId): Promise<SyncMetadataRecord | undefined> {
    const database = await this.openDatabase();
    const transaction = database.transaction(STORES.syncMetadata, "readonly");
    return requestToPromise(
      transaction.objectStore(STORES.syncMetadata).get(sessionId) as IDBRequest<
        SyncMetadataRecord | undefined
      >,
    );
  }

  async getSessionSnapshot(sessionId: SessionId): Promise<LocalSessionSnapshot> {
    const session = await this.getSession(sessionId);

    if (session === undefined) {
      throw new LocalStoreError(
        "SESSION_NOT_FOUND",
        `Session '${sessionId}' does not exist.`,
      );
    }

    const [revisions, exposures, outbox, syncMetadata] = await Promise.all([
      this.listResponseRevisions(sessionId),
      this.listQuestionExposures(sessionId),
      this.listOutbox(sessionId),
      this.getSyncMetadata(sessionId),
    ]);

    return {
      session,
      revisions,
      exposures,
      outbox,
      syncMetadata,
    };
  }

  private openDatabase(): Promise<IDBDatabase> {
    if (this.databasePromise !== undefined) {
      return this.databasePromise;
    }

    this.databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory.open(this.databaseName, DATABASE_VERSION);

      request.onupgradeneeded = () => {
        const database = request.result;

        if (!database.objectStoreNames.contains(STORES.contentReleases)) {
          database.createObjectStore(STORES.contentReleases, { keyPath: "releaseId" });
        }

        if (!database.objectStoreNames.contains(STORES.localSessions)) {
          database.createObjectStore(STORES.localSessions, { keyPath: "sessionId" });
        }

        if (!database.objectStoreNames.contains(STORES.responseRevisions)) {
          const store = database.createObjectStore(STORES.responseRevisions, {
            keyPath: "revisionId",
          });
          store.createIndex(
            INDEXES.bySessionSequence,
            ["sessionId", "localSequence"],
            { unique: true },
          );
          store.createIndex(INDEXES.byOperationId, "operationId", { unique: true });
        }

        if (!database.objectStoreNames.contains(STORES.questionExposures)) {
          const store = database.createObjectStore(STORES.questionExposures, {
            keyPath: "key",
          });
          store.createIndex(INDEXES.bySession, "sessionId", { unique: false });
        }

        if (!database.objectStoreNames.contains(STORES.outbox)) {
          const store = database.createObjectStore(STORES.outbox, {
            keyPath: "operationId",
          });
          store.createIndex(
            INDEXES.bySessionSequence,
            ["sessionId", "localSequence"],
            { unique: true },
          );
          store.createIndex(INDEXES.byState, "state", { unique: false });
        }

        if (!database.objectStoreNames.contains(STORES.syncMetadata)) {
          database.createObjectStore(STORES.syncMetadata, { keyPath: "sessionId" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Unable to open IndexedDB."));
      request.onblocked = () =>
        reject(new Error(`Opening IndexedDB database '${this.databaseName}' was blocked.`));
    });

    return this.databasePromise;
  }
}
