import type { WaitEvent } from "../jenkins/types.ts";
import { status } from "./io.ts";
import type { CliContext } from "./types.ts";

export function createWaitProgressReporter(
	ctx: CliContext,
	enabled: boolean,
): ((event: WaitEvent) => void) | undefined {
	if (!enabled) {
		return undefined;
	}

	return (event) => {
		status(ctx, formatWaitEvent(event));
	};
}

/**
 * Keep progress lines short and phase-based so they read like a timeline, not a log dump.
 */
export function formatWaitEvent(event: WaitEvent): string {
	switch (event.kind) {
		case "queued":
			return `queued: ${formatQueueDetails(event)}`;
		case "started":
			return `started: ${formatBuildLabel(event)}${formatBuildUrl(event.buildUrl)}`;
		case "running": {
			const timing = formatTiming(event.elapsedMs, event.estimatedDurationMs);
			return `running: ${formatBuildLabel(event)}${timing ? ` ${timing}` : ""}`;
		}
		case "finished": {
			const result = event.result ?? "UNKNOWN";
			return `finished: ${formatBuildLabel(event)} ${result}${formatBuildUrl(event.buildUrl)}`;
		}
	}
}

function formatQueueDetails(event: Extract<WaitEvent, { kind: "queued" }>): string {
	const details = [
		event.why,
		event.stuck ? "stuck" : null,
		event.blocked ? "blocked" : null,
		event.buildable ? "buildable" : null,
	].filter((part): part is string => Boolean(part));

	return details.join(" | ") || "waiting for executor";
}

function formatBuildLabel(event: Extract<WaitEvent, { kind: "started" | "running" | "finished" }>): string {
	const parts = [
		event.jobPath,
		event.buildNumber !== undefined ? `#${event.buildNumber}` : "build",
	].filter((part): part is string => Boolean(part));

	return parts.join(" ");
}

function formatBuildUrl(url?: string): string {
	return url ? ` ${url}` : "";
}

function formatTiming(elapsedMs?: number, estimatedDurationMs?: number): string {
	if (elapsedMs === undefined && estimatedDurationMs === undefined) {
		return "";
	}

	if (estimatedDurationMs === undefined) {
		return `${formatDuration(elapsedMs)} elapsed`;
	}

	return `${formatDuration(elapsedMs)} elapsed / ${formatDuration(estimatedDurationMs)} est`;
}

function formatDuration(value?: number): string {
	if (value === undefined || !Number.isFinite(value) || value < 0) {
		return "unknown";
	}

	const totalSeconds = Math.round(value / 1_000);
	const hours = Math.floor(totalSeconds / 3_600);
	const minutes = Math.floor((totalSeconds % 3_600) / 60);
	const seconds = totalSeconds % 60;

	if (hours > 0) {
		return `${hours}h ${minutes}m`;
	}
	if (minutes > 0) {
		return `${minutes}m ${seconds}s`;
	}
	return `${seconds}s`;
}
