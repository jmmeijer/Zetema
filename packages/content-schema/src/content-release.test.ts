import { readFileSync } from "node:fs";

import YAML from "yaml";
import { describe, expect, it } from "vitest";

import type {
  ContentRelease,
  FollowUpRule,
  QuestionDefinition,
} from "./index.js";
import {
  parseAndValidateContentReleaseYaml,
  validateContentRelease,
} from "./index.js";

const fixtureUrl = new URL(
  "../../../content/releases/mvp-0.1/nature-of-god.en.yaml",
  import.meta.url,
);

function loadFixtureSource(): string {
  return readFileSync(fixtureUrl, "utf8");
}

function loadFixture(): ContentRelease {
  return YAML.parse(loadFixtureSource()) as ContentRelease;
}

function mutableQuestions(release: ContentRelease): QuestionDefinition[] {
  return release.questions as QuestionDefinition[];
}

function mutableRules(release: ContentRelease): FollowUpRule[] {
  return release.followUpRules as FollowUpRule[];
}

describe("MVP-0.1 content release", () => {
  it("validates the expanded demo release", () => {
    const result = parseAndValidateContentReleaseYaml(loadFixtureSource());

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.questions).toHaveLength(28);
      expect(
        result.value.questions.filter((question) => question.flow === "base"),
      ).toHaveLength(19);
      expect(
        result.value.questions.filter(
          (question) => question.flow === "follow_up",
        ),
      ).toHaveLength(9);
    }
  });

  it("rejects duplicate question ids", () => {
    const duplicate = structuredClone(loadFixture()) as ContentRelease;
    const questions = mutableQuestions(duplicate);
    const first = questions[0];
    const second = questions[1];

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first === undefined || second === undefined) {
      throw new Error("Canonical fixture must contain at least two questions.");
    }

    questions[1] = {
      ...second,
      id: first.id,
    };

    const result = validateContentRelease(duplicate);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.some((entry) => entry.code === "duplicate_question_id"))
        .toBe(true);
    }
  });

  it("accepts branching from a follow-up question", () => {
    const nested = structuredClone(loadFixture()) as ContentRelease;
    const rules = mutableRules(nested);

    rules.push({
      id: "god-conception.ground.goodness-conception",
      sourceQuestionId: "god-conception",
      when: {
        kind: "single_choice",
        optionId: "ground-of-being",
      },
      targetQuestionId: "goodness-conception",
    });

    const result = validateContentRelease(nested);

    expect(result.valid).toBe(true);
  });

  it("rejects a single-choice rule that references a missing option", () => {
    const invalid = structuredClone(loadFixture()) as ContentRelease;
    const rules = mutableRules(invalid);
    const firstRule = rules[0];

    expect(firstRule).toBeDefined();
    if (firstRule === undefined) {
      throw new Error("Canonical fixture must contain at least one follow-up rule.");
    }

    rules[0] = {
      ...firstRule,
      sourceQuestionId: "relation-to-time",
      when: {
        kind: "single_choice",
        optionId: "not-a-real-option",
      },
    };

    const result = validateContentRelease(invalid);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.some((entry) => entry.code === "unknown_condition_option"))
        .toBe(true);
    }
  });

  it("reports malformed YAML without throwing", () => {
    const result = parseAndValidateContentReleaseYaml("questions: [");

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues[0]?.code).toBe("yaml_parse_error");
    }
  });
});
