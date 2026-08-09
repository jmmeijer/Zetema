<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

import {
  currentLocale,
  localeOptions,
  setLocale,
  type SupportedLocale,
} from "../i18n";

const { t } = useI18n();

const selectedLocale = computed({
  get: () => currentLocale.value as SupportedLocale,
  set: (locale: SupportedLocale) => setLocale(locale),
});
</script>

<template>
  <label class="language-selector">
    <span aria-hidden="true">◎</span>
    <select v-model="selectedLocale" :aria-label="t('common.language')">
      <option
        v-for="option in localeOptions"
        :key="option.value"
        :value="option.value"
        :title="option.nativeName"
      >
        {{ option.code }}
      </option>
    </select>
  </label>
</template>
