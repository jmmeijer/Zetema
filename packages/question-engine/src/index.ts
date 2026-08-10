import type {
  QuestionExposure,
  QuestionId,
  QuestionPresentationReason,
  StructuredAnswer,
} from "@zetema/domain";
import type {
  ContentRelease,
  FollowUpCondition,
  FollowUpRule,
  QuestionDefinition,
} from "@zetema/content-schema";

export interface EffectiveResponse {
  questionId: QuestionId;
  answer: StructuredAnswer;
}

export interface SelectNextQuestionInput {
  release: ContentRelease;
  responses: readonly EffectiveResponse[];
  /** Chronological exposure history. */
  exposures: readonly QuestionExposure[];
}

export interface QuestionEngineIssue {
  code: string;
  message: string;
  questionId?: QuestionId;
}

export type SelectNextQuestionResult =
  | {
      status: "question";
      questionId: QuestionId;
      reason: QuestionPresentationReason;
    }
  | {
      status: "awaiting_response";
      questionId: QuestionId;
    }
  | {
      status: "complete";
      nonPresented: readonly QuestionExposure[];
    }
  | {
      status: "invalid";
      issues: readonly QuestionEngineIssue[];
    };

function issue(
  code: string,
  message: string,
  questionId?: QuestionId,
): QuestionEngineIssue {
  if (questionId === undefined) {
    return { code, message };
  }

  return { code, message, questionId };
}

function validateAnswer(
  question: QuestionDefinition,
  answer: StructuredAnswer,
  release: ContentRelease,
): QuestionEngineIssue[] {
  if (answer.kind === "special") {
    if (!release.specialResponses.includes(answer.value)) {
      return [
        issue(
          "unsupported_special_response",
          `Special response '${answer.value}' is not enabled by this release.`,
          question.id,
        ),
      ];
    }

    return [];
  }

  if (answer.kind !== question.type) {
    return [
      issue(
        "answer_type_mismatch",
        `Answer kind '${answer.kind}' cannot be used with '${question.type}' question '${question.id}'.`,
        question.id,
      ),
    ];
  }

  if (answer.kind === "single_choice") {
    const optionExists = question.options?.some(
      (option) => option.id === answer.optionId,
    );

    if (!optionExists) {
      return [
        issue(
          "unknown_answer_option",
          `Option '${answer.optionId}' does not exist on question '${question.id}'.`,
          question.id,
        ),
      ];
    }
  }

  if (answer.kind === "likert") {
    const scale = question.scale;
    if (scale === undefined) {
      return [
        issue(
          "missing_likert_scale",
          `Likert question '${question.id}' does not define a scale.`,
          question.id,
        ),
      ];
    }

    if (answer.value < scale.min || answer.value > scale.max) {
      return [
        issue(
          "likert_answer_out_of_range",
          `Likert answer ${answer.value} falls outside ${scale.min}-${scale.max} for '${question.id}'.`,
          question.id,
        ),
      ];
    }
  }

  return [];
}

function conditionMatches(
  condition: FollowUpCondition,
  answer: StructuredAnswer,
): boolean {
  if (condition.kind === "special") {
    return answer.kind === "special" && answer.value === condition.value;
  }

  if (condition.kind !== answer.kind) {
    return false;
  }

  if (condition.kind === "yes_no" && answer.kind === "yes_no") {
    return answer.value === condition.value;
  }

  if (
    condition.kind === "single_choice" &&
    answer.kind === "single_choice"
  ) {
    return answer.optionId === condition.optionId;
  }

  if (condition.kind === "likert" && answer.kind === "likert") {
    switch (condition.operator) {
      case "eq":
        return answer.value === condition.value;
      case "gte":
        return answer.value >= condition.value;
      case "lte":
        return answer.value <= condition.value;
    }
  }

  return false;
}

function validateState(input: SelectNextQuestionInput): {
  issues: QuestionEngineIssue[];
  questionsById: Map<QuestionId, QuestionDefinition>;
  responsesById: Map<QuestionId, EffectiveResponse>;
  presentedIds: Set<QuestionId>;
  presentedInOrder: QuestionExposure[];
} {
  const { release, responses, exposures } = input;
  const issues: QuestionEngineIssue[] = [];
  const questionsById = new Map<QuestionId, QuestionDefinition>();
  const responsesById = new Map<QuestionId, EffectiveResponse>();
  const presentedIds = new Set<QuestionId>();
  const presentedInOrder: QuestionExposure[] = [];
  const rulesById = new Map<string, FollowUpRule>();

  for (const question of release.questions) {
    questionsById.set(question.id, question);
  }

  for (const rule of release.followUpRules) {
    rulesById.set(rule.id, rule);

    if (!questionsById.has(rule.sourceQuestionId)) {
      issues.push(
        issue(
          "unknown_rule_source",
          `Follow-up rule '${rule.id}' references unknown source question '${rule.sourceQuestionId}'.`,
        ),
      );
    }

    if (!questionsById.has(rule.targetQuestionId)) {
      issues.push(
        issue(
          "unknown_rule_target",
          `Follow-up rule '${rule.id}' references unknown target question '${rule.targetQuestionId}'.`,
        ),
      );
    }
  }

  for (const response of responses) {
    const question = questionsById.get(response.questionId);

    if (question === undefined) {
      issues.push(
        issue(
          "unknown_response_question",
          `Response references unknown question '${response.questionId}'.`,
          response.questionId,
        ),
      );
      continue;
    }

    if (responsesById.has(response.questionId)) {
      issues.push(
        issue(
          "duplicate_response",
          `Effective response for '${response.questionId}' appears more than once.`,
          response.questionId,
        ),
      );
      continue;
    }

    responsesById.set(response.questionId, response);
    issues.push(...validateAnswer(question, response.answer, release));
  }

  for (const exposure of exposures) {
    const question = questionsById.get(exposure.questionId);

    if (question === undefined) {
      issues.push(
        issue(
          "unknown_exposure_question",
          `Exposure references unknown question '${exposure.questionId}'.`,
          exposure.questionId,
        ),
      );
      continue;
    }

    if (exposure.outcome !== "presented") {
      continue;
    }

    if (presentedIds.has(exposure.questionId)) {
      issues.push(
        issue(
          "duplicate_presentation",
          `Question '${exposure.questionId}' is marked as presented more than once.`,
          exposure.questionId,
        ),
      );
      continue;
    }

    presentedIds.add(exposure.questionId);
    presentedInOrder.push(exposure);

    if (exposure.reason.kind === "base_sequence") {
      if (question.flow !== "base") {
        issues.push(
          issue(
            "presentation_reason_mismatch",
            `Follow-up question '${question.id}' cannot be presented as a base-sequence question.`,
            question.id,
          ),
        );
      }
      continue;
    }

    if (question.flow !== "follow_up") {
      issues.push(
        issue(
          "presentation_reason_mismatch",
          `Base question '${question.id}' cannot be presented by a follow-up rule.`,
          question.id,
        ),
      );
    }

    const rule = rulesById.get(exposure.reason.ruleId);
    if (rule === undefined) {
      issues.push(
        issue(
          "unknown_presentation_rule",
          `Presentation references unknown follow-up rule '${exposure.reason.ruleId}'.`,
          question.id,
        ),
      );
      continue;
    }

    if (
      rule.targetQuestionId !== exposure.questionId ||
      rule.sourceQuestionId !== exposure.reason.sourceQuestionId
    ) {
      issues.push(
        issue(
          "presentation_rule_mismatch",
          `Presentation reason does not match rule '${rule.id}'.`,
          question.id,
        ),
      );
    }
  }

  for (const response of responsesById.values()) {
    if (!presentedIds.has(response.questionId)) {
      issues.push(
        issue(
          "response_without_presentation",
          `Question '${response.questionId}' has a response but no presented exposure.`,
          response.questionId,
        ),
      );
    }
  }

  return {
    issues,
    questionsById,
    responsesById,
    presentedIds,
    presentedInOrder,
  };
}

function findEligibleFollowUp(
  release: ContentRelease,
  responsesById: ReadonlyMap<QuestionId, EffectiveResponse>,
  presentedIds: ReadonlySet<QuestionId>,
  presentedInOrder: readonly QuestionExposure[],
): FollowUpRule | undefined {
  const sourcePositionById = new Map<QuestionId, number>();

  for (const [index, exposure] of presentedInOrder.entries()) {
    sourcePositionById.set(exposure.questionId, index);
  }

  const candidates = release.followUpRules
    .map((rule, rulePosition) => ({
      rule,
      rulePosition,
      sourcePosition: sourcePositionById.get(rule.sourceQuestionId),
    }))
    .filter((candidate) => {
      const { rule, sourcePosition } = candidate;
      if (sourcePosition === undefined) {
        return false;
      }
      if (presentedIds.has(rule.targetQuestionId)) {
        return false;
      }

      const response = responsesById.get(rule.sourceQuestionId);
      return response !== undefined && conditionMatches(rule.when, response.answer);
    })
    .sort((left, right) => {
      const sourceDifference =
        (left.sourcePosition ?? Number.MAX_SAFE_INTEGER) -
        (right.sourcePosition ?? Number.MAX_SAFE_INTEGER);

      if (sourceDifference !== 0) {
        return sourceDifference;
      }

      return left.rulePosition - right.rulePosition;
    });

  return candidates[0]?.rule;
}

export function selectNextQuestion(
  input: SelectNextQuestionInput,
): SelectNextQuestionResult {
  const state = validateState(input);

  if (state.issues.length > 0) {
    return {
      status: "invalid",
      issues: state.issues,
    };
  }

  for (const [index, exposure] of state.presentedInOrder.entries()) {
    if (state.responsesById.has(exposure.questionId)) {
      continue;
    }

    const laterPresentationExists = state.presentedInOrder
      .slice(index + 1)
      .some((later) => later.outcome === "presented");

    if (laterPresentationExists) {
      return {
        status: "invalid",
        issues: [
          issue(
            "progressed_past_unanswered_question",
            `Interview progressed past unanswered question '${exposure.questionId}'.`,
            exposure.questionId,
          ),
        ],
      };
    }

    return {
      status: "awaiting_response",
      questionId: exposure.questionId,
    };
  }

  const baseQuestions = input.release.questions.filter(
    (question) => question.flow === "base",
  );
  const nextBasePosition = baseQuestions.findIndex(
    (question) => !state.presentedIds.has(question.id),
  );

  const eligibleFollowUp = findEligibleFollowUp(
    input.release,
    state.responsesById,
    state.presentedIds,
    state.presentedInOrder,
  );

  if (eligibleFollowUp !== undefined) {
    return {
      status: "question",
      questionId: eligibleFollowUp.targetQuestionId,
      reason: {
        kind: "follow_up_rule",
        ruleId: eligibleFollowUp.id,
        sourceQuestionId: eligibleFollowUp.sourceQuestionId,
      },
    };
  }

  if (nextBasePosition !== -1) {
    const nextBase = baseQuestions[nextBasePosition];
    if (nextBase === undefined) {
      return {
        status: "invalid",
        issues: [
          issue(
            "base_sequence_error",
            "Could not resolve the next base question from the content release.",
          ),
        ],
      };
    }

    return {
      status: "question",
      questionId: nextBase.id,
      reason: {
        kind: "base_sequence",
      },
    };
  }

  const nonPresented: QuestionExposure[] = input.release.questions
    .filter(
      (question) =>
        question.flow === "follow_up" && !state.presentedIds.has(question.id),
    )
    .map((question) => ({
      questionId: question.id,
      outcome: "not_presented_not_eligible" as const,
      reason: {
        kind: "not_eligible" as const,
      },
    }));

  return {
    status: "complete",
    nonPresented,
  };
}
