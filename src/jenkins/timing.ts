import { CliError, ExitCode } from "../cli/errors.ts";
import { sleep } from "./helpers.ts";
import type { WaitOptions } from "./types.ts";

export function deadlineFor(options: WaitOptions): number {
	return options.deadline ?? Date.now() + (options.waitTimeoutMs ?? 600_000);
}

export async function pause(deadline: number, intervalMs = 2_000): Promise<void> {
	await sleep(Math.max(0, Math.min(intervalMs, deadline - Date.now())));
}

export function waitTimeout(ref: string, details?: unknown): CliError {
	return new CliError(`Timed out waiting for ${ref}`, {
		exitCode: ExitCode.Timeout,
		code: "WAIT_TIMEOUT",
		details,
		hint: "Resume with the same build ref or watch selectors; do not trigger another build.",
	});
}

export async function withinWait<T>(request: Promise<T>, ref: string, details?: unknown): Promise<T> {
	try {
		return await request;
	} catch (error) {
		if (error instanceof CliError && error.code === "WAIT_TIMEOUT") throw waitTimeout(ref, details);
		throw error;
	}
}
