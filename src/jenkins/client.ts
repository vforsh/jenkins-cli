import { CliError, ExitCode } from "../cli/errors.ts";
import type { EffectiveConfig } from "../config/effective.ts";
import { extractQueueId, formatBuildRef, jobPathToApiPath, normalizeJobPath, parseRef } from "./ref.ts";
import { ensureTrailingSlash, isContainerJob, normalizeBuild, normalizeBuildInfo, normalizeJob, sleep, truncate } from "./helpers.ts";
import { normalizeJobParameterDefinitions } from "./job-parameters.ts";
import {
	createFinishedWaitEvent,
	createQueueWaitEvent,
	createRunningWaitEvent,
	createStartedWaitEvent,
	queueWaitEventKey,
	runningWaitEventKey,
} from "./wait-events.ts";
import type {
	BuildApiInfo,
	BuildArtifactApi,
	BuildApiSummary,
	JobApiProperty,
	JobApiSummary,
	NormalizedBuildArtifact,
	NormalizedBuildInfo,
	NormalizedBuildSummary,
	NormalizedJob,
	NormalizedJobInfo,
	QueueItem,
	RequestOptions,
	WaitOptions,
} from "./types.ts";

const DEFAULT_WAIT_INTERVAL_MS = 2_000;
const DEFAULT_WAIT_TIMEOUT_MS = 10 * 60_000;

export class JenkinsClient {
	private readonly endpoint: string;
	private readonly username?: string;
	private readonly apiToken?: string;
	private readonly timeoutMs: number;
	private readonly retries: number;
	private crumbPromise?: Promise<Record<string, string>>;

	constructor(config: EffectiveConfig) {
		this.endpoint = config.endpoint.replace(/\/$/, "");
		this.username = config.username;
		this.apiToken = config.apiToken;
		this.timeoutMs = config.timeoutMs;
		this.retries = config.retries;
	}

	async getServerInfo(): Promise<{ version?: string; authenticated: boolean }> {
		const response = await this.fetchResponse(this.makeUrl("/login"), {
			method: "GET",
		});

		return {
			version: response.headers.get("x-jenkins") ?? undefined,
			authenticated: Boolean(this.username && this.apiToken),
		};
	}

	async listJobs(parentJobPath?: string, recursive = false): Promise<NormalizedJob[]> {
		const rootPath = parentJobPath ? normalizeJobPath(parentJobPath) : undefined;

		if (!recursive) {
			const jobs = await this.fetchJobs(rootPath);
			return jobs.map(normalizeJob);
		}

		const allJobs: JobApiSummary[] = [];
		const queue: Array<string | undefined> = [rootPath];

		while (queue.length > 0) {
			const current = queue.shift();
			const currentJobs = await this.fetchJobs(current);
			for (const job of currentJobs) {
				allJobs.push(job);
				if (isContainerJob(job)) {
					queue.push(job.fullName ?? job.name);
				}
			}
		}

		return allJobs.map(normalizeJob);
	}

	async getJobInfo(
		jobPathInput: string,
		options: { includeParameters?: boolean } = {},
	): Promise<NormalizedJobInfo> {
		const jobPath = normalizeJobPath(jobPathInput);
		const includeParameters = options.includeParameters ?? false;
		const data = (await this.request(
			`${jobPathToApiPath(jobPath)}/api/json`,
			{
				query: {
					tree: buildJobInfoTree(includeParameters),
				},
			},
		)) as {
			name?: string;
			fullName?: string;
			url?: string;
			color?: string;
			_class?: string;
			description?: unknown;
			buildable?: unknown;
			lastBuild?: unknown;
			lastSuccessfulBuild?: unknown;
			lastCompletedBuild?: unknown;
			healthReport?: unknown;
			property?: JobApiProperty[];
		};

		return {
			jobPath,
			name: data.name,
			fullName: data.fullName,
			url: data.url,
			color: data.color,
			type: data._class,
			description: data.description,
			buildable: data.buildable,
			lastBuild: data.lastBuild,
			lastSuccessfulBuild: data.lastSuccessfulBuild,
			lastCompletedBuild: data.lastCompletedBuild,
			healthReport: data.healthReport,
			...(includeParameters
				? { parameterDefinitions: normalizeJobParameterDefinitions(data.property) }
				: {}),
		};
	}

	async listBuilds(jobPathInput: string, limit = 10): Promise<NormalizedBuildSummary[]> {
		const jobPath = normalizeJobPath(jobPathInput);
		const data = (await this.request(
			`${jobPathToApiPath(jobPath)}/api/json`,
			{
				query: {
					tree: "builds[number,url,result,building,timestamp,duration,displayName,fullDisplayName,id]",
				},
			},
		)) as { builds?: BuildApiSummary[] };

		return (data.builds ?? []).slice(0, limit).map((build) => normalizeBuild(build, jobPath));
	}

	async getBuild(refInput: string): Promise<NormalizedBuildInfo> {
		const ref = parseRef(refInput);
		if (ref.kind === "queue") {
			const queue = await this.getQueueItem(ref.id);
			if (!queue.executable?.url) {
				throw new CliError(
					queue.cancelled
						? `Queue item ${ref.id} was cancelled`
						: `Queue item ${ref.id} has not started a build yet`,
					ExitCode.ApiError,
				);
			}
			return this.getBuild(queue.executable.url);
		}

		const data = (await this.request(this.buildApiPath(ref), {
			query: {
				tree: "number,url,result,building,timestamp,duration,estimatedDuration,displayName,fullDisplayName,id,description,builtOn,actions[parameters[name,value]]",
			},
		})) as BuildApiInfo;

		return normalizeBuildInfo(data, ref.jobPath);
	}

	async listArtifacts(refInput: string): Promise<{
		build: NormalizedBuildSummary;
		artifacts: NormalizedBuildArtifact[];
	}> {
		const ref = parseRef(refInput);
		const buildRef =
			ref.kind === "queue"
				? parseRef((await this.getBuild(refInput)).url ?? refInput)
				: ref;

		if (buildRef.kind !== "build") {
			throw new CliError(`Could not resolve build reference: ${refInput}`, ExitCode.BadArgs);
		}

		const data = (await this.request(this.buildApiPath(buildRef), {
			query: {
				tree: "number,url,result,building,timestamp,duration,displayName,fullDisplayName,id,artifacts[fileName,relativePath]",
			},
		})) as BuildApiSummary & { artifacts?: BuildArtifactApi[] };

		const build = normalizeBuild(data, buildRef.jobPath);
		const buildUrl = data.url ?? this.buildUrl(buildRef);
		if (!buildUrl) {
			throw new CliError(`Could not resolve build URL for ${refInput}`, ExitCode.BadArgs);
		}

		return {
			build,
			artifacts: normalizeArtifacts(data.artifacts ?? [], buildUrl),
		};
	}

	async downloadArtifact(artifactUrl: string): Promise<Uint8Array> {
		return (await this.requestAbsolute(artifactUrl, {
			expect: "bytes",
		})) as Uint8Array;
	}

	async triggerBuild(jobPathInput: string, params: Record<string, string>): Promise<{
		jobPath: string;
		queueId: number | null;
		queueUrl: string | null;
	}> {
		const jobPath = normalizeJobPath(jobPathInput);
		const endpoint =
			Object.keys(params).length > 0
				? `${jobPathToApiPath(jobPath)}/buildWithParameters`
				: `${jobPathToApiPath(jobPath)}/build`;

		const body = new URLSearchParams();
		for (const [key, value] of Object.entries(params)) {
			body.set(key, value);
		}

		const response = (await this.request(endpoint, {
			method: "POST",
			body,
			expect: "none",
			mutate: true,
		})) as Response;

		const location = response.headers.get("location");
		return {
			jobPath,
			queueId: extractQueueId(location),
			queueUrl: location,
		};
	}

	async getBuildLog(
		refInput: string,
		options: {
			start?: number;
			follow?: boolean;
			intervalMs?: number;
			waitTimeoutMs?: number;
			onChunk?: (chunk: string) => void;
		} = {},
	): Promise<{ text: string; nextStart: number; complete: boolean }> {
		const ref = parseRef(refInput);
		let buildUrl: string | undefined;

		if (ref.kind === "queue") {
			const resolved = await this.waitForExecutable(ref.id, {
				intervalMs: options.intervalMs,
				waitTimeoutMs: options.waitTimeoutMs,
			});
			buildUrl = resolved.url;
		} else {
			buildUrl = ref.url ?? this.buildUrl(ref);
		}

		if (!buildUrl) {
			throw new CliError(`Could not resolve build URL for ${refInput}`, ExitCode.BadArgs);
		}

		let start = options.start ?? 0;
		let fullText = "";

		while (true) {
			const response = await this.requestAbsolute(
				new URL(`logText/progressiveText?start=${start}`, ensureTrailingSlash(buildUrl)).toString(),
				{
					expect: "text",
				},
			);
			const text = response as string;
			fullText += text;
			if (text.length > 0) {
				options.onChunk?.(text);
			}

			const moreData = this.lastHeaders?.get("x-more-data") === "true";
			const nextStartHeader = this.lastHeaders?.get("x-text-size");
			start = nextStartHeader ? Number.parseInt(nextStartHeader, 10) : start + text.length;

			if (!options.follow && !moreData) {
				return { text: fullText, nextStart: start, complete: true };
			}

			if (!options.follow && moreData) {
				return { text: fullText, nextStart: start, complete: false };
			}

			const build = await this.getBuild(buildUrl);
			if (!moreData && build.building !== true) {
				return { text: fullText, nextStart: start, complete: true };
			}

			await sleep(options.intervalMs ?? 2_000);
		}
	}

	async waitForRef(refInput: string, options: WaitOptions = {}): Promise<NormalizedBuildInfo> {
		const ref = parseRef(refInput);

		if (ref.kind === "queue") {
			const executable = await this.waitForExecutable(ref.id, {
				intervalMs: options.intervalMs,
				waitTimeoutMs: options.waitTimeoutMs,
				onProgress: options.onProgress,
			});
			return this.waitForBuild(executable.url, options, false);
		}

		return this.waitForBuild(formatBuildRef(ref), options);
	}

	async getQueueItem(id: number): Promise<QueueItem> {
		return (await this.request(`/queue/item/${id}/api/json`, {
			query: {
				tree: "id,cancelled,blocked,buildable,stuck,why,task[name,url],executable[number,url]",
			},
		})) as QueueItem;
	}

	private lastHeaders?: Headers;

	private async waitForExecutable(
		id: number,
		options: WaitOptions = {},
	): Promise<{ number: number; url: string; jobPath?: string }> {
		const { deadline, intervalMs } = resolveWaitTiming(options);
		let lastQueueEventKey: string | undefined;

		while (Date.now() < deadline) {
			const item = await this.getQueueItem(id);
			if (item.cancelled) {
				throw new CliError(`Queue item ${id} was cancelled`, ExitCode.ApiError);
			}

			const queuedEvent = createQueueWaitEvent(id, item);
			const queueEventKey = queueWaitEventKey(queuedEvent);
			if (queueEventKey !== lastQueueEventKey) {
				options.onProgress?.(queuedEvent);
				lastQueueEventKey = queueEventKey;
			}

			if (item.executable?.url && item.executable.number !== undefined) {
				const startedEvent = createStartedWaitEvent(
					{
						jobPath: queuedEvent.jobPath,
						number: item.executable.number,
						url: item.executable.url,
					},
					id,
				);
				options.onProgress?.(startedEvent);
				return {
					number: item.executable.number,
					url: item.executable.url,
					jobPath: queuedEvent.jobPath,
				};
			}
			await sleep(intervalMs);
		}

		throw new CliError(`Timed out waiting for queue item ${id}`, ExitCode.Timeout);
	}

	private async waitForBuild(
		refInput: string,
		options: WaitOptions = {},
		emitStarted = true,
	): Promise<NormalizedBuildInfo> {
		const { deadline, intervalMs } = resolveWaitTiming(options);
		let didEmitStarted = !emitStarted;
		let lastRunningEventKey: string | undefined;

		while (Date.now() < deadline) {
			const build = await this.getBuild(refInput);

			if (!didEmitStarted) {
				options.onProgress?.(createStartedWaitEvent(build));
				didEmitStarted = true;
			}

			if (build.building) {
				const runningEvent = createRunningWaitEvent(build);
				const runningEventKey = runningWaitEventKey(runningEvent);
				if (runningEventKey !== lastRunningEventKey) {
					options.onProgress?.(runningEvent);
					lastRunningEventKey = runningEventKey;
				}
				await sleep(intervalMs);
				continue;
			}

			options.onProgress?.(createFinishedWaitEvent(build));
			return build;
		}

		throw new CliError(`Timed out waiting for ${refInput}`, ExitCode.Timeout);
	}

	private async fetchJobs(jobPath?: string): Promise<JobApiSummary[]> {
		const path = jobPath ? `${jobPathToApiPath(jobPath)}/api/json` : "/api/json";
		const data = (await this.request(path, {
			query: {
				tree: "jobs[name,fullName,url,color,_class]",
			},
		})) as { jobs?: JobApiSummary[] };

		return data.jobs ?? [];
	}

	private buildApiPath(ref: ReturnType<typeof parseRef> & { kind: "build" }): string {
		if (ref.url) {
			return new URL("api/json", ensureTrailingSlash(ref.url)).toString();
		}
		if (ref.jobPath && ref.buildNumber !== undefined) {
			return `${jobPathToApiPath(ref.jobPath)}/${ref.buildNumber}/api/json`;
		}
		throw new CliError(`Could not resolve build reference: ${formatBuildRef(ref)}`, ExitCode.BadArgs);
	}

	private buildUrl(ref: ReturnType<typeof parseRef> & { kind: "build" }): string | undefined {
		if (ref.url) {
			return ensureTrailingSlash(ref.url);
		}
		if (ref.jobPath && ref.buildNumber !== undefined) {
			return `${this.endpoint}${jobPathToApiPath(ref.jobPath)}/${ref.buildNumber}/`;
		}
		return undefined;
	}

	private async request(path: string, options: RequestOptions = {}): Promise<unknown> {
		const url = path.startsWith("http://") || path.startsWith("https://") ? path : this.makeUrl(path, options.query);
		return this.requestAbsolute(url, options);
	}

	private async requestAbsolute(url: string, options: RequestOptions = {}): Promise<unknown> {
		const response = await this.fetchResponse(url, {
			method: options.method ?? "GET",
			body: options.body,
			mutate: options.mutate ?? false,
		});

		this.lastHeaders = response.headers;

		switch (options.expect ?? "json") {
			case "none":
				return response;
			case "text":
				return await response.text();
			case "bytes":
				return new Uint8Array(await response.arrayBuffer());
			case "json": {
				const text = await response.text();
				try {
					return text.length > 0 ? JSON.parse(text) : {};
				} catch {
					throw new CliError(
						`Expected JSON from Jenkins but got: ${truncate(text)}`,
						ExitCode.ApiError,
					);
				}
			}
		}
	}

	private async fetchResponse(
		url: string,
		options: { method: "GET" | "POST"; body?: URLSearchParams; mutate?: boolean },
	): Promise<Response> {
		let attempt = 0;
		let lastError: unknown;

		while (attempt <= this.retries) {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

			try {
				const headers = new Headers({
					accept: "application/json, text/plain;q=0.9, */*;q=0.8",
				});

				if (this.username && this.apiToken) {
					headers.set(
						"authorization",
						`Basic ${Buffer.from(`${this.username}:${this.apiToken}`).toString("base64")}`,
					);
				}

				if (options.body) {
					headers.set("content-type", "application/x-www-form-urlencoded;charset=UTF-8");
				}

				if (options.mutate) {
					const crumbHeaders = await this.getCrumbHeaders();
					for (const [key, value] of Object.entries(crumbHeaders)) {
						headers.set(key, value);
					}
				}

				const response = await fetch(url, {
					method: options.method,
					headers,
					body: options.body,
					signal: controller.signal,
					redirect: options.mutate ? "manual" : "follow",
				});

				if (response.url.includes("/securityRealm/commenceLogin")) {
					throw new CliError(
						`Authentication failed for ${this.endpoint}. Check username/api-token.`,
						ExitCode.AuthError,
					);
				}

				if (!options.mutate && !response.ok) {
					throw await this.httpError(response, url);
				}

				if (options.mutate && response.status >= 400) {
					throw await this.httpError(response, url);
				}

				return response;
			} catch (error) {
				clearTimeout(timeout);
				lastError = error;

				if (error instanceof CliError) {
					throw error;
				}

				if (error instanceof DOMException && error.name === "AbortError") {
					throw new CliError(`Request timed out after ${this.timeoutMs}ms`, ExitCode.Timeout);
				}

				if (attempt === this.retries) {
					break;
				}
			} finally {
				clearTimeout(timeout);
			}

			attempt += 1;
		}

		throw new CliError("Failed to reach Jenkins", {
			exitCode: ExitCode.NetworkError,
			details: lastError,
		});
	}

	private async httpError(response: Response, url: string): Promise<CliError> {
		const text = await response.text();

		if (response.status === 401 || response.status === 403) {
			return new CliError(
				`Authentication failed for ${url}. Jenkins returned ${response.status}.`,
				ExitCode.AuthError,
			);
		}

		if (response.status === 404) {
			return new CliError(`Jenkins resource not found: ${url}`, ExitCode.NotFound);
		}

		return new CliError(
			`Jenkins request failed with ${response.status} ${response.statusText}: ${truncate(text)}`,
			{
				exitCode: ExitCode.ApiError,
				details: {
					url,
					status: response.status,
					body: truncate(text, 500),
				},
			},
		);
	}

	private async getCrumbHeaders(): Promise<Record<string, string>> {
		if (this.crumbPromise) {
			return this.crumbPromise;
		}

		this.crumbPromise = (async () => {
			try {
				const response = await this.fetchResponse(this.makeUrl("/crumbIssuer/api/json"), {
					method: "GET",
				});
				const data = (await response.json()) as {
					crumb?: string;
					crumbRequestField?: string;
				};
				if (data.crumb && data.crumbRequestField) {
					return { [data.crumbRequestField]: data.crumb };
				}
			} catch (error) {
				if (
					error instanceof CliError &&
					(error.exitCode === ExitCode.NotFound || error.exitCode === ExitCode.AuthError)
				) {
					if (error.exitCode === ExitCode.AuthError) {
						throw error;
					}
					return {};
				}
			}
			return {};
		})();

		return this.crumbPromise;
	}

	private makeUrl(path: string, query?: Record<string, string | number | undefined>): string {
		const url = new URL(path.replace(/^\/*/, "/"), `${this.endpoint}/`);

		for (const [key, value] of Object.entries(query ?? {})) {
			if (value !== undefined) {
				url.searchParams.set(key, String(value));
			}
		}

		return url.toString();
	}
}

function normalizeArtifacts(items: BuildArtifactApi[], buildUrl: string): NormalizedBuildArtifact[] {
	return items.flatMap((item) => {
		if (!item.fileName || !item.relativePath) {
			return [];
		}

		return [
			{
				fileName: item.fileName,
				relativePath: item.relativePath,
				url: buildArtifactUrl(buildUrl, item.relativePath),
			},
		];
	});
}

function buildArtifactUrl(buildUrl: string, relativePath: string): string {
	const encodedPath = relativePath
		.split("/")
		.filter((part) => part.length > 0)
		.map((part) => encodeURIComponent(part))
		.join("/");

	return new URL(`artifact/${encodedPath}`, ensureTrailingSlash(buildUrl)).toString();
}

function resolveWaitTiming(options: WaitOptions): { deadline: number; intervalMs: number } {
	return {
		deadline: Date.now() + (options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS),
		intervalMs: options.intervalMs ?? DEFAULT_WAIT_INTERVAL_MS,
	};
}

function buildJobInfoTree(includeParameters: boolean): string {
	const base =
		"name,fullName,url,color,_class,description,buildable,lastBuild[number,url,result,building,timestamp],lastSuccessfulBuild[number,url,result],lastCompletedBuild[number,url,result],healthReport[score,description]";

	if (!includeParameters) {
		return base;
	}

	return `${base},property[_class,parameterDefinitions[name,description,type,_class,defaultValue,defaultParameterValue[value],choices]]`;
}
