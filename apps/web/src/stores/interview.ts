import { computed, ref } from "vue";
import { defineStore } from "pinia";

import {
  parseAndValidateContentReleaseYaml,
  type QuestionDefinition,
} from "@zetema/content-schema";
import type { QuestionExposure, StructuredAnswer } from "@zetema/domain";
import {
  selectNextQuestion,
  type EffectiveResponse,
} from "@zetema/question-engine";
import {
  IndexedDbLocalStore,
  type LocalSessionState,
} from "@zetema/sync-engine";
import releaseSource from "../../../../content/releases/mvp-0.1/nature-of-god.en.yaml?raw";
import { currentLocale, translate } from "../i18n";
import { localizeContentText } from "../i18n/content";

const parsedRelease = parseAndValidateContentReleaseYaml(releaseSource);

if (!parsedRelease.valid) {
  throw new Error(
    `Invalid bundled content release: ${parsedRelease.issues
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join("; ")}`,
  );
}

const release = parsedRelease.value;
const localStore = new IndexedDbLocalStore();
const LAST_SESSION_KEY = "zetema.lastSessionId";

function now(): string {
  return new Date().toISOString();
}

function newId(): string {
  return crypto.randomUUID();
}

function naturalList(items: readonly string[]): string {
  return new Intl.ListFormat(currentLocale.value, {
    style: "long",
    type: "conjunction",
  }).format([...items]);
}

export const useInterviewStore = defineStore("interview", () => {
  const sessionId = ref<string | null>(null);
  const sessionState = ref<LocalSessionState | null>(null);
  const currentQuestionId = ref<string | null>(null);
  const effectiveResponses = ref<EffectiveResponse[]>([]);
  const exposures = ref<QuestionExposure[]>([]);
  const busy = ref(false);
  const errorMessage = ref<string | null>(null);
  const flowComplete = ref(false);
  const finished = ref(false);
  const resumeAvailable = ref(false);

  const baseQuestions = release.questions.filter((question) => question.flow === "base");
  const baseQuestionIds = new Set(baseQuestions.map((question) => question.id));

  const currentQuestion = computed<QuestionDefinition | undefined>(() => {
    if (currentQuestionId.value === null) {
      return undefined;
    }
    return release.questions.find((question) => question.id === currentQuestionId.value);
  });

  const responseMap = computed(() =>
    new Map(effectiveResponses.value.map((response) => [response.questionId, response.answer])),
  );

  const answeredBaseCount = computed(
    () => effectiveResponses.value.filter((response) => baseQuestionIds.has(response.questionId)).length,
  );

  const answeredCount = computed(() => effectiveResponses.value.length);

  const progressPercent = computed(() =>
    baseQuestions.length === 0
      ? 0
      : Math.min(100, Math.round((answeredBaseCount.value / baseQuestions.length) * 100)),
  );

  function getAnswer(questionId: string): StructuredAnswer | undefined {
    return responseMap.value.get(questionId);
  }

  function getQuestion(questionId: string): QuestionDefinition | undefined {
    return release.questions.find((question) => question.id === questionId);
  }

  async function hydrateSession(): Promise<LocalSessionState> {
    if (sessionId.value === null) {
      throw new Error(translate("errors.noSession"));
    }

    const snapshot = await localStore.getSessionSnapshot(sessionId.value);
    const responses = await localStore.getEffectiveResponses(sessionId.value);

    sessionState.value = snapshot.session.state;
    effectiveResponses.value = responses.map(({ questionId, answer }) => ({ questionId, answer }));
    exposures.value = snapshot.exposures.map((record) => record.exposure);

    return snapshot.session.state;
  }

  async function refreshFlow(): Promise<void> {
    if (sessionId.value === null) {
      return;
    }

    await hydrateSession();

    if (sessionState.value !== "active") {
      currentQuestionId.value = null;
      flowComplete.value = true;
      finished.value = true;
      return;
    }

    const result = selectNextQuestion({
      release,
      responses: effectiveResponses.value,
      exposures: exposures.value,
    });

    if (result.status === "invalid") {
      currentQuestionId.value = null;
      flowComplete.value = false;
      errorMessage.value = result.issues.map((issue) => issue.message).join(" ");
      return;
    }

    if (result.status === "question") {
      await localStore.recordQuestionExposure({
        sessionId: sessionId.value,
        exposure: {
          questionId: result.questionId,
          outcome: "presented",
          reason: result.reason,
        },
        recordedAt: now(),
      });
      await hydrateSession();
      currentQuestionId.value = result.questionId;
      flowComplete.value = false;
      return;
    }

    if (result.status === "awaiting_response") {
      currentQuestionId.value = result.questionId;
      flowComplete.value = false;
      return;
    }

    for (const exposure of result.nonPresented) {
      await localStore.recordQuestionExposure({
        sessionId: sessionId.value,
        exposure,
        recordedAt: now(),
      });
    }

    if (result.nonPresented.length > 0) {
      await hydrateSession();
    }

    currentQuestionId.value = null;
    flowComplete.value = true;
  }

  async function startSession(): Promise<string> {
    busy.value = true;
    errorMessage.value = null;

    try {
      const id = newId();
      const timestamp = now();

      await localStore.cacheContentRelease({
        releaseId: release.releaseId,
        locale: release.defaultLocale,
        cachedAt: timestamp,
        payload: release,
      });

      await localStore.createSession({
        sessionId: id,
        contentReleaseId: release.releaseId,
        operationId: newId(),
        startedAt: timestamp,
      });

      localStorage.setItem(LAST_SESSION_KEY, id);
      sessionId.value = id;
      finished.value = false;
      await refreshFlow();
      return id;
    } finally {
      busy.value = false;
    }
  }

  async function checkResume(): Promise<void> {
    const id = localStorage.getItem(LAST_SESSION_KEY);
    if (id === null) {
      resumeAvailable.value = false;
      return;
    }

    try {
      const session = await localStore.getSession(id);
      resumeAvailable.value = session?.state === "active";
      if (!resumeAvailable.value) {
        localStorage.removeItem(LAST_SESSION_KEY);
      }
    } catch {
      resumeAvailable.value = false;
    }
  }

  async function resumeLastSession(): Promise<string | null> {
    const id = localStorage.getItem(LAST_SESSION_KEY);
    if (id === null) {
      return null;
    }

    const session = await localStore.getSession(id);
    if (session?.state !== "active") {
      localStorage.removeItem(LAST_SESSION_KEY);
      resumeAvailable.value = false;
      return null;
    }

    await loadSession(id);
    return id;
  }

  async function loadSession(id: string): Promise<void> {
    busy.value = true;
    errorMessage.value = null;

    try {
      sessionId.value = id;
      finished.value = false;
      const state = await hydrateSession();
      if (state === "active") {
        await refreshFlow();
      } else {
        currentQuestionId.value = null;
        flowComplete.value = true;
        finished.value = true;
      }
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : translate("errors.loadSession");
      throw error;
    } finally {
      busy.value = false;
    }
  }

  async function answerCurrent(answer: StructuredAnswer): Promise<void> {
    if (sessionId.value === null || currentQuestionId.value === null) {
      throw new Error(translate("errors.noActiveQuestion"));
    }

    busy.value = true;
    errorMessage.value = null;

    try {
      await localStore.appendResponseRevision({
        revisionId: newId(),
        operationId: newId(),
        sessionId: sessionId.value,
        questionId: currentQuestionId.value,
        answer,
        createdAt: now(),
      });
      await refreshFlow();
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : translate("errors.saveAnswer");
      throw error;
    } finally {
      busy.value = false;
    }
  }

  function setQuestionForEdit(questionId: string): void {
    const question = getQuestion(questionId);
    if (question === undefined || getAnswer(questionId) === undefined) {
      throw new Error(`Question '${questionId}' is not available for editing.`);
    }
    currentQuestionId.value = questionId;
  }

  async function finishSession(): Promise<void> {
    if (sessionId.value === null || !flowComplete.value) {
      throw new Error(translate("errors.cannotFinish"));
    }

    busy.value = true;
    errorMessage.value = null;

    try {
      await localStore.completeSessionLocally({
        sessionId: sessionId.value,
        operationId: newId(),
        mode: "complete",
        completedAt: now(),
      });
      localStorage.removeItem(LAST_SESSION_KEY);
      resumeAvailable.value = false;
      finished.value = true;
      sessionState.value = "completed_locally";
    } finally {
      busy.value = false;
    }
  }

  const summaryParagraphs = computed(() => {
    const paragraphs: string[] = [];
    const first: string[] = [];
    const existence = getAnswer("god-exists");

    if (existence?.kind === "yes_no") {
      first.push(
        translate(
          existence.value === "yes"
            ? "summary.generated.existenceYes"
            : "summary.generated.existenceNo",
        ),
      );
    } else if (existence?.kind === "special" && existence.value === "unsure") {
      first.push(translate("summary.generated.existenceUnsure"));
    }

    const confidence = getAnswer("existence-confidence");
    if (confidence?.kind === "likert") {
      const labels: Record<number, string> = {
        1: translate("summary.generated.confidenceVeryLow"),
        2: translate("summary.generated.confidenceLow"),
        3: translate("summary.generated.confidenceModerate"),
        4: translate("summary.generated.confidenceFairlyHigh"),
        5: translate("summary.generated.confidenceVeryHigh"),
      };
      first.push(
        translate("summary.generated.confidence", {
          level: labels[confidence.value] ?? translate("summary.generated.confidenceModerate"),
        }),
      );
    } else if (confidence?.kind === "special" && confidence.value === "unsure") {
      first.push(translate("summary.generated.confidenceUnsure"));
    }

    const personal = getAnswer("personal-god");
    if (personal?.kind === "yes_no") {
      first.push(
        translate(
          personal.value === "yes"
            ? "summary.generated.personalYes"
            : "summary.generated.personalNo",
        ),
      );
    } else if (personal?.kind === "special" && personal.value === "unsure") {
      first.push(translate("summary.generated.personalUnsure"));
    }

    if (first.length > 0) {
      paragraphs.push(first.join(" "));
    }

    const attributes = [
      ["omnipotent", translate("summary.generated.attributeMaxPowerful")],
      ["omniscient", translate("summary.generated.attributeAllKnowing")],
      ["omnipresent", translate("summary.generated.attributeOmnipresent")],
      ["perfectly-good", translate("summary.generated.attributePerfectlyGood")],
    ] as const;
    const affirmed: string[] = [];
    const rejected: string[] = [];
    const uncertain: string[] = [];

    for (const [questionId, label] of attributes) {
      const answer = getAnswer(questionId);
      if (answer?.kind === "yes_no") {
        (answer.value === "yes" ? affirmed : rejected).push(label);
      } else if (answer?.kind === "special" && answer.value === "unsure") {
        uncertain.push(label);
      }
    }

    const second: string[] = [];
    if (affirmed.length > 0) {
      second.push(
        translate("summary.generated.attributesAffirmed", {
          attributes: naturalList(affirmed),
        }),
      );
    }
    if (rejected.length > 0) {
      second.push(
        translate("summary.generated.attributesRejected", {
          attributes: naturalList(rejected),
        }),
      );
    }
    if (uncertain.length > 0) {
      second.push(
        translate("summary.generated.attributesUnsure", {
          attributes: naturalList(uncertain),
        }),
      );
    }
    if (second.length > 0) {
      paragraphs.push(second.join(" "));
    }

    const third: string[] = [];
    const time = getAnswer("relation-to-time");
    if (time?.kind === "single_choice") {
      const timeKeys: Record<string, string> = {
        "outside-time": "summary.generated.timeOutside",
        "within-time": "summary.generated.timeWithin",
        both: "summary.generated.timeBoth",
        other: "summary.generated.timeOther",
      };
      const key = timeKeys[time.optionId];
      if (key !== undefined) {
        third.push(translate(key));
      }
    } else if (time?.kind === "special" && time.value === "unsure") {
      third.push(translate("summary.generated.timeUnsure"));
    }

    const acts = getAnswer("acts-in-world");
    if (acts?.kind === "yes_no") {
      third.push(
        translate(
          acts.value === "yes" ? "summary.generated.actsYes" : "summary.generated.actsNo",
        ),
      );
    }

    const reveals = getAnswer("reveals-self");
    if (reveals?.kind === "yes_no") {
      third.push(
        translate(
          reveals.value === "yes"
            ? "summary.generated.revealsYes"
            : "summary.generated.revealsNo",
        ),
      );
    }

    if (third.length > 0) {
      paragraphs.push(third.join(" "));
    }

    const qualifications: string[] = [];
    const conception = getAnswer("god-conception");
    if (conception?.kind === "single_choice") {
      const keys: Record<string, string> = {
        "impersonal-mind": "summary.generated.conceptionImpersonalMind",
        "ground-of-being": "summary.generated.conceptionGroundOfBeing",
        "force-or-principle": "summary.generated.conceptionForceOrPrinciple",
        other: "summary.generated.conceptionOther",
      };
      const key = keys[conception.optionId];
      if (key !== undefined) {
        qualifications.push(
          translate("summary.generated.conceptionSentence", {
            description: translate(key),
          }),
        );
      }
    }

    const power = getAnswer("power-limits");
    if (power?.kind === "single_choice") {
      const keys: Record<string, string> = {
        "logical-limits": "summary.generated.powerLogical",
        "self-imposed-limits": "summary.generated.powerSelfImposed",
        "external-limits": "summary.generated.powerExternal",
        other: "summary.generated.powerOther",
      };
      const key = keys[power.optionId];
      if (key !== undefined) {
        qualifications.push(
          translate("summary.generated.powerSentence", {
            description: translate(key),
          }),
        );
      }
    }

    const goodness = getAnswer("goodness-conception");
    if (goodness?.kind === "single_choice") {
      const keys: Record<string, string> = {
        "mostly-good": "summary.generated.goodnessMostlyGood",
        "morally-mixed": "summary.generated.goodnessMixed",
        "beyond-morality": "summary.generated.goodnessBeyondMorality",
        other: "summary.generated.goodnessOther",
      };
      const key = keys[goodness.optionId];
      if (key !== undefined) {
        qualifications.push(
          translate("summary.generated.goodnessSentence", {
            description: translate(key),
          }),
        );
      }
    }

    if (qualifications.length > 0) {
      paragraphs.push(qualifications.join(" "));
    }

    return paragraphs;
  });

  const reviewItems = computed(() =>
    release.questions.flatMap((question) => {
      const answer = getAnswer(question.id);
      if (answer === undefined) {
        return [];
      }

      let displayAnswer: string;
      switch (answer.kind) {
        case "yes_no":
          displayAnswer = translate(answer.value === "yes" ? "common.yes" : "common.no");
          break;
        case "likert":
          displayAnswer = `${answer.value} / ${question.scale?.max ?? answer.value}`;
          break;
        case "single_choice":
          displayAnswer =
            question.options?.find((option) => option.id === answer.optionId) !== undefined
              ? localizeContentText(
                  question.options.find((option) => option.id === answer.optionId)!.label,
                )
              : answer.optionId;
          break;
        case "special":
          displayAnswer =
            answer.value === "unsure"
              ? translate("interview.unsure")
              : answer.value === "skip"
                ? translate("summary.skipped")
                : translate("interview.preferNot");
          break;
      }

      return [
        {
          questionId: question.id,
          prompt: localizeContentText(question.prompt),
          answer: displayAnswer,
        },
      ];
    }),
  );

  return {
    release,
    sessionId,
    sessionState,
    currentQuestionId,
    currentQuestion,
    effectiveResponses,
    exposures,
    busy,
    errorMessage,
    flowComplete,
    finished,
    resumeAvailable,
    answeredBaseCount,
    answeredCount,
    progressPercent,
    summaryParagraphs,
    reviewItems,
    localizeContentText,
    getAnswer,
    getQuestion,
    startSession,
    checkResume,
    resumeLastSession,
    loadSession,
    answerCurrent,
    setQuestionForEdit,
    finishSession,
  };
});
