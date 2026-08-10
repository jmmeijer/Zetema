import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  parseAndValidateContentReleaseYaml,
  type ContentRelease,
  type FollowUpRule,
} from "@zetema/content-schema";
import type { QuestionExposure, StructuredAnswer } from "@zetema/domain";

import { selectNextQuestion, type EffectiveResponse } from "./index.js";

const fixtureUrl = new URL(
  "../../../content/releases/mvp-0.1/nature-of-god.en.yaml",
  import.meta.url,
);

function loadRelease(): ContentRelease {
  const result = parseAndValidateContentReleaseYaml(readFileSync(fixtureUrl, "utf8"));
  if (!result.valid) {
    throw new Error(result.issues.map((issue) => issue.message).join("; "));
  }
  return structuredClone(result.value);
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

describe("nested follow-up branching", () => {
  it("can branch from a follow-up into a more granular follow-up", () => {
    const release = loadRelease();
    (release.followUpRules as FollowUpRule[]).push({
      id: "god-conception.ground.power-limits",
      sourceQuestionId: "god-conception",
      when: { kind: "single_choice", optionId: "ground-of-being" },
      targetQuestionId: "power-limits",
    });

    const result = selectNextQuestion({
      release,
      exposures: [
        baseExposure("god-exists"),
        baseExposure("existence-confidence"),
        baseExposure("personal-god"),
        followUpExposure(
          "god-conception",
          "personal-god.no.god-conception",
          "personal-god",
        ),
      ],
      responses: [
        response("god-exists", { kind: "yes_no", value: "yes" }),
        response("existence-confidence", { kind: "likert", value: 4 }),
        response("personal-god", { kind: "yes_no", value: "no" }),
        response("god-conception", {
          kind: "single_choice",
          optionId: "ground-of-being",
        }),
      ],
    });

    expect(result).toEqual({
      status: "question",
      questionId: "power-limits",
      reason: {
        kind: "follow_up_rule",
        ruleId: "god-conception.ground.power-limits",
        sourceQuestionId: "god-conception",
      },
    });
  });
});
