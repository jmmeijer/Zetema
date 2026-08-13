import YAML from "yaml";
import { currentLocale, type SupportedLocale } from "../../../i18n";

type NoticeMap = Readonly<Record<string, string>>;

export function participantNoticeText(key: string): string {
  void currentLocale.value;
  return key;
}
