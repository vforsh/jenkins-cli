import { normalizeJobPath } from "./ref.ts";
import type { NormalizedBuildInfo, QueueItem, WaitEvent } from "./types.ts";

export function createQueueWaitEvent(queueId: number, item: QueueItem): WaitEvent {
	return {
		kind: "queued",
		queueId,
		jobPath: normalizeQueueJobPath(item),
		why: item.why ?? undefined,
		stuck: item.stuck ?? false,
		blocked: item.blocked ?? false,
		buildable: item.buildable ?? false,
	};
}

export function createStartedWaitEvent(
	build: Pick<NormalizedBuildInfo, "jobPath" | "number" | "url">,
	queueId?: number,
): WaitEvent {
	return {
		queueId,
		...toBuildEvent("started", build),
	};
}

export function createRunningWaitEvent(build: NormalizedBuildInfo): WaitEvent {
	return {
		...toBuildEvent("running", build),
		elapsedMs: resolveElapsedMs(build),
		estimatedDurationMs: build.estimatedDuration,
	};
}

export function createFinishedWaitEvent(build: NormalizedBuildInfo): WaitEvent {
	return {
		...toBuildEvent("finished", build),
		result: build.result,
		elapsedMs: resolveElapsedMs(build),
		estimatedDurationMs: build.estimatedDuration,
	};
}

export function queueWaitEventKey(event: WaitEvent): string {
	if (event.kind !== "queued") {
		return "";
	}

	return [
		event.queueId,
		event.jobPath ?? "",
		event.why ?? "",
		event.stuck ? "1" : "0",
		event.blocked ? "1" : "0",
		event.buildable ? "1" : "0",
	].join("|");
}

export function runningWaitEventKey(event: WaitEvent): string {
	if (event.kind !== "running") {
		return "";
	}

	return [
		event.jobPath ?? "",
		event.buildNumber ?? "",
		event.elapsedMs ?? "",
		event.estimatedDurationMs ?? "",
	].join("|");
}

function resolveElapsedMs(build: Pick<NormalizedBuildInfo, "building" | "timestamp" | "duration">): number | undefined {
	if (build.building) {
		return typeof build.timestamp === "number" ? Math.max(0, Date.now() - build.timestamp) : undefined;
	}

	return typeof build.duration === "number" ? build.duration : undefined;
}

function normalizeQueueJobPath(item: QueueItem): string | undefined {
	if (!item.task?.url) {
		return undefined;
	}

	try {
		return normalizeJobPath(item.task.url);
	} catch {
		return undefined;
	}
}

function toBuildEvent<TKind extends "started" | "running" | "finished">(
	kind: TKind,
	build: Pick<NormalizedBuildInfo, "jobPath" | "number" | "url">,
): Extract<WaitEvent, { kind: TKind }> {
	return {
		kind,
		jobPath: build.jobPath,
		buildNumber: build.number,
		buildUrl: build.url,
	} as Extract<WaitEvent, { kind: TKind }>;
}
