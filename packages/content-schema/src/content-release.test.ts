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
const expandedFixtureUrl = new URL(
  "../../../content/releases/mvp-0.1/beliefs-and-background.en.yaml",
  import.meta.url,
);
const mvp02FixtureUrl = new URL(
  "../../../content/releases/mvp-0.2/beliefs-and-background.en.yaml",
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

describe("MVP content releases", () => {
  it("validates the canonical English Nature of God release", () => {
    const result = parseAndValidateContentReleaseYaml(loadFixtureSource());

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.questions).toHaveLength(13);
      expect(
        result.value.questions.filter((question) => question.flow === "base"),
      ).toHaveLength(10);
      expect(
        result.value.questions.filter(
          (question) => question.flow === "follow_up",
        ),
      ).toHaveLength(3);
    }
  });

  it("validates the expanded MVP-0.1 beliefs and background release", () => {
    const result = parseAndValidateContentReleaseYaml(
      readFileSync(expandedFixtureUrl, "utf8"),
    );

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.releaseId).toBe("mvp-0.1.beliefs-and-background.v1");
      expect(result.value.questions).toHaveLength(30);
      expect(
        result.value.questions.filter((question) => question.flow === "base"),
      ).toHaveLength(20);
      expect(
        result.value.questions.filter(
          (question) => question.flow === "follow_up",
        ),
      ).toHaveLength(10);
    }
  });

  it("validates the MVP-0.2 v2 belief-first release and conditional God block", () => {
    const result = parseAndValidateContentReleaseYaml(
      readFileSync(mvp02FixtureUrl, "utf8"),
    );

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.releaseId).toBe("mvp-0.2.beliefs-and-background.v2");
      expect(result.value.contentVersion).toBe("2.1.0");
      expect(result.value.questions).toHaveLength(34);
      expect(
        result.value.questions.filter((question) => question.flow === "base"),
      ).toHaveLength(12);
      expect(
        result.value.questions.filter(
          (question) => question.flow === "follow_up",
        ),
      ).toHaveLength(22);

      const baseIds = result.value.questions
        .filter((question) => question.flow === "base")
        .map((question) => question.id);

      expect(baseIds).toEqual([
        "god-exists",
        "existence-confidence",
        "religious-identity",
        "bible-inspired",
        "bible-word-of-god",
        "bible-authority",
        "bible-infallible",
        "bible-inerrant",
        "gospels-reliable",
        "bible-contradictions",
        "bible-interpretation",
        "age-group",
      ]);

      const godNatureIds = [
        "personal-god",
        "relationship-with-people",
        "omnipotent",
        "omniscient",
        "omnipresent",
        "perfectly-good",
        "relation-to-time",
        "creator-of-universe",
        "acts-in-world",
        "reveals-self",
      ];

      for (const questionId of godNatureIds) {
        expect(
          result.value.questions.find((question) => question.id === questionId)?.flow,
        ).toBe("follow_up");
        expect(
          result.value.followUpRules.some(
            (rule) =>
              rule.sourceQuestionId === "god-exists" &&
              rule.targetQuestionId === questionId &&
              rule.when.kind === "yes_no" &&
              rule.when.value === "yes",
          ),
        ).toBe(true);
        expect(
          result.value.followUpRules.some(
            (rule) =>
              rule.sourceQuestionId === "god-exists" &&
              rule.targetQuestionId === questionId &&
              rule.when.kind === "special" &&
              rule.when.value === "unsure",
          ),
        ).toBe(true);
      }

      expect(
        result.value.followUpRules.some(
          (rule) =>
            rule.sourceQuestionId === "god-exists" &&
            rule.targetQuestionId === "god-conception",
        ),
      ).toBe(true);
      expect(
        result.value.followUpRules.some(
          (rule) =>
            rule.sourceQuestionId === "god-exists" &&
            rule.targetQuestionId === "higher-power-belief",
        ),
      ).toBe(true);
      expect(
        result.value.followUpRules.some(
          (rule) =>
            rule.sourceQuestionId === "higher-power-belief" &&
            rule.targetQuestionId === "higher-power-conception",
        ),
      ).toBe(true);
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

  it("allows a follow-up question to trigger a more granular follow-up", () => {
    const valid = structuredClone(loadFixture()) as ContentRelease;
    const rules = mutableRules(valid);

    rules.push({
      id: "god-conception.ground.power-limits",
      sourceQuestionId: "god-conception",
      when: {
        kind: "single_choice",
        optionId: "ground-of-being",
      },
      targetQuestionId: "power-limits",
    });

    const result = validateContentRelease(valid);

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
