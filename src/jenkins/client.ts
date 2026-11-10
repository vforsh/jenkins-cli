import { JenkinsHttp } from "./http.ts";
import {
	buildInfoTree,
	buildCandidatesTree,
	buildCauses,
	normalizeScm,
	upstreamBuilds,
	canonicalJobPath,
	isDownstreamOf,
} from "./build-metadata.ts";
import { deadlineFor } from "./timing.ts";
import { waitForBuild, watchBuild } from "./build-wait.ts";
import { readBuildLog } from "./build-logs.ts";
import { CliError, ExitCode } from "../cli/errors.ts";
import type { EffectiveConfig } from "../config/effective.ts";
import { extractQueueId, formatBuildRef, jobPathToApiPath, normalizeJobPath, parseRef } from "./ref.ts";
import {
	ensureTrailingSlash,
	isContainerJob,
	normalizeBuild,
	normalizeBuildInfo,
	normalizeJob,
} from "./helpers.ts";
import { normalizeJobParameterDefinitions } from "./job-parameters.ts";
import type {
	BuildApiInfo,
	BuildInfoOptions,
	BuildInclude,
	RefInfo,
	RelatedBuild,
	WatchOptions,
	LogOptions,
	LogResult,
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

export class JenkinsClient {
	private readonly http: JenkinsHttp;

	constructor(
		private readonly config: EffectiveConfig,
		private readonly deadline?: number,
	) {
		this.http = new JenkinsHttp(config, deadline);
	}

	withDeadline(deadline: number): JenkinsClient {
		return new JenkinsClient(this.config, Math.min(deadline, this.deadline ?? Infinity));
	}

	async getServerInfo(): Promise<{ version?: string; authenticated: boolean }> {
		const response = (await this.request("/login", { expect: "none" })) as Response;
		return {
			version: response.headers.get("x-jenkins") ?? undefined,
			authenticated: Boolean(this.config.username && this.config.apiToken),
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
		const data = (await this.request(`${jobPathToApiPath(jobPath)}/api/json`, {
			query: {
				tree: buildJobInfoTree(includeParameters),
			},
		})) as {
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
			...(includeParameters ? { parameterDefinitions: normalizeJobParameterDefinitions(data.property) } : {}),
		};
	}

	async listBuilds(job: string, limit = 10): Promise<NormalizedBuildSummary[]> {
		return (await this.buildCandidates(job, limit)).map((build) =>
			normalizeBuild(build, normalizeJobPath(job)),
		);
	}

	async buildCandidates(job: string, limit: number, include: BuildInclude[] = []): Promise<BuildApiInfo[]> {
		const data = (await this.request(`${jobPathToApiPath(job)}/api/json`, {
			query: { tree: `builds[${buildCandidatesTree(include)}]{0,${limit}}` },
		})) as { builds?: BuildApiInfo[] };
		return data.builds ?? [];
	}

	async inspectRef(input: string, options: BuildInfoOptions = {}): Promise<RefInfo> {
		const ref = parseRef(input);
		if (ref.kind !== "queue") return this.getBuild(input, options);
		const queue = await this.getQueueItem(ref.id);
		if (queue.executable?.url) return this.getBuild(queue.executable.url, options);
		return {
			ref: `queue:${ref.id}`,
			queueId: ref.id,
			state: queue.cancelled ? "cancelled" : "queued",
			complete: queue.cancelled ?? false,
			url: this.http.url(`/queue/item/${ref.id}/`),
			jobPath: queue.task?.url ? normalizeJobPath(queue.task.url) : undefined,
			why: queue.why ?? undefined,
			blocked: queue.blocked ?? false,
			stuck: queue.stuck ?? false,
			buildable: queue.buildable ?? false,
		};
	}

	async getBuild(input: string, options: BuildInfoOptions = {}): Promise<NormalizedBuildInfo> {
		const ref = parseRef(input);
		if (ref.kind === "queue") {
			const info = await this.inspectRef(input, options);
			if ("queueId" in info) {
				throw new CliError(`Queue item ${ref.id} is ${info.state}`, {
					exitCode: ExitCode.ApiError,
					details: info,
				});
			}
			return info;
		}
		const include = [...(options.include ?? [])];
		if (options.downstreamJobs?.length && !include.includes("related")) include.push("related");
		const data = (await this.request(this.buildApiPath(ref), {
			query: { tree: buildInfoTree(include) },
		})) as BuildApiInfo;
		const build = normalizeBuildInfo(data, canonicalJobPath(data.url, ref.jobPath));
		if (include.includes("scm")) build.scm = normalizeScm(data);
		if (include.includes("related") || options.downstreamJobs?.length) {
			const jobs = options.downstreamJobs ?? [];
			const limit = options.relatedLimit ?? 50;
			const found = await this.findDownstream(build, jobs, limit);
			build.related = {
				causes: buildCauses(data),
				upstream: upstreamBuilds(data, (path) => this.http.url(path)),
				downstream: found.builds,
				downstreamSearch: { jobs, limitPerJob: limit, truncated: found.truncated },
			};
		}
		if (include.includes("stages")) build.stages = await this.getStages(build.url ?? this.buildUrl(ref)!);
		return build;
	}

	async findDownstream(
		parent: NormalizedBuildInfo,
		jobs: string[],
		limit: number,
	): Promise<{ builds: RelatedBuild[]; truncated: boolean }> {
		const builds: RelatedBuild[] = [];
		let truncated = false;
		for (const job of jobs) {
			const candidates = await this.buildCandidates(job, limit + 1, ["related"]);
			truncated ||= candidates.length > limit;
			for (const candidate of candidates.slice(0, limit)) {
				if (candidate.number === undefined || !isDownstreamOf(candidate, parent)) continue;
				const jobPath = normalizeJobPath(job);
				builds.push({
					jobPath,
					number: candidate.number,
					ref: `${jobPath}#${candidate.number}`,
					url: candidate.url,
					result: candidate.result,
					building: candidate.building,
				});
			}
		}
		return { builds, truncated };
	}

	private async getStages(url: string): Promise<NonNullable<NormalizedBuildInfo["stages"]>> {
		try {
			const data = (await this.request(new URL("wfapi/describe", ensureTrailingSlash(url)).toString())) as {
				stages?: Array<{
					id: string;
					name: string;
					status: string;
					startTimeMillis?: number;
					durationMillis?: number;
				}>;
			};
			return {
				available: true,
				items: (data.stages ?? []).map((stage) => ({
					id: stage.id,
					name: stage.name,
					status: stage.status,
					startTimeMs: stage.startTimeMillis,
					durationMs: stage.durationMillis,
				})),
			};
		} catch (error) {
			if (error instanceof CliError && [ExitCode.NotFound, ExitCode.AuthError].includes(error.exitCode)) {
				return {
					available: false,
					reason:
						error.exitCode === ExitCode.NotFound
							? "Pipeline REST API is unavailable for this build"
							: "Access to Pipeline REST API was denied",
					items: [],
				};
			}
			throw error;
		}
	}

	async listArtifacts(refInput: string): Promise<{
		build: NormalizedBuildSummary;
		artifacts: NormalizedBuildArtifact[];
	}> {
		const ref = parseRef(refInput);
		const buildRef = ref.kind === "queue" ? parseRef((await this.getBuild(refInput)).url ?? refInput) : ref;

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
		return (await this.request(artifactUrl, {
			expect: "bytes",
		})) as Uint8Array;
	}

	async triggerBuild(
		jobPathInput: string,
		params: Record<string, string>,
	): Promise<{
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

	async getBuildLog(ref: string, options: LogOptions = {}): Promise<LogResult> {
		const deadline = Math.min(deadlineFor(options), this.deadline ?? Infinity);
		return readBuildLog(this.withDeadline(deadline), ref, { ...options, deadline });
	}

	async readLogPage(url: string, start: number): Promise<{ text: string; headers: Headers }> {
		return this.request(new URL("logText/progressiveText", ensureTrailingSlash(url)).toString(), {
			query: { start },
			expect: "textWithHeaders",
		}) as Promise<{ text: string; headers: Headers }>;
	}

	async waitForRef(ref: string, options: WaitOptions = {}): Promise<NormalizedBuildInfo> {
		const deadline = Math.min(deadlineFor(options), this.deadline ?? Infinity);
		return waitForBuild(this.withDeadline(deadline), ref, { ...options, deadline });
	}

	async watchBuild(job: string, options: WatchOptions): Promise<NormalizedBuildInfo> {
		const deadline = Math.min(deadlineFor(options), this.deadline ?? Infinity);
		return watchBuild(this.withDeadline(deadline), job, { ...options, deadline });
	}

	async getQueueItem(id: number): Promise<QueueItem> {
		return this.request(`/queue/item/${id}/api/json`, {
			query: {
				tree: "id,cancelled,blocked,buildable,stuck,why,task[name,url],executable[number,url]",
			},
		}) as Promise<QueueItem>;
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
			return this.http.url(`${jobPathToApiPath(ref.jobPath)}/${ref.buildNumber}/`);
		}
		return undefined;
	}

	private request(path: string, options: RequestOptions = {}): Promise<unknown> {
		return this.http.request(path, options);
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

function buildJobInfoTree(includeParameters: boolean): string {
	const base =
		"name,fullName,url,color,_class,description,buildable,lastBuild[number,url,result,building,timestamp],lastSuccessfulBuild[number,url,result],lastCompletedBuild[number,url,result],healthReport[score,description]";

	if (!includeParameters) {
		return base;
	}

	return `${base},property[_class,parameterDefinitions[name,description,type,_class,defaultValue,defaultParameterValue[value],choices]]`;
}
