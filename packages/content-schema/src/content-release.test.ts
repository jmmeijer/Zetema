import { readFileSync } from "node:fs";

import YAML from "yaml";
import { describe, expect, it } from "vitest";

import type { ContentRelease } from "./index.js";
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

describe("MVP-0.1 content release", () => {
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

  it("rejects duplicate question ids", () => {
    const release = loadFixture();
    const duplicate = structuredClone(release) as ContentRelease;

    duplicate.questions[1] = {
      ...duplicate.questions[1],
      id: duplicate.questions[0]?.id ?? "god-exists",
    };

    const result = validateContentRelease(duplicate);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.some((entry) => entry.code === "duplicate_question_id"))
        .toBe(true);
    }
  });

  it("rejects branching from a follow-up question", () => {
    const release = loadFixture();
    const invalid = structuredClone(release) as ContentRelease;

    invalid.followUpRules[0] = {
      ...invalid.followUpRules[0],
      sourceQuestionId: "god-conception",
      when: {
        kind: "single_choice",
        optionId: "ground-of-being",
      },
    };

    const result = validateContentRelease(invalid);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.some((entry) => entry.code === "follow_up_cannot_branch"))
        .toBe(true);
    }
  });

  it("rejects a single-choice rule that references a missing option", () => {
    const release = loadFixture();
    const invalid = structuredClone(release) as ContentRelease;

    invalid.followUpRules[0] = {
      ...invalid.followUpRules[0],
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
