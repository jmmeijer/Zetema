import YAML from "yaml";
import { currentLocale, type SupportedLocale } from "../../../i18n";
import enSource from "./en.yaml?raw";
import nlAgeSource from "./nl-age.yaml?raw";
import nlDataSource from "./nl-data.yaml?raw";
import nlChoiceSource from "./nl-choice.yaml?raw";
import nlAcceptanceSource from "./nl-acceptance.yaml?raw";
import nlOutcomeSource from "./nl-outcome.yaml?raw";
import roAgeSource from "./ro-age.yaml?raw";
import roDataSource from "./ro-data.yaml?raw";
import roExtraSource from "./ro-extra.yaml?raw";
import roActionsSource from "./ro-actions.yaml?raw";
import roStatusSource from "./ro-status.yaml?raw";

type NoticeMap = Readonly<Record<string, string>>;

function parseMap(source: string, label: string): NoticeMap {
  const parsed = YAML.parse(source) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Preflight text '${label}' must be a key/value mapping.`);
  }

  const messages: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`Preflight text '${label}.${key}' must be a non-empty string.`);
    }
    messages[key] = value;
  }
  return messages;
}

function mergeMaps(label: string, sources: readonly string[]): NoticeMap {
  return Object.assign({}, ...sources.map((source, index) => parseMap(source, `${label}.${index + 1}`)));
}

const notices: Record<SupportedLocale, NoticeMap> = {
  en: parseMap(enSource, "en"),
  nl: mergeMaps("nl", [nlAgeSource, nlDataSource, nlChoiceSource, nlAcceptanceSource, nlOutcomeSource]),
  ro: mergeMaps("ro", [roAgeSource, roDataSource, roExtraSource, roActionsSource, roStatusSource]),
};

export function participantNoticeText(
  key: string,
  named: Readonly<Record<string, string | number>> = {},
): string {
  void currentLocale.value;
  const template = notices[currentLocale.value][key] ?? notices.en[key] ?? key;
  return Object.entries(named).reduce(
    (message, [name, value]) => message.replaceAll(`{${name}}`, String(value)),
    template,
  );
}
