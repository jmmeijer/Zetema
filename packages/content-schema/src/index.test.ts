import { describe, expect, it } from "vitest";

import { validateContentRelease } from "./index.js";

describe("content release schema", () => {
  it("compiles the schema and accepts a minimal valid release", () => {
    const result = validateContentRelease({
      schemaVersion: 1,
      releaseId: "test.release.v1",
      contentVersion: "0.0.1",
      defaultLocale: "en-GB",
      specialResponses: ["unsure", "skip", "prefer_not_to_answer"],
      theme: {
        id: "nature-of-god",
        title: { key: "theme.title", source: "Nature of God" },
        description: { key: "theme.description", source: "Test theme" },
      },
      questions: [
        {
          id: "god-exists",
          flow: "base",
          type: "yes_no",
          prompt: { key: "question.god-exists", source: "Does God exist?" },
        },
      ],
      followUpRules: [],
    });

    expect(result.valid).toBe(true);
  });
});
