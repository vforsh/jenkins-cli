import pc from "picocolors";
import { CliError, ExitCode } from "./errors.ts";
import type { CliContext, GlobalOptions } from "./types.ts";

type EmitPayload = {
	data: unknown;
	human?: string | string[];
};

export function toCliContext(raw: GlobalOptions = {}): CliContext {
	const color = !(raw.noColor ?? false) && Boolean(process.stderr.isTTY);

	return {
		json: raw.json ?? false,
		plain: raw.plain ?? false,
		quiet: raw.quiet ?? false,
		verbose: raw.verbose ?? false,
		color,
		endpoint: typeof raw.endpoint === "string" ? raw.endpoint : undefined,
		region: typeof raw.region === "string" ? raw.region : undefined,
		timeoutMs: raw.requestTimeout ?? normalizeNumber(raw.timeout),
		fields: parseFields(raw.fields),
		retries: normalizeNumber(raw.retries),
	};
}

export function emitData(ctx: CliContext, payload: EmitPayload, plainLines: string[] = []): void {
	if (ctx.json) {
		writeStdout(
			JSON.stringify(
				{ ok: true, data: ctx.fields ? projectFields(payload.data, ctx.fields) : payload.data },
				null,
				2,
			),
		);
		return;
	}

	if (ctx.plain) {
		writeStdout(plainLines.join("\n"));
		return;
	}

	if (payload.human) {
		const lines = Array.isArray(payload.human) ? payload.human : [payload.human];
		writeStdout(lines.join("\n"));
		return;
	}

	writeStdout(JSON.stringify(payload.data, null, 2));
}

export function printStdout(text: string): void {
	process.stdout.write(text);
}

export function note(ctx: CliContext, message: string): void {
	if (ctx.json || ctx.quiet) {
		return;
	}

	writeStderr(withColor(ctx, "cyan", message));
}

export function status(ctx: CliContext, message: string): void {
	if (ctx.quiet) {
		return;
	}

	writeStderr(withColor(ctx, "dim", message));
}

export function debug(ctx: CliContext, message: string): void {
	if (ctx.json || !ctx.verbose) {
		return;
	}

	writeStderr(withColor(ctx, "dim", message));
}

export function handleFatalError(error: unknown, raw: GlobalOptions | CliContext = {}): never {
	const ctx = isCliContext(raw) ? raw : toCliContext({ ...raw, fields: undefined });
	const cliError = normalizeError(error);

	if (ctx.json) {
		writeStdout(
			JSON.stringify(
				{
					ok: false,
					error: {
						message: cliError.message,
						code: cliError.code,
						hint: cliError.hint,
						details:
							cliError.code === "WAIT_TIMEOUT" || cliError.exitCode === ExitCode.BuildFailed
								? cliError.details
								: undefined,
						exitCode: cliError.exitCode,
					},
				},
				null,
				2,
			),
		);
		process.exit(cliError.exitCode);
	}

	const prefix = withColor(ctx, "red", "Error:");
	writeStderr(`${prefix} ${cliError.message}`);
	if (cliError.hint) writeStderr(cliError.hint);

	if (ctx.verbose && cliError.details !== undefined) {
		writeStderr(withColor(ctx, "dim", JSON.stringify(cliError.details, null, 2)));
	}

	process.exit(cliError.exitCode);
}

function normalizeError(error: unknown): CliError {
	if (error instanceof CliError) {
		return error;
	}

	if (error instanceof Error) {
		return new CliError(error.message, {
			exitCode: ExitCode.Failure,
			details: {
				name: error.name,
				stack: error.stack,
			},
			cause: error,
		});
	}

	return new CliError(String(error), ExitCode.Failure);
}

function isCliContext(value: GlobalOptions | CliContext): value is CliContext {
	return "color" in value;
}

function normalizeNumber(value: number | string | undefined): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}

	if (typeof value === "string" && value.trim().length > 0) {
		const parsed = /^\d+$/u.test(value) ? Number(value) : NaN;
		return Number.isFinite(parsed) ? parsed : undefined;
	}

	return undefined;
}

function writeStdout(text: string): void {
	process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
}

function writeStderr(text: string): void {
	process.stderr.write(text.endsWith("\n") ? text : `${text}\n`);
}

function withColor(ctx: CliContext, color: "red" | "cyan" | "dim", message: string): string {
	if (!ctx.color) {
		return message;
	}

	switch (color) {
		case "red":
			return pc.red(message);
		case "cyan":
			return pc.cyan(message);
		case "dim":
			return pc.dim(message);
	}
}

function parseFields(input?: string): string[] | undefined {
	if (input === undefined) return undefined;
	const fields = input.split(",").map((field) => field.trim());
	if (
		fields.some(
			(field) =>
				!/^[a-zA-Z][\w]*(?:\.[a-zA-Z][\w]*)*$/u.test(field) ||
				field.split(".").some((key) => ["__proto__", "constructor", "prototype"].includes(key)),
		)
	) {
		throw new CliError(
			"--fields requires comma-separated field paths, e.g. number,result,scm.revisions",
			ExitCode.BadArgs,
		);
	}
	return fields;
}

function projectFields(value: unknown, fields: string[]): unknown {
	if (Array.isArray(value)) return value.map((item) => projectFields(item, fields));
	if (!value || typeof value !== "object") return undefined;
	const result: Record<string, unknown> = {};
	for (const root of new Set(fields.map((field) => field.split(".")[0]!))) {
		const child = (value as Record<string, unknown>)[root];
		if (fields.includes(root)) {
			result[root] = child;
			continue;
		}
		const childFields = fields
			.filter((field) => field.startsWith(root + "."))
			.map((field) => field.slice(root.length + 1));
		result[root] = projectFields(child, childFields);
	}
	return result;
}
