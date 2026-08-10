import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseAndValidateContentReleaseYaml } from "./index.js";

const fixtureUrl = new URL(
  "../../../content/releases/mvp-0.1/beliefs-and-background.en.yaml",
  import.meta.url,
);

describe("expanded MVP-0.1 demo content release", () => {
  it("validates the Beliefs and Background release", () => {
    const result = parseAndValidateContentReleaseYaml(readFileSync(fixtureUrl, "utf8"));

    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }

    expect(result.value.releaseId).toBe("mvp-0.1.beliefs-and-background.v1");
    expect(result.value.questions).toHaveLength(27);
    expect(result.value.questions.filter((question) => question.flow === "base")).toHaveLength(19);
    expect(result.value.questions.filter((question) => question.flow === "follow_up")).toHaveLength(8);
    expect(result.value.followUpRules).toHaveLength(9);
  });
});
