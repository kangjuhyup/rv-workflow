import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { defaultTaskProgressStateDirectory } from "./task-progress-service.js";

const INSTANCE_VERSION = 1;
const LAUNCH_RESERVATION_TTL_MS = 30_000;

interface LaunchingInstanceRecord {
  version: typeof INSTANCE_VERSION;
  state: "launching";
  token: string;
  createdAt: number;
}

interface RunningInstanceRecord {
  version: typeof INSTANCE_VERSION;
  state: "running";
  token: string;
  createdAt: number;
  pid: number;
}

type InstanceRecord = LaunchingInstanceRecord | RunningInstanceRecord;

export interface ProgressPanelReservation {
  filePath: string;
  token: string;
}

export type ProgressPanelReservationResult =
  | { state: "already_running" }
  | { state: "reserved"; reservation: ProgressPanelReservation };

export interface ReserveProgressPanelOptions {
  workspaceRoot: string;
  stateDirectory?: string;
  instanceDirectory?: string;
  now?: number;
}

export interface ProgressPanelLease {
  release(): Promise<void>;
}

function instanceKey(workspaceRoot: string): string {
  return createHash("sha256").update(resolve(workspaceRoot)).digest("hex");
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function isRecord(value: unknown): value is InstanceRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<InstanceRecord>;
  if (
    record.version !== INSTANCE_VERSION
    || (record.state !== "launching" && record.state !== "running")
    || typeof record.token !== "string"
    || typeof record.createdAt !== "number"
  ) return false;
  if (record.state === "launching") return true;
  const pid = (record as Partial<RunningInstanceRecord>).pid;
  return typeof pid === "number" && Number.isSafeInteger(pid) && pid > 0;
}

async function readRecord(filePath: string): Promise<InstanceRecord | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(filePath, "utf8"));
    return isRecord(value) ? value : undefined;
  } catch (error) {
    if (isNodeError(error, "ENOENT") || error instanceof SyntaxError) return undefined;
    throw error;
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isNodeError(error, "EPERM");
  }
}

function recordIsActive(record: InstanceRecord, now: number): boolean {
  if (record.state === "running") return processIsAlive(record.pid);
  return now - record.createdAt < LAUNCH_RESERVATION_TTL_MS;
}

async function removeIfOwned(filePath: string, token: string): Promise<void> {
  const record = await readRecord(filePath);
  if (record?.token !== token) return;
  try {
    await unlink(filePath);
  } catch (error) {
    if (!isNodeError(error, "ENOENT")) throw error;
  }
}

async function replaceRecord(filePath: string, record: InstanceRecord): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(record)}\n`, { flag: "wx", mode: 0o600 });
  try {
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export async function reserveProgressPanel(
  options: ReserveProgressPanelOptions,
): Promise<ProgressPanelReservationResult> {
  const stateDirectory = resolve(options.stateDirectory ?? defaultTaskProgressStateDirectory());
  const instanceDirectory = options.instanceDirectory ?? join(stateDirectory, "panels");
  await mkdir(instanceDirectory, { recursive: true, mode: 0o700 });
  const filePath = join(instanceDirectory, `${instanceKey(options.workspaceRoot)}.json`);
  const now = options.now ?? Date.now();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const existing = await readRecord(filePath);
    if (existing && recordIsActive(existing, now)) return { state: "already_running" };
    if (existing) await removeIfOwned(filePath, existing.token);
    else await unlink(filePath).catch((error: unknown) => {
      if (!isNodeError(error, "ENOENT")) throw error;
    });

    const token = randomUUID();
    const record: LaunchingInstanceRecord = {
      version: INSTANCE_VERSION,
      state: "launching",
      token,
      createdAt: now,
    };
    try {
      await writeFile(filePath, `${JSON.stringify(record)}\n`, { flag: "wx", mode: 0o600 });
      return { state: "reserved", reservation: { filePath, token } };
    } catch (error) {
      if (!isNodeError(error, "EEXIST")) throw error;
    }
  }

  return { state: "already_running" };
}

export async function releaseProgressPanelReservation(
  reservation: ProgressPanelReservation,
): Promise<void> {
  await removeIfOwned(reservation.filePath, reservation.token);
}

export async function claimProgressPanel(
  reservation: ProgressPanelReservation,
): Promise<ProgressPanelLease | undefined> {
  const record = await readRecord(reservation.filePath);
  if (record?.state !== "launching" || record.token !== reservation.token) return undefined;

  const running: RunningInstanceRecord = {
    ...record,
    state: "running",
    pid: process.pid,
  };
  await replaceRecord(reservation.filePath, running);
  return {
    async release() {
      await removeIfOwned(reservation.filePath, reservation.token);
    },
  };
}
