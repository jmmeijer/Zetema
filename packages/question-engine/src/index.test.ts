import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  parseAndValidateContentReleaseYaml,
  type ContentRelease,
} from "@zetema/content-schema";
import type {
  QuestionExposure,
  StructuredAnswer,
} from "@zetema/domain";

import {
  selectNextQuestion,
  type EffectiveResponse,
} from "./index.js";

const fixtureUrl = new URL(
  "../../../content/releases/mvp-0.1/nature-of-god.en.yaml",
  import.meta.url,
);

function loadRelease(): ContentRelease {
  const result = parseAndValidateContentReleaseYaml(
    readFileSync(fixtureUrl, "utf8"),
  );

  if (!result.valid) {
    throw new Error(
      `Fixture is invalid: ${result.issues.map((entry) => entry.message).join("; ")}`,
    );
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
    reason: {
      kind: "follow_up_rule",
      ruleId,
      sourceQuestionId,
    },
  };
}

function response(
  questionId: string,
  answer: StructuredAnswer,
): EffectiveResponse {
  return { questionId, answer };
}

const yes = (): StructuredAnswer => ({ kind: "yes_no", value: "yes" });
const no = (): StructuredAnswer => ({ kind: "yes_no", value: "no" });

function pathThroughPersonalGod(answer: StructuredAnswer): {
  exposures: QuestionExposure[];
  responses: EffectiveResponse[];
} {
  return {
    exposures: [
      baseExposure("god-exists"),
      baseExposure("existence-confidence"),
      baseExposure("personal-god"),
    ],
    responses: [
      response("god-exists", yes()),
      response("existence-confidence", { kind: "likert", value: 4 }),
      response("personal-god", answer),
    ],
  };
}

function pathThroughRelationToTime(): {
  exposures: QuestionExposure[];
  responses: EffectiveResponse[];
} {
  const exposures = [
    baseExposure("god-exists"),
    baseExposure("existence-confidence"),
    baseExposure("personal-god"),
    baseExposure("omnipotent"),
    baseExposure("omniscient"),
    baseExposure("omnipresent"),
    baseExposure("perfectly-good"),
    baseExposure("relation-to-time"),
  ];

  const responses = [
    response("god-exists", yes()),
    response("existence-confidence", { kind: "likert", value: 4 }),
    response("personal-god", yes()),
    response("omnipotent", yes()),
    response("omniscient", yes()),
    response("omnipresent", yes()),
    response("perfectly-good", yes()),
    response("relation-to-time", {
      kind: "single_choice",
      optionId: "outside-time",
    }),
  ];

  return { exposures, responses };
}

describe("selectNextQuestion", () => {
  it("starts with the first base question", () => {
    const result = selectNextQuestion({
      release: loadRelease(),
      responses: [],
      exposures: [],
    });

    expect(result).toEqual({
      status: "question",
      questionId: "god-exists",
      reason: { kind: "base_sequence" },
    });
  });

  it("waits for an explicit response to a presented question", () => {
    const result = selectNextQuestion({
      release: loadRelease(),
      responses: [],
      exposures: [baseExposure("god-exists")],
    });

    expect(result).toEqual({
      status: "awaiting_response",
      questionId: "god-exists",
    });
  });

  it("continues the base sequence when no follow-up is eligible", () => {
    const result = selectNextQuestion({
      release: loadRelease(),
      responses: [response("god-exists", yes())],
      exposures: [baseExposure("god-exists")],
    });

    expect(result).toEqual({
      status: "question",
      questionId: "existence-confidence",
      reason: { kind: "base_sequence" },
    });
  });

  it("inserts an eligible direct follow-up before resuming the baseline", () => {
    const release = loadRelease();
    const path = pathThroughPersonalGod(no());

    const followUp = selectNextQuestion({ release, ...path });

    expect(followUp).toEqual({
      status: "question",
      questionId: "god-conception",
      reason: {
        kind: "follow_up_rule",
        ruleId: "personal-god.no.god-conception",
        sourceQuestionId: "personal-god",
      },
    });

    const afterFollowUp = selectNextQuestion({
      release,
      exposures: [
        ...path.exposures,
        followUpExposure(
          "god-conception",
          "personal-god.no.god-conception",
          "personal-god",
        ),
      ],
      responses: [
        ...path.responses,
        response("god-conception", {
          kind: "single_choice",
          optionId: "ground-of-being",
        }),
      ],
    });

    expect(afterFollowUp).toEqual({
      status: "question",
      questionId: "omnipotent",
      reason: { kind: "base_sequence" },
    });
  });

  it("does not insert the follow-up when the triggering answer does not match", () => {
    const result = selectNextQuestion({
      release: loadRelease(),
      ...pathThroughPersonalGod(yes()),
    });

    expect(result).toEqual({
      status: "question",
      questionId: "omnipotent",
      reason: { kind: "base_sequence" },
    });
  });

  it("treats SKIP as an explicit response rather than missing data", () => {
    const result = selectNextQuestion({
      release: loadRelease(),
      ...pathThroughPersonalGod({ kind: "special", value: "skip" }),
    });

    expect(result).toEqual({
      status: "question",
      questionId: "omnipotent",
      reason: { kind: "base_sequence" },
    });
  });

  it("evaluates single-choice follow-up rules", () => {
    const release = structuredClone(loadRelease());
    release.followUpRules = [
      ...release.followUpRules,
      {
        id: "relation-to-time.outside.power-limits",
        sourceQuestionId: "relation-to-time",
        when: { kind: "single_choice", optionId: "outside-time" },
        targetQuestionId: "power-limits",
      },
    ];

    const result = selectNextQuestion({
      release,
      ...pathThroughRelationToTime(),
    });

    expect(result).toEqual({
      status: "question",
      questionId: "power-limits",
      reason: {
        kind: "follow_up_rule",
        ruleId: "relation-to-time.outside.power-limits",
        sourceQuestionId: "relation-to-time",
      },
    });
  });

  it("evaluates Likert comparison rules", () => {
    const release = structuredClone(loadRelease());
    release.followUpRules = [
      ...release.followUpRules,
      {
        id: "confidence.high.god-conception",
        sourceQuestionId: "existence-confidence",
        when: { kind: "likert", operator: "gte", value: 4 },
        targetQuestionId: "god-conception",
      },
    ];

    const result = selectNextQuestion({
      release,
      exposures: [
        baseExposure("god-exists"),
        baseExposure("existence-confidence"),
      ],
      responses: [
        response("god-exists", yes()),
        response("existence-confidence", { kind: "likert", value: 4 }),
      ],
    });

    expect(result).toEqual({
      status: "question",
      questionId: "god-conception",
      reason: {
        kind: "follow_up_rule",
        ruleId: "confidence.high.god-conception",
        sourceQuestionId: "existence-confidence",
      },
    });
  });

  it("re-evaluates eligibility when the effective answer is revised before presentation", () => {
    const release = loadRelease();
    const original = pathThroughPersonalGod(no());

    const beforeRevision = selectNextQuestion({ release, ...original });
    expect(beforeRevision.status).toBe("question");
    if (beforeRevision.status === "question") {
      expect(beforeRevision.questionId).toBe("god-conception");
    }

    const revisedResponses = original.responses.map((entry) =>
      entry.questionId === "personal-god"
        ? response("personal-god", yes())
        : entry,
    );

    const afterRevision = selectNextQuestion({
      release,
      exposures: original.exposures,
      responses: revisedResponses,
    });

    expect(afterRevision).toEqual({
      status: "question",
      questionId: "omnipotent",
      reason: { kind: "base_sequence" },
    });
  });

  it("classifies unpresented follow-ups as not eligible when the interview completes", () => {
    const release = loadRelease();
    const exposures = release.questions
      .filter((question) => question.flow === "base")
      .map((question) => baseExposure(question.id));

    const responses: EffectiveResponse[] = [
      response("god-exists", yes()),
      response("existence-confidence", { kind: "likert", value: 3 }),
      response("personal-god", yes()),
      response("omnipotent", yes()),
      response("omniscient", yes()),
      response("omnipresent", yes()),
      response("perfectly-good", yes()),
      response("relation-to-time", {
        kind: "single_choice",
        optionId: "outside-time",
      }),
      response("acts-in-world", yes()),
      response("reveals-self", yes()),
    ];

    const result = selectNextQuestion({ release, exposures, responses });

    expect(result.status).toBe("complete");
    if (result.status === "complete") {
      expect(result.nonPresented).toEqual([
        {
          questionId: "god-conception",
          outcome: "not_presented_not_eligible",
          reason: { kind: "not_eligible" },
        },
        {
          questionId: "power-limits",
          outcome: "not_presented_not_eligible",
          reason: { kind: "not_eligible" },
        },
        {
          questionId: "goodness-conception",
          outcome: "not_presented_not_eligible",
          reason: { kind: "not_eligible" },
        },
      ]);
    }
  });

  it("rejects duplicate effective responses", () => {
    const result = selectNextQuestion({
      release: loadRelease(),
      exposures: [baseExposure("god-exists")],
      responses: [
        response("god-exists", yes()),
        response("god-exists", no()),
      ],
    });

    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.issues.some((entry) => entry.code === "duplicate_response"))
        .toBe(true);
    }
  });

  it("rejects progression past a presented but unanswered question", () => {
    const result = selectNextQuestion({
      release: loadRelease(),
      exposures: [
        baseExposure("god-exists"),
        baseExposure("existence-confidence"),
      ],
      responses: [
        response("existence-confidence", { kind: "likert", value: 4 }),
      ],
    });

    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(
        result.issues.some(
          (entry) => entry.code === "progressed_past_unanswered_question",
        ),
      ).toBe(true);
    }
  });

  it("is deterministic for identical inputs", () => {
    const release = loadRelease();
    const input = {
      release,
      ...pathThroughPersonalGod(no()),
    };

    expect(selectNextQuestion(input)).toEqual(selectNextQuestion(input));
  });
});
