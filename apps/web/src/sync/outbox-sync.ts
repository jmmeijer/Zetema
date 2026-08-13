import {
  IndexedDbLocalStore,
  type AppendResponseRevisionOutboxCommand,
  type FinalizeInterviewSessionOutboxCommand,
  type OutboxCommand,
  type StartInterviewSessionOutboxCommand,
} from "@zetema/sync-engine";

import type { FirebaseCommandGateway } from "../firebase/client";

export type BrowserSyncStatus = "idle" | "syncing" | "offline" | "error";

export interface BrowserSyncState {
  status: BrowserSyncStatus;
  pendingCommands: number;
  lastSuccessfulSyncAt?: string;
  lastError?: string;
}

export type BrowserSyncStateListener = (state: BrowserSyncState) => void;

const localStore = new IndexedDbLocalStore();

function now(): string {
  return new Date().toISOString();
}

async function sendCommand(gateway: FirebaseCommandGateway, command: OutboxCommand): Promise<number | undefined> {
  switch (command.command) {
    case "start_interview_session":
      await gateway.startInterviewSession(toStartRequest(command));
      return undefined;
    case "append_response_revision": {
      const result = await gateway.appendResponseRevision(toAppendRequest(command));
      return result.serverSequence;
    }
    case "finalize_interview_session":
      await gateway.finalizeInterviewSession(toFinalizeRequest(command));
      return undefined;
  }
}

function toStartRequest(command: StartInterviewSessionOutboxCommand) {
  const { eligibility, consent } = command.payload;
  if (eligibility === undefined || consent === undefined) {
    throw new Error(
      "This legacy local session was created before participant consent evidence was required and cannot start server synchronization.",
    );
  }

  return {
    sessionId: command.sessionId,
    operationId: command.operationId,
    contentReleaseId: command.payload.contentReleaseId,
    startedAt: command.payload.startedAt,
    eligibility,
    consent,
  };
}

function toAppendRequest(command: AppendResponseRevisionOutboxCommand) {
  return {
    sessionId: command.sessionId,
    operationId: command.operationId,
    revisionId: command.payload.revisionId,
    questionId: command.payload.questionId,
    answer: command.payload.answer,
    clientCreatedAt: command.payload.clientCreatedAt,
  };
}

function toFinalizeRequest(command: FinalizeInterviewSessionOutboxCommand) {
  return {
    sessionId: command.sessionId,
    operationId: command.operationId,
    mode: command.payload.mode,
    completedAt: command.payload.completedAt,
  };
}

function withLastSuccessfulSyncAt(
  state: Omit<BrowserSyncState, "lastSuccessfulSyncAt">,
  lastSuccessfulSyncAt: string | undefined,
): BrowserSyncState {
  return lastSuccessfulSyncAt === undefined
    ? state
    : { ...state, lastSuccessfulSyncAt };
}

export class BrowserOutboxSync {
  private readonly gateway: FirebaseCommandGateway;
  private readonly listeners = new Set<BrowserSyncStateListener>();
  private running: Promise<void> | undefined;
  private timer: number | undefined;
  private state: BrowserSyncState = { status: "idle", pendingCommands: 0 };

  constructor(gateway: FirebaseCommandGateway) {
    this.gateway = gateway;
  }

  subscribe(listener: BrowserSyncStateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    window.addEventListener("online", this.handleOnline);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    this.timer = window.setInterval(() => void this.syncNow(), 5_000);
    void this.syncNow();
  }

  stop(): void {
    window.removeEventListener("online", this.handleOnline);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    if (this.timer !== undefined) {
      window.clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  syncNow(): Promise<void> {
    if (this.running !== undefined) {
      return this.running;
    }

    this.running = this.performSync().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private readonly handleOnline = (): void => {
    void this.syncNow();
  };

  private readonly handleVisibilityChange = (): void => {
    if (document.visibilityState === "visible") {
      void this.syncNow();
    }
  };

  private async performSync(): Promise<void> {
    const allCommands = await localStore.listOutbox();
    const pending = await this.commandsAfterAcknowledgement(allCommands);

    if (pending.length === 0) {
      this.publish(
        withLastSuccessfulSyncAt(
          {
            status: navigator.onLine ? "idle" : "offline",
            pendingCommands: 0,
          },
          this.state.lastSuccessfulSyncAt,
        ),
      );
      return;
    }

    if (!navigator.onLine) {
      this.publish(
        withLastSuccessfulSyncAt(
          {
            status: "offline",
            pendingCommands: pending.length,
          },
          this.state.lastSuccessfulSyncAt,
        ),
      );
      return;
    }

    this.publish(
      withLastSuccessfulSyncAt(
        {
          status: "syncing",
          pendingCommands: pending.length,
        },
        this.state.lastSuccessfulSyncAt,
      ),
    );

    try {
      await this.gateway.ensureAuthenticatedUser();

      let remaining = pending.length;
      for (const command of pending) {
        const metadata = await localStore.getSyncMetadata(command.sessionId);
        const acknowledged = metadata?.highestAcknowledgedLocalSequence ?? 0;
        if (command.localSequence <= acknowledged) {
          remaining -= 1;
          continue;
        }

        const serverSequence = await sendCommand(this.gateway, command);
        const syncedAt = now();
        const highestServerSequence = serverSequence ?? metadata?.highestServerSequence;
        await localStore.putSyncMetadata({
          sessionId: command.sessionId,
          highestAcknowledgedLocalSequence: command.localSequence,
          ...(highestServerSequence === undefined ? {} : { highestServerSequence }),
          lastSuccessfulSyncAt: syncedAt,
        });
        remaining -= 1;
        this.publish({
          status: remaining === 0 ? "idle" : "syncing",
          pendingCommands: remaining,
          lastSuccessfulSyncAt: syncedAt,
        });
      }
    } catch (error) {
      this.publish(
        withLastSuccessfulSyncAt(
          {
            status: navigator.onLine ? "error" : "offline",
            pendingCommands: pending.length,
            lastError: error instanceof Error ? error.message : "Synchronization failed.",
          },
          this.state.lastSuccessfulSyncAt,
        ),
      );
    }
  }

  private async commandsAfterAcknowledgement(commands: readonly OutboxCommand[]): Promise<OutboxCommand[]> {
    const metadataBySession = new Map<string, number>();
    const pending: OutboxCommand[] = [];

    for (const command of commands) {
      let acknowledged = metadataBySession.get(command.sessionId);
      if (acknowledged === undefined) {
        acknowledged =
          (await localStore.getSyncMetadata(command.sessionId))?.highestAcknowledgedLocalSequence ?? 0;
        metadataBySession.set(command.sessionId, acknowledged);
      }
      if (command.localSequence > acknowledged) {
        pending.push(command);
      }
    }

    return pending;
  }

  private publish(state: BrowserSyncState): void {
    this.state = state;
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}
