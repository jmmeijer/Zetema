export type ContentReleaseId = string;
export type ThemeId = string;
export type QuestionId = string;
export type SessionId = string;
export type ResponseRevisionId = string;
export type OperationId = string;
export type IsoDateTime = string;

export type QuestionType = "yes_no" | "single_choice" | "likert";
export type QuestionFlow = "base" | "follow_up";

export type SpecialResponseValue =
  | "unsure"
  | "skip"
  | "prefer_not_to_answer";

export type StructuredAnswer =
  | {
      kind: "yes_no";
      value: "yes" | "no";
    }
  | {
      kind: "single_choice";
      optionId: string;
    }
  | {
      kind: "likert";
      value: number;
    }
  | {
      kind: "special";
      value: SpecialResponseValue;
    };

export type InterviewSessionStatus =
  | "in_progress"
  | "completed"
  | "abandoned";

export interface InterviewSession {
  sessionId: SessionId;
  contentReleaseId: ContentReleaseId;
  status: InterviewSessionStatus;
  sessionVersion: number;
  startedAt: IsoDateTime;
  completedAt?: IsoDateTime;
}

export interface ResponseRevision {
  revisionId: ResponseRevisionId;
  operationId: OperationId;
  sessionId: SessionId;
  questionId: QuestionId;
  answer: StructuredAnswer;
  serverSequence: number;
  createdAt: IsoDateTime;
}
