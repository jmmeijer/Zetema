<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";

import type { StructuredAnswer } from "@zetema/domain";
import zetemaLogoSymbol from "../assets/brand/zetema-logo-organic";
import LanguageSelector from "../components/LanguageSelector.vue";
import { useInterviewStore } from "../stores/interview";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const interview = useInterviewStore();

const selectedOptionId = ref<string | null>(null);
const selectedLikert = ref<number | null>(null);

const sessionId = computed(() => String(route.params.sessionId));
const editingQuestionId = computed(() =>
  typeof route.query.edit === "string" ? route.query.edit : null,
);
const likertValues = computed(() => {
  const scale = interview.currentQuestion?.scale;
  if (scale === undefined) {
    return [];
  }
  return Array.from({ length: scale.max - scale.min + 1 }, (_, index) => scale.min + index);
});

function syncSelection(): void {
  selectedOptionId.value = null;
  selectedLikert.value = null;

  const questionId = interview.currentQuestionId;
  if (questionId === null) {
    return;
  }

  const answer = interview.getAnswer(questionId);
  if (answer?.kind === "single_choice") {
    selectedOptionId.value = answer.optionId;
  } else if (answer?.kind === "likert") {
    selectedLikert.value = answer.value;
  }
}

watch(() => interview.currentQuestionId, syncSelection);

onMounted(async () => {
  try {
    await interview.loadSession(sessionId.value);

    if (editingQuestionId.value !== null) {
      interview.setQuestionForEdit(editingQuestionId.value);
      syncSelection();
      return;
    }

    if (interview.flowComplete) {
      await router.replace({ name: "summary", params: { sessionId: sessionId.value } });
    }
  } catch {
    // The store exposes a user-facing error message.
  }
});

async function submit(answer: StructuredAnswer): Promise<void> {
  try {
    const wasEditing = editingQuestionId.value !== null;
    await interview.answerCurrent(answer);

    if (interview.flowComplete) {
      await router.replace({ name: "summary", params: { sessionId: sessionId.value } });
      return;
    }

    if (wasEditing) {
      await router.replace({ name: "interview", params: { sessionId: sessionId.value } });
    }
  } catch {
    // The store exposes a user-facing error message.
  }
}

async function submitSelected(): Promise<void> {
  const question = interview.currentQuestion;
  if (question?.type === "single_choice" && selectedOptionId.value !== null) {
    await submit({ kind: "single_choice", optionId: selectedOptionId.value });
  } else if (question?.type === "likert" && selectedLikert.value !== null) {
    await submit({ kind: "likert", value: selectedLikert.value });
  }
}
</script>

<template>
  <main class="page interview-page">
    <header class="app-header">
      <RouterLink class="brand-inline" to="/" :aria-label="t('common.homeLabel')">
        <img class="brand-symbol brand-symbol-small" :src="zetemaLogoSymbol" alt="" aria-hidden="true" />
        <span>{{ t("brand.name") }}</span>
      </RouterLink>
      <LanguageSelector />
    </header>

    <section class="content-shell">
      <div class="theme-progress">
        <div class="theme-progress-labels">
          <span>{{ interview.localizeContentText(interview.release.theme.title) }}</span>
          <span class="muted">{{ interview.progressPercent }}%</span>
        </div>
        <div class="progress-track" :aria-label="t('interview.progressLabel')">
          <span class="progress-value" :style="{ width: `${interview.progressPercent}%` }" />
        </div>
      </div>

      <div v-if="interview.busy && !interview.currentQuestion" class="status-card">
        {{ t("interview.loading") }}
      </div>

      <section v-else-if="interview.currentQuestion" class="question-card">
        <button
          v-if="editingQuestionId"
          class="text-button back-link"
          type="button"
          @click="router.push({ name: 'summary', params: { sessionId } })"
        >
          ← {{ t("interview.back") }}
        </button>

        <p v-if="editingQuestionId" class="eyebrow">{{ t("interview.reviewing") }}</p>
        <h1 class="question-title">
          {{ interview.localizeContentText(interview.currentQuestion.prompt) }}
        </h1>

        <div v-if="interview.currentQuestion.type === 'yes_no'" class="yes-no-grid">
          <button
            class="answer-button"
            type="button"
            :disabled="interview.busy"
            @click="submit({ kind: 'yes_no', value: 'yes' })"
          >
            {{ t("common.yes") }}
          </button>
          <button
            class="answer-button"
            type="button"
            :disabled="interview.busy"
            @click="submit({ kind: 'yes_no', value: 'no' })"
          >
            {{ t("common.no") }}
          </button>
        </div>

        <div v-else-if="interview.currentQuestion.type === 'single_choice'" class="choice-list">
          <label
            v-for="option in interview.currentQuestion.options ?? []"
            :key="option.id"
            class="choice-row"
            :class="{ selected: selectedOptionId === option.id }"
          >
            <input v-model="selectedOptionId" type="radio" :value="option.id" />
            <span>{{ interview.localizeContentText(option.label) }}</span>
          </label>
        </div>

        <div v-else-if="interview.currentQuestion.type === 'likert'" class="likert-block">
          <div class="likert-labels">
            <span v-if="interview.currentQuestion.scale">
              {{ interview.localizeContentText(interview.currentQuestion.scale.lowLabel) }}
            </span>
            <span v-if="interview.currentQuestion.scale">
              {{ interview.localizeContentText(interview.currentQuestion.scale.highLabel) }}
            </span>
          </div>
          <div class="likert-options">
            <label
              v-for="value in likertValues"
              :key="value"
              class="likert-option"
              :class="{ selected: selectedLikert === value }"
            >
              <input v-model="selectedLikert" type="radio" :value="value" />
              <span>{{ value }}</span>
            </label>
          </div>
        </div>

        <button
          v-if="interview.currentQuestion.type !== 'yes_no'"
          class="button button-primary button-large"
          type="button"
          :disabled="interview.busy || (selectedOptionId === null && selectedLikert === null)"
          @click="submitSelected"
        >
          {{ t("interview.continue") }} <span aria-hidden="true">→</span>
        </button>

        <button
          class="button button-quiet"
          type="button"
          :disabled="interview.busy"
          @click="submit({ kind: 'special', value: 'unsure' })"
        >
          {{ t("interview.unsure") }}
        </button>

        <div class="escape-actions">
          <button
            class="text-button"
            type="button"
            :disabled="interview.busy"
            @click="submit({ kind: 'special', value: 'skip' })"
          >
            {{ t("interview.skip") }}
          </button>
          <button
            class="text-button muted"
            type="button"
            :disabled="interview.busy"
            @click="submit({ kind: 'special', value: 'prefer_not_to_answer' })"
          >
            {{ t("interview.preferNot") }}
          </button>
        </div>

        <p v-if="interview.errorMessage" class="error-message" role="alert">
          {{ interview.errorMessage }}
        </p>
      </section>

      <section v-else-if="interview.errorMessage" class="status-card error-message" role="alert">
        {{ interview.errorMessage }}
      </section>
    </section>
  </main>
</template>
