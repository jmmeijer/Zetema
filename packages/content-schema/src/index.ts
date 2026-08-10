import Ajv2020 from "ajv/dist/2020.js";
import YAML from "yaml";

import type {
  QuestionFlow,
  QuestionType,
  SpecialResponseValue,
} from "@zetema/domain";
import contentReleaseSchema from "../schema/content-release.schema.json" with { type: "json" };

export interface LocalizedText {
  key: string;
  source: string;
}

export interface ThemeDefinition {
  id: string;
  title: LocalizedText;
  description: LocalizedText;
}

export interface ChoiceOption {
  id: string;
  label: LocalizedText;
}

export interface LikertScale {
  min: number;
  max: number;
  lowLabel: LocalizedText;
  highLabel: LocalizedText;
}

export interface QuestionDefinition {
  id: string;
  flow: QuestionFlow;
  type: QuestionType;
  prompt: LocalizedText;
  options?: readonly ChoiceOption[];
  scale?: LikertScale;
}

export type FollowUpCondition =
  | {
      kind: "yes_no";
      value: "yes" | "no";
    }
  | {
      kind: "single_choice";
      optionId: string;
    }
  | {
      kind: "likert";
      operator: "eq" | "gte" | "lte";
      value: number;
    }
  | {
      kind: "special";
      value: SpecialResponseValue;
    };

export interface FollowUpRule {
  id: string;
  sourceQuestionId: string;
  when: FollowUpCondition;
  targetQuestionId: string;
}

export interface ContentRelease {
  schemaVersion: 1;
  releaseId: string;
  contentVersion: string;
  defaultLocale: string;
  specialResponses: readonly SpecialResponseValue[];
  theme: ThemeDefinition;
  questions: readonly QuestionDefinition[];
  followUpRules: readonly FollowUpRule[];
}

export interface ContentValidationIssue {
  code: string;
  path: string;
  message: string;
}

export type ContentValidationResult =
  | {
      valid: true;
      issues: readonly [];
      value: ContentRelease;
    }
  | {
      valid: false;
      issues: readonly ContentValidationIssue[];
    };

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  // The schema intentionally uses conditional `required` checks inside
  // allOf/then/not branches. They are valid JSON Schema, but Ajv's
  // strictRequired lint can reject them because parent properties are not
  // always considered across these conditional subschema boundaries.
  strictRequired: false,
});

const validateSchema = ajv.compile<ContentRelease>(contentReleaseSchema);

function issue(code: string, path: string, message: string): ContentValidationIssue {
  return { code, path, message };
}

function validateCondition(
  rule: FollowUpRule,
  source: QuestionDefinition,
  release: ContentRelease,
): ContentValidationIssue[] {
  const path = `/followUpRules/${rule.id}/when`;
  const condition = rule.when;

  if (condition.kind === "special") {
    if (!release.specialResponses.includes(condition.value)) {
      return [
        issue(
          "unsupported_special_response",
          path,
          `Special response '${condition.value}' is not enabled by this release.`,
        ),
      ];
    }

    return [];
  }

  if (condition.kind !== source.type) {
    return [
      issue(
        "condition_type_mismatch",
        path,
        `Condition kind '${condition.kind}' cannot be used with '${source.type}' question '${source.id}'.`,
      ),
    ];
  }

  if (condition.kind === "single_choice") {
    const optionExists = source.options?.some(
      (option) => option.id === condition.optionId,
    );

    if (!optionExists) {
      return [
        issue(
          "unknown_condition_option",
          path,
          `Option '${condition.optionId}' does not exist on source question '${source.id}'.`,
        ),
      ];
    }
  }

  if (condition.kind === "likert") {
    const scale = source.scale;
    if (scale !== undefined && (condition.value < scale.min || condition.value > scale.max)) {
      return [
        issue(
          "likert_condition_out_of_range",
          path,
          `Likert condition value ${condition.value} falls outside ${scale.min}-${scale.max} for '${source.id}'.`,
        ),
      ];
    }
  }

  return [];
}

function validateSemanticConstraints(release: ContentRelease): ContentValidationIssue[] {
  const issues: ContentValidationIssue[] = [];
  const questionsById = new Map<string, QuestionDefinition>();

  for (const [questionIndex, question] of release.questions.entries()) {
    if (questionsById.has(question.id)) {
      issues.push(
        issue(
          "duplicate_question_id",
          `/questions/${questionIndex}/id`,
          `Question id '${question.id}' is duplicated.`,
        ),
      );
      continue;
    }

    questionsById.set(question.id, question);

    if (question.type === "single_choice") {
      const seenOptionIds = new Set<string>();
      for (const [optionIndex, option] of (question.options ?? []).entries()) {
        if (seenOptionIds.has(option.id)) {
          issues.push(
            issue(
              "duplicate_option_id",
              `/questions/${questionIndex}/options/${optionIndex}/id`,
              `Option id '${option.id}' is duplicated within '${question.id}'.`,
            ),
          );
        }
        seenOptionIds.add(option.id);
      }
    }

    if (
      question.type === "likert" &&
      question.scale !== undefined &&
      question.scale.min >= question.scale.max
    ) {
      issues.push(
        issue(
          "invalid_likert_range",
          `/questions/${questionIndex}/scale`,
          `Likert minimum must be lower than maximum for '${question.id}'.`,
        ),
      );
    }
  }

  const seenRuleIds = new Set<string>();
  const referencedFollowUps = new Set<string>();

  for (const [ruleIndex, rule] of release.followUpRules.entries()) {
    if (seenRuleIds.has(rule.id)) {
      issues.push(
        issue(
          "duplicate_rule_id",
          `/followUpRules/${ruleIndex}/id`,
          `Follow-up rule id '${rule.id}' is duplicated.`,
        ),
      );
    }
    seenRuleIds.add(rule.id);

    const source = questionsById.get(rule.sourceQuestionId);
    const target = questionsById.get(rule.targetQuestionId);

    if (source === undefined) {
      issues.push(
        issue(
          "unknown_source_question",
          `/followUpRules/${ruleIndex}/sourceQuestionId`,
          `Source question '${rule.sourceQuestionId}' does not exist.`,
        ),
      );
    }

    if (target === undefined) {
      issues.push(
        issue(
          "unknown_target_question",
          `/followUpRules/${ruleIndex}/targetQuestionId`,
          `Target question '${rule.targetQuestionId}' does not exist.`,
        ),
      );
    }

    if (target !== undefined && target.flow !== "follow_up") {
      issues.push(
        issue(
          "target_must_be_follow_up",
          `/followUpRules/${ruleIndex}/targetQuestionId`,
          `Target question '${target.id}' must have flow 'follow_up'.`,
        ),
      );
    }

    if (source !== undefined && target !== undefined && source.id === target.id) {
      issues.push(
        issue(
          "self_referencing_rule",
          `/followUpRules/${ruleIndex}`,
          `Question '${source.id}' cannot follow up to itself.`,
        ),
      );
    }

    if (source !== undefined) {
      issues.push(...validateCondition(rule, source, release));
    }

    if (target !== undefined && target.flow === "follow_up") {
      referencedFollowUps.add(target.id);
    }
  }

  for (const [questionIndex, question] of release.questions.entries()) {
    if (question.flow === "follow_up" && !referencedFollowUps.has(question.id)) {
      issues.push(
        issue(
          "orphan_follow_up",
          `/questions/${questionIndex}/id`,
          `Follow-up question '${question.id}' is never targeted by a rule.`,
        ),
      );
    }
  }

  return issues;
}

export function validateContentRelease(input: unknown): ContentValidationResult {
  if (!validateSchema(input)) {
    return {
      valid: false,
      issues: (validateSchema.errors ?? []).map((error) =>
        issue(
          `schema_${error.keyword}`,
          error.instancePath || "/",
          error.message ?? "Content does not match the JSON Schema.",
        ),
      ),
    };
  }

  const release = input;
  const semanticIssues = validateSemanticConstraints(release);

  if (semanticIssues.length > 0) {
    return {
      valid: false,
      issues: semanticIssues,
    };
  }

  return {
    valid: true,
    issues: [],
    value: release,
  };
}

export function parseAndValidateContentReleaseYaml(
  source: string,
): ContentValidationResult {
  let parsed: unknown;

  try {
    parsed = YAML.parse(source) as unknown;
  } catch (error) {
    return {
      valid: false,
      issues: [
        issue(
          "yaml_parse_error",
          "/",
          error instanceof Error ? error.message : "Unable to parse YAML content.",
        ),
      ],
    };
  }

  return validateContentRelease(parsed);
}

export { contentReleaseSchema };
