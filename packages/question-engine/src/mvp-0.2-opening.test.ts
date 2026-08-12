import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  parseAndValidateContentReleaseYaml,
  type ContentRelease,
} from "@zetema/content-schema";
import type { QuestionExposure, StructuredAnswer } from "@zetema/domain";

import { selectNextQuestion, type EffectiveResponse } from "./index.js";

const fixtureUrl = new URL(
  "../../../content/releases/mvp-0.2/beliefs-and-background.en.yaml",
  import.meta.url,
);

function loadRelease(): ContentRelease {
  const result = parseAndValidateContentReleaseYaml(readFileSync(fixtureUrl, "utf8"));
  if (!result.valid) {
    throw new Error(result.issues.map((issue) => issue.message).join("; "));
  }
  return result.value;
}

function baseExposure(questionId: string): QuestionExposure {
  return {
    questionId,
    outcome: "presented",
    reason: { kind: "base_sequence" },
  };
}

function followUpExposure(
  questionId: string,
  ruleId: string,
  sourceQuestionId: string,
): QuestionExposure {
  return {
    questionId,
    outcome: "presented",
    reason: { kind: "follow_up_rule", ruleId, sourceQuestionId },
  };
}

function response(questionId: string, answer: StructuredAnswer): EffectiveResponse {
  return { questionId, answer };
}

describe("MVP-0.2 belief-first opening", () => {
  it("starts with the minimally framed God-belief question", () => {
    const result = selectNextQuestion({
      release: loadRelease(),
      exposures: [],
      responses: [],
    });

    expect(result).toEqual({
      status: "question",
      questionId: "god-exists",
      reason: { kind: "base_sequence" },
    });
  });

  it("clarifies what God means after a yes answer before entering the God block", () => {
    const result = selectNextQuestion({
      release: loadRelease(),
      exposures: [baseExposure("god-exists")],
      responses: [response("god-exists", { kind: "yes_no", value: "yes" })],
    });

    expect(result).toEqual({
      status: "question",
      questionId: "god-conception",
      reason: {
        kind: "follow_up_rule",
        ruleId: "god-exists.yes.god-conception",
        sourceQuestionId: "god-exists",
      },
    });
  });

  it("uses the God-specific nature block after the participant defines God", () => {
    const result = selectNextQuestion({
      release: loadRelease(),
      exposures: [
        baseExposure("god-exists"),
        followUpExposure(
          "god-conception",
          "god-exists.yes.god-conception",
          "god-exists",
        ),
      ],
      responses: [
        response("god-exists", { kind: "yes_no", value: "yes" }),
        response("god-conception", {
          kind: "single_choice",
          optionId: "ground-of-being",
        }),
      ],
    });

    expect(result).toEqual({
      status: "question",
      questionId: "personal-god",
      reason: {
        kind: "follow_up_rule",
        ruleId: "god-exists.yes.personal-god",
        sourceQuestionId: "god-exists",
      },
    });
  });

  it("also explores the God block when existence itself is unsure", () => {
    const result = selectNextQuestion({
      release: loadRelease(),
      exposures: [
        baseExposure("god-exists"),
        followUpExposure(
          "god-conception",
          "god-exists.unsure.god-conception",
          "god-exists",
        ),
      ],
      responses: [
        response("god-exists", { kind: "special", value: "unsure" }),
        response("god-conception", {
          kind: "single_choice",
          optionId: "personal-being",
        }),
      ],
    });

    expect(result).toEqual({
      status: "question",
      questionId: "personal-god",
      reason: {
        kind: "follow_up_rule",
        ruleId: "god-exists.unsure.personal-god",
        sourceQuestionId: "god-exists",
      },
    });
  });

  it("distinguishes rejecting God from rejecting every higher power", () => {
    const result = selectNextQuestion({
      release: loadRelease(),
      exposures: [baseExposure("god-exists")],
      responses: [response("god-exists", { kind: "yes_no", value: "no" })],
    });

    expect(result).toEqual({
      status: "question",
      questionId: "higher-power-belief",
      reason: {
        kind: "follow_up_rule",
        ruleId: "god-exists.no.higher-power",
        sourceQuestionId: "god-exists",
      },
    });
  });

  it("clarifies a higher-power belief before returning to the base sequence", () => {
    const result = selectNextQuestion({
      release: loadRelease(),
      exposures: [
        baseExposure("god-exists"),
        followUpExposure(
          "higher-power-belief",
          "god-exists.no.higher-power",
          "god-exists",
        ),
      ],
      responses: [
        response("god-exists", { kind: "yes_no", value: "no" }),
        response("higher-power-belief", { kind: "yes_no", value: "yes" }),
      ],
    });

    expect(result).toEqual({
      status: "question",
      questionId: "higher-power-conception",
      reason: {
        kind: "follow_up_rule",
        ruleId: "higher-power.yes.conception",
        sourceQuestionId: "higher-power-belief",
      },
    });
  });

  it("returns to confidence after the higher-power clarification is answered", () => {
    const result = selectNextQuestion({
      release: loadRelease(),
      exposures: [
        baseExposure("god-exists"),
        followUpExposure(
          "higher-power-belief",
          "god-exists.no.higher-power",
          "god-exists",
        ),
        followUpExposure(
          "higher-power-conception",
          "higher-power.yes.conception",
          "higher-power-belief",
        ),
      ],
      responses: [
        response("god-exists", { kind: "yes_no", value: "no" }),
        response("higher-power-belief", { kind: "yes_no", value: "yes" }),
        response("higher-power-conception", {
          kind: "single_choice",
          optionId: "spiritual-force",
        }),
      ],
    });

    expect(result).toEqual({
      status: "question",
      questionId: "existence-confidence",
      reason: { kind: "base_sequence" },
    });
  });

  it("skips the God-nature block when the participant rejects God", () => {
    const result = selectNextQuestion({
      release: loadRelease(),
      exposures: [
        baseExposure("god-exists"),
        followUpExposure(
          "higher-power-belief",
          "god-exists.no.higher-power",
          "god-exists",
        ),
        baseExposure("existence-confidence"),
      ],
      responses: [
        response("god-exists", { kind: "yes_no", value: "no" }),
        response("higher-power-belief", { kind: "yes_no", value: "no" }),
        response("existence-confidence", { kind: "likert", value: 4 }),
      ],
    });

    expect(result).toEqual({
      status: "question",
      questionId: "religious-identity",
      reason: { kind: "base_sequence" },
    });
  });
});
