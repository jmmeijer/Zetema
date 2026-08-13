import { describe, expect, it } from "vitest";

import { CommandGatewayError } from "./command-service.js";
import { parseStartInterviewSessionRequest } from "./validation.js";

function validRequest(): Record<string, unknown> {
  return {
    sessionId: "session-1",
    operationId: "operation-start-1",
    contentReleaseId: "mvp-0.2.beliefs-and-background.v2",
    startedAt: "2026-08-13T10:02:00.000Z",
    eligibility: {
      minimumAge: 18,
      declaration: "age_18_or_over",
      confirmedAt: "2026-08-13T10:00:00.000Z",
    },
    consent: {
      purposeId: "mvp-0.2-interview-participation-v1",
      textVersion: "2026.08.1",
      scopes: ["INTERVIEW_STORAGE"],
      mechanism: "in_app_explicit",
      acceptedAt: "2026-08-13T10:01:00.000Z",
    },
  };
}

function expectInvalid(input: Record<string, unknown>): void {
  try {
    parseStartInterviewSessionRequest(input);
    throw new Error("Expected request validation to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(CommandGatewayError);
    expect(error).toMatchObject({ code: "INVALID_ARGUMENT" });
  }
}

describe("parseStartInterviewSessionRequest", () => {
  it("accepts the current MVP-0.2 preflight protocol", () => {
    expect(parseStartInterviewSessionRequest(validRequest())).toEqual(validRequest());
  });

  it("rejects an eligibility declaration that does not meet the required threshold", () => {
    expectInvalid({
      ...validRequest(),
      eligibility: {
        minimumAge: 17,
        declaration: "age_18_or_over",
        confirmedAt: "2026-08-13T10:00:00.000Z",
      },
    });
  });

  it("rejects missing participation evidence", () => {
    const input = validRequest();
    delete input.consent;
    expectInvalid(input);
  });

  it("rejects an outdated participant-information version", () => {
    const input = validRequest();
    input.consent = {
      ...(input.consent as Record<string, unknown>),
      textVersion: "2026.07.1",
    };
    expectInvalid(input);
  });

  it("rejects research scope in the MVP-0.2 participation command", () => {
    const input = validRequest();
    input.consent = {
      ...(input.consent as Record<string, unknown>),
      scopes: ["INTERVIEW_STORAGE", "RESEARCH_USE"],
    };
    expectInvalid(input);
  });

  it("rejects evidence timestamps that occur after session start", () => {
    const input = validRequest();
    input.consent = {
      ...(input.consent as Record<string, unknown>),
      acceptedAt: "2026-08-13T10:03:00.000Z",
    };
    expectInvalid(input);
  });
});
