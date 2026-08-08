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
  if (items.length === 0) {
    return "";
  }
  if (items.length === 1) {
    return items[0] ?? "";
  }
  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`;
  }
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
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
      throw new Error("No interview session is loaded.");
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
      errorMessage.value = error instanceof Error ? error.message : "Unable to load this session.";
      throw error;
    } finally {
      busy.value = false;
    }
  }

  async function answerCurrent(answer: StructuredAnswer): Promise<void> {
    if (sessionId.value === null || currentQuestionId.value === null) {
      throw new Error("No active question is available.");
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
      errorMessage.value = error instanceof Error ? error.message : "Unable to save this answer.";
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
      throw new Error("The interview cannot be finished yet.");
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
        existence.value === "yes"
          ? "You believe that God exists."
          : "You do not believe that God exists.",
      );
    } else if (existence?.kind === "special" && existence.value === "unsure") {
      first.push("You are unsure whether God exists.");
    }

    const confidence = getAnswer("existence-confidence");
    if (confidence?.kind === "likert") {
      const labels: Record<number, string> = {
        1: "very low",
        2: "low",
        3: "moderate",
        4: "fairly high",
        5: "very high",
      };
      first.push(`Your confidence in that answer is ${labels[confidence.value] ?? "moderate"}.`);
    } else if (confidence?.kind === "special" && confidence.value === "unsure") {
      first.push("You are unsure how confident you are in that answer.");
    }

    const personal = getAnswer("personal-god");
    if (personal?.kind === "yes_no") {
      first.push(
        personal.value === "yes"
          ? "You understand God as a personal being who can have intentions and relationships."
          : "You do not understand God as a personal being who can have intentions and relationships.",
      );
    } else if (personal?.kind === "special" && personal.value === "unsure") {
      first.push("You are unsure whether God should be understood as a personal being.");
    }

    if (first.length > 0) {
      paragraphs.push(first.join(" "));
    }

    const attributes = [
      ["omnipotent", "maximally powerful"],
      ["omniscient", "all-knowing"],
      ["omnipresent", "omnipresent"],
      ["perfectly-good", "perfectly good"],
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
      second.push(`Among the attributes considered here, you describe God as ${naturalList(affirmed)}.`);
    }
    if (rejected.length > 0) {
      second.push(`You do not describe God as ${naturalList(rejected)}.`);
    }
    if (uncertain.length > 0) {
      second.push(`You are unsure whether ${naturalList(uncertain)} applies to God.`);
    }
    if (second.length > 0) {
      paragraphs.push(second.join(" "));
    }

    const third: string[] = [];
    const time = getAnswer("relation-to-time");
    if (time?.kind === "single_choice") {
      const timeText: Record<string, string> = {
        "outside-time": "You think God exists outside time.",
        "within-time": "You think God exists within time.",
        both: "You think God relates to time in both ways, in some sense.",
        other: "You hold another view about how God relates to time.",
      };
      const text = timeText[time.optionId];
      if (text !== undefined) {
        third.push(text);
      }
    } else if (time?.kind === "special" && time.value === "unsure") {
      third.push("You are unsure how God relates to time.");
    }

    const acts = getAnswer("acts-in-world");
    if (acts?.kind === "yes_no") {
      third.push(
        acts.value === "yes"
          ? "You think God acts within the world in ways that can affect events."
          : "You do not think God acts within the world in ways that affect events.",
      );
    }

    const reveals = getAnswer("reveals-self");
    if (reveals?.kind === "yes_no") {
      third.push(
        reveals.value === "yes"
          ? "You think God can intentionally reveal information about himself to people."
          : "You do not think God intentionally reveals information about himself to people.",
      );
    }

    if (third.length > 0) {
      paragraphs.push(third.join(" "));
    }

    const qualifications: string[] = [];
    const conception = getAnswer("god-conception");
    if (conception?.kind === "single_choice") {
      const texts: Record<string, string> = {
        "impersonal-mind": "an impersonal mind or intelligence",
        "ground-of-being": "the ground or foundation of existence",
        "force-or-principle": "an impersonal force or principle",
        other: "another conception",
      };
      const text = texts[conception.optionId];
      if (text !== undefined) {
        qualifications.push(`When describing a non-personal God, ${text} comes closest to your view.`);
      }
    }

    const power = getAnswer("power-limits");
    if (power?.kind === "single_choice") {
      const texts: Record<string, string> = {
        "logical-limits": "God cannot do what is logically impossible",
        "self-imposed-limits": "God can voluntarily limit his own power",
        "external-limits": "something outside God can limit his power",
        other: "you understand limits on God's power in another way",
      };
      const text = texts[power.optionId];
      if (text !== undefined) {
        qualifications.push(`Regarding limits on God's power, your view is that ${text}.`);
      }
    }

    const goodness = getAnswer("goodness-conception");
    if (goodness?.kind === "single_choice") {
      const texts: Record<string, string> = {
        "mostly-good": "God is good, but not perfectly good",
        "morally-mixed": "God can be both morally good and morally bad",
        "beyond-morality": "human moral categories do not apply to God",
        other: "you understand God's moral character in another way",
      };
      const text = texts[goodness.optionId];
      if (text !== undefined) {
        qualifications.push(`Regarding God's moral character, your view is that ${text}.`);
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
          displayAnswer = answer.value === "yes" ? "Yes" : "No";
          break;
        case "likert":
          displayAnswer = `${answer.value} / ${question.scale?.max ?? answer.value}`;
          break;
        case "single_choice":
          displayAnswer =
            question.options?.find((option) => option.id === answer.optionId)?.label.source ??
            answer.optionId;
          break;
        case "special":
          displayAnswer =
            answer.value === "unsure"
              ? "I'm unsure"
              : answer.value === "skip"
                ? "Skipped"
                : "Prefer not to answer";
          break;
      }

      return [
        {
          questionId: question.id,
          prompt: question.prompt.source,
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
