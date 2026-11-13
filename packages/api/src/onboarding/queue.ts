import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import { createDrizzleClient } from "@kan/db/client";
import { onboardingJobs } from "@kan/db/schema";

import { alertEmail } from "./config";
import {
  describeError,
  PermanentError,
  RetryableError,
  UncertainError,
} from "./errors";
import { resendSend } from "./resend";

// Impeesa onboarding: the job queue, kept in Postgres (onboarding_job) so it
// survives restarts and deploys. A job is taken with FOR UPDATE SKIP LOCKED,
// so two processes never run the same job; a process that dies mid-job
// leaves a lock that expires, and the job is taken again. Every job must
// therefore be safe to run twice (each handler checks what is already done
// before doing it).
//
// New jobs are run right away (kick). A timer also looks at the queue every
// 30 seconds, only to run retries whose waiting time is over and jobs left
// behind by a restart; new form answers never wait for it.

export type JobRow = {
  id: number;
  onboardingClientId: number;
  kind: string;
  dedupKey: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  result: unknown;
};

export interface JobOutcome {
  result?: Record<string, unknown>;
}

type Handler = (db: dbClient, job: JobRow) => Promise<JobOutcome>;

const handlers = new Map<string, Handler>();

export function registerHandler(kind: string, handler: Handler) {
  handlers.set(kind, handler);
}

// Waiting time before each retry: 30 s, 2 min, 10 min, 30 min, 2 h.
const BACKOFF_SECONDS = [30, 120, 600, 1800, 7200];
const LOCK_MINUTES = 5;
const WORKER_ID = `w-${randomBytes(4).toString("hex")}`;

export async function enqueueJob(
  db: dbClient,
  job: {
    onboardingClientId: number;
    kind: string;
    // Same key, same job: asking twice does nothing.
    dedupKey?: string;
    maxAttempts?: number;
  },
) {
  await db
    .insert(onboardingJobs)
    .values({
      onboardingClientId: job.onboardingClientId,
      kind: job.kind,
      dedupKey: job.dedupKey ?? `${job.onboardingClientId}:${job.kind}`,
      maxAttempts: job.maxAttempts ?? 6,
    })
    .onConflictDoNothing({ target: onboardingJobs.dedupKey });
  kickWorker();
}

async function claimNext(db: dbClient): Promise<JobRow | null> {
  const result = await db.execute<JobRow>(sql`
    UPDATE onboarding_job
       SET status = 'running',
           attempts = attempts + 1,
           "lockedBy" = ${WORKER_ID},
           "lockedUntil" = now() + make_interval(mins => ${LOCK_MINUTES}),
           "updatedAt" = now()
     WHERE id = (
       SELECT id FROM onboarding_job
        WHERE (status = 'pending' AND "nextRunAt" <= now())
           OR (status = 'running' AND "lockedUntil" < now())
        ORDER BY "nextRunAt", id
        LIMIT 1
        FOR UPDATE SKIP LOCKED)
    RETURNING id, "onboardingClientId", kind, "dedupKey", status, attempts,
              "maxAttempts", result`);
  return result.rows[0] ?? null;
}

async function finish(
  db: dbClient,
  job: JobRow,
  status: "done" | "pending" | "failed" | "uncertain",
  {
    result,
    error,
    retryInSeconds,
  }: {
    result?: Record<string, unknown>;
    error?: string;
    retryInSeconds?: number;
  },
) {
  await db.execute(sql`
    UPDATE onboarding_job
       SET status = ${status},
           "lockedBy" = NULL,
           "lockedUntil" = NULL,
           "updatedAt" = now(),
           result = COALESCE(${result ? JSON.stringify(result) : null}::jsonb, result),
           "lastError" = ${error ?? null},
           "doneAt" = CASE WHEN ${status} = 'done' THEN now() ELSE "doneAt" END,
           "nextRunAt" = now() + make_interval(secs => ${retryInSeconds ?? 0})
     WHERE id = ${job.id} AND "lockedBy" = ${WORKER_ID}`);
}

async function runJob(db: dbClient, job: JobRow) {
  const handler = handlers.get(job.kind);
  if (!handler) {
    await finish(db, job, "failed", { error: `Paso desconocido: ${job.kind}` });
    return;
  }

  try {
    const outcome = await handler(db, job);
    await finish(db, job, "done", { result: outcome.result });
  } catch (error) {
    const message = describeError(error);
    if (error instanceof UncertainError) {
      await finish(db, job, "uncertain", { error: message });
      await alert(job, "quedó sin confirmar", message);
    } else if (
      error instanceof PermanentError ||
      job.attempts >= job.maxAttempts
    ) {
      await finish(db, job, "failed", { error: message });
      await alert(job, "falló", message);
    } else {
      // RetryableError or anything unexpected: wait and try again.
      const wait =
        BACKOFF_SECONDS[Math.min(job.attempts - 1, BACKOFF_SECONDS.length - 1)];
      await finish(db, job, "pending", {
        error: message,
        retryInSeconds: wait,
      });
      if (!(error instanceof RetryableError))
        console.error(`[onboarding] job ${job.id} (${job.kind})`, message);
    }
  }
}

// One email per job that stops: failed or uncertain. Never throws.
async function alert(job: JobRow, what: string, message: string) {
  try {
    await resendSend({
      to: alertEmail(),
      subject: `[Panel · Onboarding] Un paso ${what}: ${job.kind}`,
      html: `<p>El paso <strong>${job.kind}</strong> del onboarding ${what} después de ${job.attempts} intento(s).</p>
<p>Error: ${message.replace(/[<>&]/g, "")}</p>
<p>Lo ya hecho se conserva. Desde la sección Forms del panel podés ver el estado y reintentar solo lo pendiente.</p>`,
      idempotencyKey: `onb-alert-${job.id}-${job.attempts}`,
    });
  } catch (error) {
    console.error(
      "[onboarding] no se pudo mandar el aviso",
      describeError(error),
    );
  }
}

// Puts a stopped job (failed or uncertain) back in the queue. For an
// uncertain one, the person retrying it has checked it didn't happen.
export async function retryJob(db: dbClient, jobId: number) {
  const result = await db.execute(sql`
    UPDATE onboarding_job
       SET status = 'pending', attempts = 0, "nextRunAt" = now(),
           "lastError" = NULL, "updatedAt" = now()
     WHERE id = ${jobId} AND status IN ('failed', 'uncertain')
    RETURNING id`);
  kickWorker();
  return result.rows.length > 0;
}

// --- Worker -------------------------------------------------------------

const state = globalThis as unknown as {
  __onboardingWorker?: {
    db: dbClient;
    draining: boolean;
    again: boolean;
  };
};

function worker() {
  if (!state.__onboardingWorker) {
    const db = createDrizzleClient();
    state.__onboardingWorker = { db, draining: false, again: false };
    const timer = setInterval(() => void drain(), 30_000);
    timer.unref();
  }
  return state.__onboardingWorker;
}

async function drain() {
  const w = worker();
  if (w.draining) {
    w.again = true;
    return;
  }
  w.draining = true;
  try {
    do {
      w.again = false;
      for (;;) {
        const job = await claimNext(w.db);
        if (!job) break;
        await runJob(w.db, job);
      }
    } while (w.again);
  } catch (error) {
    console.error("[onboarding] la cola se detuvo", describeError(error));
  } finally {
    w.draining = false;
  }
}

// Starts the worker if needed and runs whatever is due. Safe to call often.
export function kickWorker() {
  if (process.env.ONBOARDING_WORKER === "off") return;
  setImmediate(() => void drain());
}
