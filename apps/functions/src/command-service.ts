import type {
  ContentReleaseId,
  IsoDateTime,
  OperationId,
  QuestionId,
  ResponseRevisionId,
  SessionId,
  StructuredAnswer,
} from "@zetema/domain";
import type {
  AppendResponseRevisionRequest,
  AppendResponseRevisionResult,
  CommandGatewayErrorCode,
  FinalizeInterviewSessionRequest,
  FinalizeInterviewSessionResult,
  StartInterviewSessionRequest,
  StartInterviewSessionResult,
} from "@zetema/shared-types";

export type StoredSessionStatus = "in_progress" | "completed" | "abandoned";

export interface StoredSession {
  sessionId: SessionId;
  ownerUid: string;
  contentReleaseId: ContentReleaseId;
  status: StoredSessionStatus;
  sessionVersion: number;
  lastServerSequence: number;
  startedAt: IsoDateTime;
  createdAt: IsoDateTime;
  completedAt?: IsoDateTime;
  finalizedAt?: IsoDateTime;
}

export type StoredCommandResult =
  | StartInterviewSessionResult
  | AppendResponseRevisionResult
  | FinalizeInterviewSessionResult;

export interface StoredOperation {
  operationId: OperationId;
  kind: "start" | "append_response" | "finalize";
  fingerprint: string;
  result: StoredCommandResult;
  appliedAt: IsoDateTime;
}

export interface StoredRevision {
  revisionId: ResponseRevisionId;
  operationId: OperationId;
  sessionId: SessionId;
  questionId: QuestionId;
  answer: StructuredAnswer;
  serverSequence: number;
  clientCreatedAt: IsoDateTime;
  createdAt: IsoDateTime;
}

export interface CommandTransaction {
  getSession(sessionId: SessionId): Promise<StoredSession | undefined>;
  getOperation(
    sessionId: SessionId,
    operationId: OperationId,
  ): Promise<StoredOperation | undefined>;
  getRevision(
    sessionId: SessionId,
    revisionId: ResponseRevisionId,
  ): Promise<StoredRevision | undefined>;
  putSession(session: StoredSession): Promise<void>;
  putOperation(sessionId: SessionId, operation: StoredOperation): Promise<void>;
  putRevision(revision: StoredRevision): Promise<void>;
}

export interface CommandStore {
  transact<T>(work: (transaction: CommandTransaction) => Promise<T>): Promise<T>;
}

export class CommandGatewayError extends Error {
  readonly code: CommandGatewayErrorCode;

  constructor(code: CommandGatewayErrorCode, message: string) {
    super(message);
    this.name = "CommandGatewayError";
    this.code = code;
  }
}

function answerFingerprint(answer: StructuredAnswer): readonly unknown[] {
  switch (answer.kind) {
    case "yes_no":
      return [answer.kind, answer.value];
    case "single_choice":
      return [answer.kind, answer.optionId];
    case "likert":
      return [answer.kind, answer.value];
    case "special":
      return [answer.kind, answer.value];
  }
}

function startFingerprint(request: StartInterviewSessionRequest): string {
  return JSON.stringify([
    "start",
    request.sessionId,
    request.contentReleaseId,
    request.startedAt,
  ]);
}

function appendFingerprint(request: AppendResponseRevisionRequest): string {
  return JSON.stringify([
    "append_response",
    request.sessionId,
    request.revisionId,
    request.questionId,
    answerFingerprint(request.answer),
    request.clientCreatedAt,
  ]);
}

function finalizeFingerprint(request: FinalizeInterviewSessionRequest): string {
  return JSON.stringify([
    "finalize",
    request.sessionId,
    request.mode,
    request.completedAt,
  ]);
}

function assertOwner(session: StoredSession, uid: string): void {
  if (session.ownerUid !== uid) {
    throw new CommandGatewayError(
      "PERMISSION_DENIED",
      "The authenticated user does not own this interview session.",
    );
  }
}

function assertOperationReplay(
  operation: StoredOperation,
  expectedKind: StoredOperation["kind"],
  fingerprint: string,
): void {
  if (operation.kind !== expectedKind || operation.fingerprint !== fingerprint) {
    throw new CommandGatewayError(
      "OPERATION_ID_CONFLICT",
      "The operation ID has already been used for a different command payload.",
    );
  }
}

function replayStart(operation: StoredOperation): StartInterviewSessionResult {
  if (operation.kind !== "start") {
    throw new CommandGatewayError(
      "OPERATION_ID_CONFLICT",
      "The operation ID belongs to a different command type.",
    );
  }
  const result = operation.result as StartInterviewSessionResult;
  return { ...result, idempotentReplay: true };
}

function replayAppend(operation: StoredOperation): AppendResponseRevisionResult {
  if (operation.kind !== "append_response") {
    throw new CommandGatewayError(
      "OPERATION_ID_CONFLICT",
      "The operation ID belongs to a different command type.",
    );
  }
  const result = operation.result as AppendResponseRevisionResult;
  return { ...result, idempotentReplay: true };
}

function replayFinalize(operation: StoredOperation): FinalizeInterviewSessionResult {
  if (operation.kind !== "finalize") {
    throw new CommandGatewayError(
      "OPERATION_ID_CONFLICT",
      "The operation ID belongs to a different command type.",
    );
  }
  const result = operation.result as FinalizeInterviewSessionResult;
  return { ...result, idempotentReplay: true };
}

export class CommandGatewayService {
  private readonly store: CommandStore;
  private readonly clock: () => IsoDateTime;

  constructor(store: CommandStore, clock: () => IsoDateTime = () => new Date().toISOString()) {
    this.store = store;
    this.clock = clock;
  }

  async startInterviewSession(
    uid: string,
    request: StartInterviewSessionRequest,
  ): Promise<StartInterviewSessionResult> {
    const serverNow = this.clock();
    const fingerprint = startFingerprint(request);

    return this.store.transact(async (transaction) => {
      const [operation, session] = await Promise.all([
        transaction.getOperation(request.sessionId, request.operationId),
        transaction.getSession(request.sessionId),
      ]);

      if (session !== undefined) {
        assertOwner(session, uid);
      }

      if (operation !== undefined) {
        assertOperationReplay(operation, "start", fingerprint);
        if (session === undefined) {
          throw new CommandGatewayError(
            "SESSION_CONFLICT",
            "A start operation exists without its interview session.",
          );
        }
        return replayStart(operation);
      }

      if (session !== undefined) {
        throw new CommandGatewayError(
          "SESSION_CONFLICT",
          "The interview session already exists under a different start operation.",
        );
      }

      const result: StartInterviewSessionResult = {
        sessionId: request.sessionId,
        status: "in_progress",
        sessionVersion: 1,
        idempotentReplay: false,
      };

      const storedSession: StoredSession = {
        sessionId: request.sessionId,
        ownerUid: uid,
        contentReleaseId: request.contentReleaseId,
        status: "in_progress",
        sessionVersion: 1,
        lastServerSequence: 0,
        startedAt: request.startedAt,
        createdAt: serverNow,
      };

      const storedOperation: StoredOperation = {
        operationId: request.operationId,
        kind: "start",
        fingerprint,
        result,
        appliedAt: serverNow,
      };

      await transaction.putSession(storedSession);
      await transaction.putOperation(request.sessionId, storedOperation);

      return result;
    });
  }

  async appendResponseRevision(
    uid: string,
    request: AppendResponseRevisionRequest,
  ): Promise<AppendResponseRevisionResult> {
    const serverNow = this.clock();
    const fingerprint = appendFingerprint(request);

    return this.store.transact(async (transaction) => {
      const [operation, session, revision] = await Promise.all([
        transaction.getOperation(request.sessionId, request.operationId),
        transaction.getSession(request.sessionId),
        transaction.getRevision(request.sessionId, request.revisionId),
      ]);

      if (session === undefined) {
        throw new CommandGatewayError(
          "SESSION_NOT_FOUND",
          "The interview session does not exist.",
        );
      }
      assertOwner(session, uid);

      if (operation !== undefined) {
        assertOperationReplay(operation, "append_response", fingerprint);
        return replayAppend(operation);
      }

      if (session.status !== "in_progress") {
        throw new CommandGatewayError(
          "SESSION_NOT_ACTIVE",
          "Responses cannot be appended after the interview session is finalized.",
        );
      }

      if (revision !== undefined) {
        throw new CommandGatewayError(
          "REVISION_ID_CONFLICT",
          "The revision ID has already been used by another operation.",
        );
      }

      const serverSequence = session.lastServerSequence + 1;
      const sessionVersion = session.sessionVersion + 1;
      const result: AppendResponseRevisionResult = {
        sessionId: request.sessionId,
        revisionId: request.revisionId,
        serverSequence,
        sessionVersion,
        idempotentReplay: false,
      };

      const storedRevision: StoredRevision = {
        revisionId: request.revisionId,
        operationId: request.operationId,
        sessionId: request.sessionId,
        questionId: request.questionId,
        answer: request.answer,
        serverSequence,
        clientCreatedAt: request.clientCreatedAt,
        createdAt: serverNow,
      };

      const updatedSession: StoredSession = {
        ...session,
        sessionVersion,
        lastServerSequence: serverSequence,
      };

      const storedOperation: StoredOperation = {
        operationId: request.operationId,
        kind: "append_response",
        fingerprint,
        result,
        appliedAt: serverNow,
      };

      await transaction.putRevision(storedRevision);
      await transaction.putSession(updatedSession);
      await transaction.putOperation(request.sessionId, storedOperation);

      return result;
    });
  }

  async finalizeInterviewSession(
    uid: string,
    request: FinalizeInterviewSessionRequest,
  ): Promise<FinalizeInterviewSessionResult> {
    const serverNow = this.clock();
    const fingerprint = finalizeFingerprint(request);

    return this.store.transact(async (transaction) => {
      const [operation, session] = await Promise.all([
        transaction.getOperation(request.sessionId, request.operationId),
        transaction.getSession(request.sessionId),
      ]);

      if (session === undefined) {
        throw new CommandGatewayError(
          "SESSION_NOT_FOUND",
          "The interview session does not exist.",
        );
      }
      assertOwner(session, uid);

      if (operation !== undefined) {
        assertOperationReplay(operation, "finalize", fingerprint);
        return replayFinalize(operation);
      }

      if (session.status !== "in_progress") {
        throw new CommandGatewayError(
          "SESSION_NOT_ACTIVE",
          "The interview session has already been finalized.",
        );
      }

      const status = request.mode === "complete" ? "completed" : "abandoned";
      const sessionVersion = session.sessionVersion + 1;
      const result: FinalizeInterviewSessionResult = {
        sessionId: request.sessionId,
        status,
        sessionVersion,
        idempotentReplay: false,
      };

      const updatedSession: StoredSession = {
        ...session,
        status,
        sessionVersion,
        completedAt: request.completedAt,
        finalizedAt: serverNow,
      };

      const storedOperation: StoredOperation = {
        operationId: request.operationId,
        kind: "finalize",
        fingerprint,
        result,
        appliedAt: serverNow,
      };

      await transaction.putSession(updatedSession);
      await transaction.putOperation(request.sessionId, storedOperation);

      return result;
    });
  }
}
