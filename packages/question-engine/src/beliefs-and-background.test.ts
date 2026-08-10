import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  parseAndValidateContentReleaseYaml,
  type ContentRelease,
} from "@zetema/content-schema";
import type { QuestionExposure, StructuredAnswer } from "@zetema/domain";

import { selectNextQuestion, type EffectiveResponse } from "./index.js";

const fixtureUrl = new URL(
  "../../../content/releases/mvp-0.1/beliefs-and-background.en.yaml",
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

function pathThroughBaseQuestion(
  release: ContentRelease,
  targetQuestionId: string,
  targetAnswer: StructuredAnswer,
): { exposures: QuestionExposure[]; responses: EffectiveResponse[] } {
  const baseQuestions = release.questions.filter((question) => question.flow === "base");
  const targetIndex = baseQuestions.findIndex((question) => question.id === targetQuestionId);
  if (targetIndex === -1) {
    throw new Error(`Unknown base question '${targetQuestionId}'.`);
  }

  const reached = baseQuestions.slice(0, targetIndex + 1);
  return {
    exposures: reached.map((question) => baseExposure(question.id)),
    responses: reached.map((question) => ({
      questionId: question.id,
      answer:
        question.id === targetQuestionId
          ? targetAnswer
          : { kind: "special", value: "skip" as const },
    })),
  };
}

describe("expanded demo branching", () => {
  it("asks how contradictions affect authority after a yes answer", () => {
    const release = loadRelease();
    const result = selectNextQuestion({
      release,
      ...pathThroughBaseQuestion(release, "bible-contradictions", {
        kind: "yes_no",
        value: "yes",
      }),
    });

    expect(result).toEqual({
      status: "question",
      questionId: "contradictions-impact",
      reason: {
        kind: "follow_up_rule",
        ruleId: "bible-contradictions.yes.impact",
        sourceQuestionId: "bible-contradictions",
      },
    });
  });

  it("branches Christian Orthodox identity to a granular Orthodox list", () => {
    const release = loadRelease();
    const result = selectNextQuestion({
      release,
      ...pathThroughBaseQuestion(release, "religious-identity", {
        kind: "single_choice",
        optionId: "christian-orthodox",
      }),
    });

    expect(result).toEqual({
      status: "question",
      questionId: "orthodox-denomination",
      reason: {
        kind: "follow_up_rule",
        ruleId: "religious-identity.orthodox.detail",
        sourceQuestionId: "religious-identity",
      },
    });
  });

  it("branches Christian Protestant identity to Protestant families", () => {
    const release = loadRelease();
    const result = selectNextQuestion({
      release,
      ...pathThroughBaseQuestion(release, "religious-identity", {
        kind: "single_choice",
        optionId: "christian-protestant",
      }),
    });

    expect(result).toEqual({
      status: "question",
      questionId: "protestant-family",
      reason: {
        kind: "follow_up_rule",
        ruleId: "religious-identity.protestant.detail",
        sourceQuestionId: "religious-identity",
      },
    });
  });
});
