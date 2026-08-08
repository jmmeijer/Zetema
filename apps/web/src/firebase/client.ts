import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  signInAnonymously,
  type Auth,
  type User,
} from "firebase/auth";
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  type AppCheck,
} from "firebase/app-check";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
  type Functions,
} from "firebase/functions";

import type {
  AppendResponseRevisionRequest,
  AppendResponseRevisionResult,
  FinalizeInterviewSessionRequest,
  FinalizeInterviewSessionResult,
  StartInterviewSessionRequest,
  StartInterviewSessionResult,
} from "@zetema/shared-types";

interface FirebaseEnvironment {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  functionsRegion: string;
  appCheckSiteKey: string;
  appCheckDebug: boolean;
  useEmulators: boolean;
}

export interface FirebaseCommandGateway {
  ensureAuthenticatedUser(): Promise<User>;
  startInterviewSession(command: StartInterviewSessionRequest): Promise<StartInterviewSessionResult>;
  appendResponseRevision(command: AppendResponseRevisionRequest): Promise<AppendResponseRevisionResult>;
  finalizeInterviewSession(command: FinalizeInterviewSessionRequest): Promise<FinalizeInterviewSessionResult>;
}

function requiredEnvironmentValue(name: string): string {
  const value = import.meta.env[name] as string | undefined;
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Missing required Firebase environment variable '${name}'.`);
  }
  return value.trim();
}

function readEnvironment(): FirebaseEnvironment {
  return {
    apiKey: requiredEnvironmentValue("VITE_FIREBASE_API_KEY"),
    authDomain: requiredEnvironmentValue("VITE_FIREBASE_AUTH_DOMAIN"),
    projectId: requiredEnvironmentValue("VITE_FIREBASE_PROJECT_ID"),
    storageBucket: requiredEnvironmentValue("VITE_FIREBASE_STORAGE_BUCKET"),
    messagingSenderId: requiredEnvironmentValue("VITE_FIREBASE_MESSAGING_SENDER_ID"),
    appId: requiredEnvironmentValue("VITE_FIREBASE_APP_ID"),
    functionsRegion:
      (import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION as string | undefined)?.trim() || "us-central1",
    appCheckSiteKey:
      (import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY as string | undefined)?.trim() ?? "",
    appCheckDebug: import.meta.env.VITE_FIREBASE_APPCHECK_DEBUG === "true",
    useEmulators: import.meta.env.VITE_FIREBASE_USE_EMULATORS === "true",
  };
}

function initializeAppCheckForEnvironment(app: FirebaseApp, environment: FirebaseEnvironment): AppCheck | undefined {
  if (environment.useEmulators && environment.appCheckSiteKey.length === 0) {
    return undefined;
  }

  if (environment.appCheckSiteKey.length === 0) {
    throw new Error(
      "VITE_FIREBASE_APPCHECK_SITE_KEY is required when calling the deployed command gateway.",
    );
  }

  if (environment.appCheckDebug) {
    Object.assign(globalThis, { FIREBASE_APPCHECK_DEBUG_TOKEN: true });
  }

  return initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(environment.appCheckSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
}

export function createFirebaseCommandGateway(): FirebaseCommandGateway {
  const environment = readEnvironment();
  const app = initializeApp({
    apiKey: environment.apiKey,
    authDomain: environment.authDomain,
    projectId: environment.projectId,
    storageBucket: environment.storageBucket,
    messagingSenderId: environment.messagingSenderId,
    appId: environment.appId,
  });

  const auth: Auth = getAuth(app);
  const functions: Functions = getFunctions(app, environment.functionsRegion);

  if (environment.useEmulators) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  }

  initializeAppCheckForEnvironment(app, environment);

  const startCallable = httpsCallable<StartInterviewSessionRequest, StartInterviewSessionResult>(
    functions,
    "startInterviewSession",
  );
  const appendCallable = httpsCallable<AppendResponseRevisionRequest, AppendResponseRevisionResult>(
    functions,
    "appendResponseRevision",
  );
  const finalizeCallable = httpsCallable<FinalizeInterviewSessionRequest, FinalizeInterviewSessionResult>(
    functions,
    "finalizeInterviewSession",
  );

  async function ensureAuthenticatedUser(): Promise<User> {
    if (auth.currentUser !== null) {
      return auth.currentUser;
    }

    const credential = await signInAnonymously(auth);
    return credential.user;
  }

  return {
    ensureAuthenticatedUser,
    async startInterviewSession(command) {
      await ensureAuthenticatedUser();
      return (await startCallable(command)).data;
    },
    async appendResponseRevision(command) {
      await ensureAuthenticatedUser();
      return (await appendCallable(command)).data;
    },
    async finalizeInterviewSession(command) {
      await ensureAuthenticatedUser();
      return (await finalizeCallable(command)).data;
    },
  };
}
