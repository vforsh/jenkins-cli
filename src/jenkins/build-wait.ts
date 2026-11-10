import { CliError, ExitCode } from "../cli/errors.ts";
import type { JenkinsClient } from "./client.ts";
import { normalizeJobPath } from "./ref.ts";
import { normalizeScm } from "./build-metadata.ts";
import { deadlineFor, pause, waitTimeout, withinWait } from "./timing.ts";
import { createFinishedWaitEvent, createRunningWaitEvent, createStartedWaitEvent } from "./wait-events.ts";
import type {
	BuildApiInfo,
	ScmRevision,
	NormalizedBuildInfo,
	RefInfo,
	WaitEvent,
	WaitOptions,
	WatchOptions,
} from "./types.ts";

export async function waitForExecutable(
	client: JenkinsClient,
	input: string,
	options: WaitOptions,
): Promise<NormalizedBuildInfo> {
	const deadline = deadlineFor(options);
	let last: RefInfo | undefined;
	let lastEvent = "";
	while (Date.now() < deadline) {
		last = await withinWait(client.inspectRef(input), input, last ?? { ref: input });
		if (!("queueId" in last)) return last;
		if (last.state === "cancelled")
			throw new CliError(`Queue item was cancelled: ${last.ref}`, {
				exitCode: ExitCode.BuildFailed,
				code: "QUEUE_CANCELLED",
				details: last,
			});
		const event: WaitEvent = {
			kind: "queued",
			queueId: last.queueId,
			jobPath: last.jobPath,
			why: last.why,
			blocked: last.blocked,
			stuck: last.stuck,
			buildable: last.buildable,
		};
		const key = JSON.stringify(event);
		if (key !== lastEvent) options.onProgress?.(event);
		lastEvent = key;
		await pause(deadline, options.intervalMs);
	}
	throw waitTimeout(input, last ?? { ref: input });
}

export async function waitForBuild(
	client: JenkinsClient,
	input: string,
	options: WaitOptions,
): Promise<NormalizedBuildInfo> {
	const deadline = deadlineFor(options);
	let build = await waitForExecutable(client, input, options);
	options.onProgress?.(createStartedWaitEvent(build));
	while (!build.complete) {
		options.onProgress?.(createRunningWaitEvent(build));
		await pause(deadline, options.intervalMs);
		if (Date.now() >= deadline) throw waitTimeout(build.ref, build);
		// Once assigned, follow this exact build even if the queue record expires or a newer build starts.
		build = await withinWait(client.getBuild(build.ref), build.ref, build);
	}
	options.onProgress?.(createFinishedWaitEvent(build));
	return build;
}

export async function watchBuild(
	client: JenkinsClient,
	jobInput: string,
	options: WatchOptions,
): Promise<NormalizedBuildInfo> {
	const job = normalizeJobPath(jobInput);
	if (!options.commit && options.after === undefined) {
		throw new CliError("build watch requires --commit <sha> or --after <number>", ExitCode.BadArgs);
	}
	if (options.repository && !options.commit)
		throw new CliError("--repository requires --commit", ExitCode.BadArgs);
	if (options.commit && !/^[a-f\d]{7,64}$/iu.test(options.commit)) {
		throw new CliError(
			"--commit must be a hexadecimal SHA of 7–64 characters; resolve HEAD with git rev-parse HEAD",
			ExitCode.BadArgs,
		);
	}
	const deadline = deadlineFor(options);
	const limit = options.limit ?? 100;
	let scanned = 0;
	while (Date.now() < deadline) {
		const candidates = (
			await withinWait(
				client.buildCandidates(job, limit, options.commit ? ["scm"] : []),
				`a matching build of ${job}`,
				{ jobPath: job, commit: options.commit, after: options.after, searchLimit: limit },
			)
		).filter((build) => (build.number ?? 0) > (options.after ?? 0));
		scanned = candidates.length;
		const selected = selectMatchingBuild(candidates, options);
		if (selected?.number !== undefined) {
			const parent = await client.waitForRef(`${job}#${selected.number}`, options);
			if (!options.downstreamJob)
				return withinWait(client.getBuild(parent.ref, { include: ["scm"] }), parent.ref, parent);
			return waitForDownstream(client, parent, options);
		}
		await pause(deadline, options.intervalMs);
	}
	throw waitTimeout(`a matching build of ${job}`, {
		jobPath: job,
		commit: options.commit,
		after: options.after,
		searchLimit: limit,
		scanned,
	});
}

function selectMatchingBuild(candidates: BuildApiInfo[], options: WatchOptions): BuildApiInfo | undefined {
	const wanted = options.commit?.toLowerCase() ?? "";
	const indexed = candidates.map((build) => ({
		build,
		revisions: wanted ? normalizeScm(build).revisions : [],
	}));
	const matchesRevision = (revision: ScmRevision) =>
		revision.sha.toLowerCase().startsWith(wanted) &&
		(!options.repository || revision.repository === options.repository);
	const matching = indexed.filter((candidate) => !wanted || candidate.revisions.some(matchesRevision));
	if (wanted) {
		const shas = new Set(
			matching
				.flatMap((candidate) => candidate.revisions)
				.filter(matchesRevision)
				.map((revision) => revision.sha.toLowerCase()),
		);
		if (shas.size > 1) {
			throw new CliError("Commit prefix is ambiguous; use the full SHA", {
				exitCode: ExitCode.BadArgs,
				code: "AMBIGUOUS_COMMIT",
			});
		}
		if (
			indexed.length &&
			indexed.every((candidate) => !candidate.build.building && !candidate.revisions.length)
		) {
			throw new CliError("Jenkins exposes no checked-out revisions for the searched builds", {
				exitCode: ExitCode.ApiError,
				code: "SCM_UNAVAILABLE",
				hint: "Use --after only if build-number matching is sufficient, or expose Git/SCM revision metadata in Jenkins.",
			});
		}
	}
	return matching.sort((a, b) => (b.build.number ?? 0) - (a.build.number ?? 0))[0]?.build;
}

async function waitForDownstream(
	client: JenkinsClient,
	parent: NormalizedBuildInfo,
	options: WatchOptions,
): Promise<NormalizedBuildInfo> {
	const deadline = deadlineFor(options);
	if (parent.result !== "SUCCESS")
		throw new CliError(`Upstream build ${parent.ref} finished with ${parent.result}`, {
			exitCode: ExitCode.BuildFailed,
			details: parent,
		});
	while (Date.now() < deadline) {
		const found = await withinWait(
			client.findDownstream(parent, [options.downstreamJob!], options.limit ?? 100),
			`a downstream build of ${parent.ref}`,
			{ upstream: parent.ref, downstreamJob: options.downstreamJob },
		);
		const child = found.builds.sort((a, b) => b.number - a.number)[0];
		if (child) {
			const finished = await client.waitForRef(child.ref, options);
			return withinWait(
				client.getBuild(finished.ref, { include: ["scm", "related"] }),
				finished.ref,
				finished,
			);
		}
		await pause(deadline, options.intervalMs);
	}
	throw waitTimeout(`a downstream build in ${options.downstreamJob}`, {
		upstream: parent.ref,
		downstreamJob: options.downstreamJob,
		searchLimit: options.limit ?? 100,
	});
}
