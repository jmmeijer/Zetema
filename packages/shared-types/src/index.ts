import type {
  ContentReleaseId,
  IsoDateTime,
  OperationId,
  QuestionId,
  ResponseRevisionId,
  SessionId,
  StructuredAnswer,
} from "@zetema/domain";

export interface StartInterviewSessionRequest {
  sessionId: SessionId;
  operationId: OperationId;
  contentReleaseId: ContentReleaseId;
  startedAt: IsoDateTime;
}

export interface StartInterviewSessionResult {
  sessionId: SessionId;
  status: "in_progress";
  sessionVersion: number;
  idempotentReplay: boolean;
}

export interface AppendResponseRevisionRequest {
  sessionId: SessionId;
  operationId: OperationId;
  revisionId: ResponseRevisionId;
  questionId: QuestionId;
  answer: StructuredAnswer;
  clientCreatedAt: IsoDateTime;
}

export interface AppendResponseRevisionResult {
  sessionId: SessionId;
  revisionId: ResponseRevisionId;
  serverSequence: number;
  sessionVersion: number;
  idempotentReplay: boolean;
}

export interface FinalizeInterviewSessionRequest {
  sessionId: SessionId;
  operationId: OperationId;
  mode: "complete" | "incomplete";
  completedAt: IsoDateTime;
}

export interface FinalizeInterviewSessionResult {
  sessionId: SessionId;
  status: "completed" | "abandoned";
  sessionVersion: number;
  idempotentReplay: boolean;
}

export type CommandGatewayErrorCode =
  | "UNAUTHENTICATED"
  | "INVALID_ARGUMENT"
  | "SESSION_NOT_FOUND"
  | "SESSION_CONFLICT"
  | "SESSION_NOT_ACTIVE"
  | "OPERATION_ID_CONFLICT"
  | "REVISION_ID_CONFLICT"
  | "PERMISSION_DENIED";
