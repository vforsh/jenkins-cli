import { CliError, ExitCode } from "../cli/errors.ts";

export type QueueRef = {
	kind: "queue";
	id: number;
	url?: string;
};

export type BuildRef = {
	kind: "build";
	jobPath?: string;
	buildNumber?: number;
	url?: string;
};

export type JenkinsRef = QueueRef | BuildRef;

export function normalizeJobPath(input: string): string {
	const trimmed = input.trim();
	if (trimmed.length === 0) {
		throw new CliError("Job path must not be empty", ExitCode.BadArgs);
	}

	if (isUrl(trimmed)) {
		const url = new URL(trimmed);
		const segments = extractJobSegments(url.pathname);
		if (segments.length === 0) {
			throw new CliError(`Could not infer Jenkins job path from URL: ${trimmed}`, ExitCode.BadArgs);
		}
		return segments.join("/");
	}

	if (trimmed.includes("/job/") || trimmed.startsWith("job/")) {
		const segments = extractJobSegments(`/${trimmed.replace(/^\/+/, "")}`);
		if (segments.length === 0) {
			throw new CliError(`Could not infer Jenkins job path from: ${trimmed}`, ExitCode.BadArgs);
		}
		return segments.join("/");
	}

	return trimmed.replace(/^\/+|\/+$/g, "");
}

export function jobPathToApiPath(jobPath: string): string {
	const segments = normalizeJobPath(jobPath)
		.split("/")
		.filter((segment) => segment.length > 0)
		.map((segment) => encodeURIComponent(segment));

	return `/job/${segments.join("/job/")}`;
}

export function parseRef(input: string): JenkinsRef {
	const trimmed = input.trim();
	if (trimmed.length === 0) {
		throw new CliError("Build or queue reference must not be empty", ExitCode.BadArgs);
	}

	const queueFromPrefix = trimmed.match(/^queue:(\d+)$/i);
	if (queueFromPrefix) {
		const [, queueId] = queueFromPrefix;
		if (!queueId) {
			throw new CliError(`Invalid queue reference: ${trimmed}`, ExitCode.BadArgs);
		}
		return { kind: "queue", id: Number.parseInt(queueId, 10) };
	}

	if (isUrl(trimmed)) {
		const url = new URL(trimmed);
		const queueMatch = url.pathname.match(/\/queue\/item\/(\d+)\/?$/);
		if (queueMatch) {
			const [, queueId] = queueMatch;
			if (!queueId) {
				throw new CliError(`Invalid queue URL: ${trimmed}`, ExitCode.BadArgs);
			}
			return {
				kind: "queue",
				id: Number.parseInt(queueId, 10),
				url: stripTrailingSlash(url.toString()),
			};
		}

		const buildMatch = url.pathname.match(/(.*)\/(\d+)\/?$/);
		if (buildMatch) {
			const [, buildBasePath, buildNumberRaw] = buildMatch;
			if (!buildBasePath || !buildNumberRaw) {
				throw new CliError(`Invalid build URL: ${trimmed}`, ExitCode.BadArgs);
			}
			const jobSegments = extractJobSegments(buildBasePath);
			if (jobSegments.length > 0) {
				return {
					kind: "build",
					jobPath: jobSegments.join("/"),
					buildNumber: Number.parseInt(buildNumberRaw, 10),
					url: ensureTrailingSlash(url.toString()),
				};
			}
		}
	}

	const hashIndex = trimmed.lastIndexOf("#");
	if (hashIndex > 0) {
		const jobPath = normalizeJobPath(trimmed.slice(0, hashIndex));
		const buildNumber = Number.parseInt(trimmed.slice(hashIndex + 1), 10);
		if (!Number.isFinite(buildNumber)) {
			throw new CliError(
				`Invalid build reference: ${trimmed}. Expected job/path#123 or a build URL.`,
				ExitCode.BadArgs,
			);
		}

		return {
			kind: "build",
			jobPath,
			buildNumber,
		};
	}

	throw new CliError(
		`Unsupported reference: ${trimmed}. Use queue:123, a queue/build URL, or job/path#123.`,
		ExitCode.BadArgs,
	);
}

export function formatBuildRef(ref: BuildRef): string {
	if (ref.url) {
		return stripTrailingSlash(ref.url);
	}
	if (ref.jobPath && ref.buildNumber !== undefined) {
		return `${ref.jobPath}#${ref.buildNumber}`;
	}
	return "unknown-build";
}

export function extractQueueId(location: string | null): number | null {
	if (!location) {
		return null;
	}

	const match = location.match(/\/queue\/item\/(\d+)\/?$/);
	if (!match) {
		return null;
	}

	const [, queueId] = match;
	if (!queueId) {
		return null;
	}
	return Number.parseInt(queueId, 10);
}

function extractJobSegments(pathname: string): string[] {
	const parts = pathname.split("/").filter((part) => part.length > 0);
	const segments: string[] = [];

	for (let index = 0; index < parts.length; index += 1) {
		if (parts[index] !== "job") {
			continue;
		}

		const next = parts[index + 1];
		if (next) {
			segments.push(decodeURIComponent(next));
			index += 1;
		}
	}

	return segments;
}

function isUrl(value: string): boolean {
	try {
		new URL(value);
		return true;
	} catch {
		return false;
	}
}

function ensureTrailingSlash(value: string): string {
	return value.endsWith("/") ? value : `${value}/`;
}

function stripTrailingSlash(value: string): string {
	return value.replace(/\/$/, "");
}
