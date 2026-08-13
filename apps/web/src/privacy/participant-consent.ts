import type {
  AdultEligibilityDeclaration,
  ParticipationConsentAcceptance,
} from "@zetema/domain";

export const PARTICIPATION_PURPOSE_ID = "mvp-0.2-interview-participation-v1";
export const PARTICIPANT_NOTICE_VERSION = "2026.08.1";
export const PARTICIPATION_SCOPE = "INTERVIEW_STORAGE";

export interface ParticipantPreflightEvidence {
  eligibility: AdultEligibilityDeclaration;
  consent: ParticipationConsentAcceptance;
}

export function createParticipantPreflightEvidence(
  ageConfirmedAt: string,
  consentAcceptedAt: string,
): ParticipantPreflightEvidence {
  return {
    eligibility: {
      minimumAge: 18,
      declaration: "age_18_or_over",
      confirmedAt: ageConfirmedAt,
    },
    consent: {
      purposeId: PARTICIPATION_PURPOSE_ID,
      textVersion: PARTICIPANT_NOTICE_VERSION,
      scopes: [PARTICIPATION_SCOPE],
      mechanism: "in_app_explicit",
      acceptedAt: consentAcceptedAt,
    },
  };
}
