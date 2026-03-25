import { CliError, ExitCode } from "../cli/errors.ts";
import type { EffectiveConfig } from "../config/effective.ts";
import { extractQueueId, formatBuildRef, jobPathToApiPath, normalizeJobPath, parseRef } from "./ref.ts";
import { ensureTrailingSlash, isContainerJob, normalizeBuild, normalizeBuildInfo, normalizeJob, sleep, truncate } from "./helpers.ts";
import type { BuildApiInfo, BuildApiSummary, JobApiSummary, QueueItem, RequestOptions } from "./types.ts";

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

	async listJobs(parentJobPath?: string, recursive = false): Promise<Array<Record<string, unknown>>> {
		const rootPath = parentJobPath ? normalizeJobPath(parentJobPath) : undefined;
		const jobs = await this.fetchJobs(rootPath);

		if (!recursive) {
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

	async getJobInfo(jobPathInput: string): Promise<Record<string, unknown>> {
		const jobPath = normalizeJobPath(jobPathInput);
		const data = (await this.request(
			`${jobPathToApiPath(jobPath)}/api/json`,
			{
				query: {
					tree: "name,fullName,url,color,_class,description,buildable,lastBuild[number,url,result,building,timestamp],lastSuccessfulBuild[number,url,result],lastCompletedBuild[number,url,result],healthReport[score,description]",
				},
			},
		)) as Record<string, unknown>;

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
		};
	}

	async listBuilds(jobPathInput: string, limit = 10): Promise<Array<Record<string, unknown>>> {
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

	async getBuild(refInput: string): Promise<Record<string, unknown>> {
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

	async waitForRef(
		refInput: string,
		options: { intervalMs?: number; waitTimeoutMs?: number } = {},
	): Promise<Record<string, unknown>> {
		const ref = parseRef(refInput);
		const deadline = Date.now() + (options.waitTimeoutMs ?? 10 * 60_000);

		if (ref.kind === "queue") {
			const executable = await this.waitForExecutable(ref.id, {
				intervalMs: options.intervalMs,
				waitTimeoutMs: options.waitTimeoutMs,
			});
			return this.waitForRef(executable.url, options);
		}

		while (Date.now() < deadline) {
			const build = await this.getBuild(formatBuildRef(ref));
			if (build.building !== true) {
				return build;
			}
			await sleep(options.intervalMs ?? 2_000);
		}

		throw new CliError(`Timed out waiting for ${refInput}`, ExitCode.Timeout);
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
		options: { intervalMs?: number; waitTimeoutMs?: number } = {},
	): Promise<{ number: number; url: string }> {
		const deadline = Date.now() + (options.waitTimeoutMs ?? 10 * 60_000);

		while (Date.now() < deadline) {
			const item = await this.getQueueItem(id);
			if (item.cancelled) {
				throw new CliError(`Queue item ${id} was cancelled`, ExitCode.ApiError);
			}
			if (item.executable?.url && item.executable.number !== undefined) {
				return {
					number: item.executable.number,
					url: item.executable.url,
				};
			}
			await sleep(options.intervalMs ?? 2_000);
		}

		throw new CliError(`Timed out waiting for queue item ${id}`, ExitCode.Timeout);
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
