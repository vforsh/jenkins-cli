import { CliError, ExitCode } from "./errors.ts";

export function integer(value: string, label: string, minimum = 0): number {
	const parsed = /^\d+$/u.test(value) ? Number(value) : NaN;
	if (!Number.isSafeInteger(parsed) || parsed < minimum) {
		throw new CliError(`${label} must be an integer >= ${minimum}`, {
			exitCode: ExitCode.BadArgs,
			hint:
				label === "--timeout"
					? "Use --request-timeout 55s for HTTP requests or --wait-timeout 55s for build observation."
					: undefined,
		});
	}
	return parsed;
}

/** Bare durations retain the historical millisecond unit. Never accept a partial parse. */
export function duration(value: string, label = "duration"): number {
	const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/u.exec(value);
	const units: Record<string, number> = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 };
	const ms = match ? Number(match[1]) * units[match[2] ?? "ms"]! : NaN;
	if (!Number.isSafeInteger(ms) || ms <= 0 || ms > 2_147_483_647) {
		throw new CliError(
			`${label} must be a positive duration, e.g. 55000, 55s or 20m (max 2147483647ms)`,
			ExitCode.BadArgs,
		);
	}
	return ms;
}
