<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";

interface ClarificationOption {
  id: string;
  label: string;
}

const props = defineProps<{
  statements: readonly string[];
  options: readonly ClarificationOption[];
}>();

const emit = defineEmits<{
  select: [optionId: string];
  skip: [];
}>();

const { t } = useI18n();
const selected = ref<string | null>(null);

function continueWithSelection(): void {
  if (selected.value !== null) {
    emit("select", selected.value);
  }
}
</script>

<template>
  <section class="clarification-panel">
    <p class="eyebrow">{{ t("clarification.title") }}</p>
    <h1>{{ t("clarification.title") }}</h1>
    <p class="lead">{{ t("clarification.intro") }}</p>

    <div class="statement-stack">
      <blockquote v-for="statement in props.statements" :key="statement" class="statement-card">
        “{{ statement }}”
      </blockquote>
    </div>

    <p class="clarification-question">{{ t("clarification.tension") }}</p>

    <div class="choice-list">
      <label
        v-for="option in props.options"
        :key="option.id"
        class="choice-row"
        :class="{ selected: selected === option.id }"
      >
        <input v-model="selected" type="radio" :value="option.id" />
        <span>{{ option.label }}</span>
      </label>
    </div>

    <button
      class="button button-primary button-large"
      type="button"
      :disabled="selected === null"
      @click="continueWithSelection"
    >
      {{ t("clarification.continue") }} <span aria-hidden="true">→</span>
    </button>
    <button class="text-button clarification-skip" type="button" @click="emit('skip')">
      {{ t("interview.skip") }}
    </button>
  </section>
</template>
