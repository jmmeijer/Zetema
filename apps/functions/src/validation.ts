import type {
  AdultEligibilityDeclaration,
  ParticipationConsentAcceptance,
  StructuredAnswer,
} from "@zetema/domain";
import type {
  AppendResponseRevisionRequest,
  FinalizeInterviewSessionRequest,
  StartInterviewSessionRequest,
} from "@zetema/shared-types";

import { CommandGatewayError } from "./command-service.js";

const PARTICIPATION_PURPOSE_ID = "mvp-0.2-interview-participation-v1";
const PARTICIPANT_NOTICE_VERSION = "2026.08.1";
const PARTICIPATION_SCOPE = "INTERVIEW_STORAGE";

function invalid(message: string): never {
  throw new CommandGatewayError("INVALID_ARGUMENT", message);
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(`${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function boundedString(
  value: unknown,
  field: string,
  maxLength: number,
  options: { forbidSlash?: boolean } = {},
): string {
  if (typeof value !== "string") {
    invalid(`${field} must be a string.`);
  }
  if (value.length === 0 || value.length > maxLength || value.trim() !== value) {
    invalid(`${field} must be a non-empty canonical string of at most ${maxLength} characters.`);
  }
  if (options.forbidSlash === true && value.includes("/")) {
    invalid(`${field} must not contain '/'.`);
  }
  return value;
}

function documentId(value: unknown, field: string): string {
  return boundedString(value, field, 128, { forbidSlash: true });
}

function semanticId(value: unknown, field: string): string {
  return boundedString(value, field, 200);
}

function isoDateTime(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length > 64) {
    invalid(`${field} must be an ISO date-time string.`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    invalid(`${field} must be a valid ISO date-time string.`);
  }
  return new Date(milliseconds).toISOString();
}

function adultEligibility(value: unknown): AdultEligibilityDeclaration {
  const eligibility = asRecord(value, "eligibility");
  if (eligibility.minimumAge !== 18) {
    invalid("eligibility.minimumAge must be 18.");
  }
  if (eligibility.declaration !== "age_18_or_over") {
    invalid("eligibility.declaration must confirm that the participant is 18 or older.");
  }

  return {
    minimumAge: 18,
    declaration: "age_18_or_over",
    confirmedAt: isoDateTime(eligibility.confirmedAt, "eligibility.confirmedAt"),
  };
}

function participationConsent(value: unknown): ParticipationConsentAcceptance {
  const consent = asRecord(value, "consent");
  if (consent.purposeId !== PARTICIPATION_PURPOSE_ID) {
    invalid("consent.purposeId is not the current MVP-0.2 participation purpose.");
  }
  if (consent.textVersion !== PARTICIPANT_NOTICE_VERSION) {
    invalid("consent.textVersion is not the current participant-information version.");
  }
  if (consent.mechanism !== "in_app_explicit") {
    invalid("consent.mechanism must be 'in_app_explicit'.");
  }
  if (
    !Array.isArray(consent.scopes) ||
    consent.scopes.length !== 1 ||
    consent.scopes[0] !== PARTICIPATION_SCOPE
  ) {
    invalid("consent.scopes must contain only the MVP-0.2 interview-storage scope.");
  }

  return {
    purposeId: PARTICIPATION_PURPOSE_ID,
    textVersion: PARTICIPANT_NOTICE_VERSION,
    scopes: [PARTICIPATION_SCOPE],
    mechanism: "in_app_explicit",
    acceptedAt: isoDateTime(consent.acceptedAt, "consent.acceptedAt"),
  };
}

function structuredAnswer(value: unknown): StructuredAnswer {
  const answer = asRecord(value, "answer");
  const kind = answer.kind;

  if (kind === "yes_no") {
    if (answer.value !== "yes" && answer.value !== "no") {
      invalid("answer.value must be 'yes' or 'no' for a yes_no answer.");
    }
    return { kind, value: answer.value };
  }

  if (kind === "single_choice") {
    return {
      kind,
      optionId: semanticId(answer.optionId, "answer.optionId"),
    };
  }

  if (kind === "likert") {
    if (!Number.isSafeInteger(answer.value)) {
      invalid("answer.value must be a safe integer for a likert answer.");
    }
    return { kind, value: answer.value as number };
  }

  if (kind === "special") {
    if (
      answer.value !== "unsure" &&
      answer.value !== "skip" &&
      answer.value !== "prefer_not_to_answer"
    ) {
      invalid("answer.value is not a supported special response.");
    }
    return { kind, value: answer.value };
  }

  return invalid("answer.kind is not supported.");
}

export function parseStartInterviewSessionRequest(
  value: unknown,
): StartInterviewSessionRequest {
  const input = asRecord(value, "data");
  const eligibility = adultEligibility(input.eligibility);
  const consent = participationConsent(input.consent);
  const startedAt = isoDateTime(input.startedAt, "startedAt");

  if (eligibility.confirmedAt > consent.acceptedAt) {
    invalid("The age eligibility declaration must occur before consent is accepted.");
  }
  if (consent.acceptedAt > startedAt) {
    invalid("Consent must be accepted before the interview session starts.");
  }

  return {
    sessionId: documentId(input.sessionId, "sessionId"),
    operationId: documentId(input.operationId, "operationId"),
    contentReleaseId: semanticId(input.contentReleaseId, "contentReleaseId"),
    startedAt,
    eligibility,
    consent,
  };
}

export function parseAppendResponseRevisionRequest(
  value: unknown,
): AppendResponseRevisionRequest {
  const input = asRecord(value, "data");
  return {
    sessionId: documentId(input.sessionId, "sessionId"),
    operationId: documentId(input.operationId, "operationId"),
    revisionId: documentId(input.revisionId, "revisionId"),
    questionId: semanticId(input.questionId, "questionId"),
    answer: structuredAnswer(input.answer),
    clientCreatedAt: isoDateTime(input.clientCreatedAt, "clientCreatedAt"),
  };
}

export function parseFinalizeInterviewSessionRequest(
  value: unknown,
): FinalizeInterviewSessionRequest {
  const input = asRecord(value, "data");
  const mode = input.mode;
  if (mode !== "complete" && mode !== "incomplete") {
    invalid("mode must be 'complete' or 'incomplete'.");
  }

  return {
    sessionId: documentId(input.sessionId, "sessionId"),
    operationId: documentId(input.operationId, "operationId"),
    mode,
    completedAt: isoDateTime(input.completedAt, "completedAt"),
  };
}
