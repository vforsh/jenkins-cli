import { CliError, ExitCode } from "../cli/errors.ts";
import type { JenkinsClient } from "./client.ts";
import { waitForExecutable } from "./build-wait.ts";
import { deadlineFor, pause, waitTimeout, withinWait } from "./timing.ts";
import type { LogOptions, LogResult } from "./types.ts";

type Cursor = { version: 1; url: string; start: number };

/** The server offset is opaque: console annotations and Unicode make text length an unsafe substitute. */
function encodeCursor(url: string, start: number): string {
	return Buffer.from(JSON.stringify({ version: 1, url, start } satisfies Cursor)).toString("base64url");
}

function decodeCursor(input: string): Cursor {
	try {
		const value = JSON.parse(Buffer.from(input, "base64url").toString("utf8")) as Cursor;
		if (
			value.version === 1 &&
			typeof value.url === "string" &&
			Number.isSafeInteger(value.start) &&
			value.start >= 0
		)
			return value;
	} catch {
		/* Report a stable usage error below. */
	}
	throw new CliError("Invalid log cursor; use the cursor returned by build logs --json", ExitCode.BadArgs);
}

export async function readBuildLog(
	client: JenkinsClient,
	input: string,
	options: LogOptions,
): Promise<LogResult> {
	if (options.cursor && options.start !== undefined)
		throw new CliError("Use only one of --cursor or --start", ExitCode.BadArgs);
	if (options.grep === undefined && options.context !== undefined)
		throw new CliError("--context requires --grep", ExitCode.BadArgs);
	let pattern: RegExp | undefined;
	try {
		pattern = options.grep === undefined ? undefined : new RegExp(options.grep, "u");
	} catch {
		throw new CliError("--grep must be a valid regular expression", ExitCode.BadArgs);
	}
	const cursor = options.cursor ? decodeCursor(options.cursor) : undefined;
	const build = await waitForExecutable(client, input, options);
	if (!build.url) throw new CliError(`No build URL for ${input}`, ExitCode.ApiError);
	if (cursor && cursor.url.replace(/\/$/u, "") !== build.url.replace(/\/$/u, "")) {
		throw new CliError("Log cursor belongs to a different build", ExitCode.BadArgs);
	}
	const deadline = deadlineFor(options);
	const initialStart = cursor?.start ?? options.start ?? 0;
	let start = initialStart;
	let text = "";
	let complete = false;
	let fetched = false;
	let truncated = false;
	const maxBytes = options.maxBytes ?? (options.onChunk ? Infinity : 65_536);
	// Filtered/following output uses a bounded rolling buffer. Raw human follow streams chunks immediately.
	const streaming =
		Boolean(options.onChunk) && options.tail === undefined && !pattern && options.maxBytes === undefined;
	// Buffered output is delivered only on success. A timeout must replay its undelivered text.
	const timeoutDetails = () => {
		const resumeStart = streaming ? start : initialStart;
		return { ref: build.ref, cursor: encodeCursor(build.url!, resumeStart), nextStart: resumeStart };
	};
	while (Date.now() < deadline) {
		const page = await withinWait(client.readLogPage(build.url, start), build.ref, timeoutDetails());
		fetched = true;
		const next = page.headers.get("x-text-size");
		if (!next || !/^\d+$/u.test(next) || !Number.isSafeInteger(Number(next)) || Number(next) < start) {
			throw new CliError("Jenkins returned an invalid progressive log offset", {
				exitCode: ExitCode.ApiError,
				code: "INVALID_LOG_CURSOR",
			});
		}
		start = Number(next);
		complete = page.headers.get("x-more-data") !== "true";
		if (streaming) options.onChunk?.(page.text);
		else {
			text += page.text;
			// Filtering and tail selection operate on complete lines before the final byte cap.
			// Retain at most 4 MiB during follow; this also avoids accumulating the entire build in memory.
			if (options.follow && Buffer.byteLength(text) > 4 * 1024 * 1024) {
				text = utf8Tail(text, 4 * 1024 * 1024);
				truncated = true;
			}
		}
		if (!options.follow || complete) break;
		await pause(deadline, options.intervalMs);
	}
	if (!fetched || (options.follow && !complete && Date.now() >= deadline)) {
		throw waitTimeout(build.ref, timeoutDetails());
	}
	if (pattern) text = filterLines(text, pattern, options.context ?? 0);
	if (options.tail !== undefined) {
		const lines = text.replace(/\n$/u, "").split("\n");
		if (lines.length > options.tail) {
			text = lines.slice(-options.tail).join("\n") + (text.endsWith("\n") ? "\n" : "");
			truncated = true;
		}
	}
	if (Buffer.byteLength(text) > maxBytes) {
		text = utf8Tail(text, maxBytes);
		truncated = true;
	}
	return {
		text,
		nextStart: start,
		cursor: encodeCursor(build.url, start),
		complete,
		truncated,
		filtered: Boolean(pattern) || options.tail !== undefined,
		ref: build.ref,
	};
}

function filterLines(text: string, pattern: RegExp, context: number): string {
	const lines = text.replace(/\n$/u, "").split("\n");
	const keep = new Set<number>();
	for (let i = 0; i < lines.length; i++) {
		if (pattern.test(lines[i]!))
			for (let j = Math.max(0, i - context); j <= Math.min(lines.length - 1, i + context); j++) keep.add(j);
	}
	return [...keep]
		.sort((a, b) => a - b)
		.map((i) => lines[i])
		.join("\n");
}

function utf8Tail(text: string, maxBytes: number): string {
	const bytes = Buffer.from(text);
	let start = Math.max(0, bytes.length - maxBytes);
	while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start++;
	return bytes.subarray(start).toString("utf8");
}
