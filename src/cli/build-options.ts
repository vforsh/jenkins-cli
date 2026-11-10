import type { Command } from "commander";
import { CliError, ExitCode } from "./errors.ts";
import { duration, integer } from "./values.ts";
import { createWaitProgressReporter } from "./wait-progress.ts";
import type { CliContext } from "./types.ts";
import type { BuildInclude, BuildInfoOptions, RefInfo, WaitOptions } from "../jenkins/types.ts";

export type WaitFlags = {
	pollMs?: number;
	waitTimeoutMs?: number;
	waitTimeout?: number;
	progress?: boolean;
	check?: boolean;
};

export function waitFlags(command: Command, check = true): Command {
	command
		.option("--progress", "stream wait progress to stderr")
		.option("--poll-ms <ms>", "poll interval in milliseconds", (v) => integer(v, "--poll-ms", 1), 2_000)
		.option("--wait-timeout <duration>", "total wait budget, e.g. 55s or 20m (default: 10m)", (v) =>
			duration(v, "--wait-timeout"),
		)
		.option("--wait-timeout-ms <ms>", "legacy total wait budget in milliseconds", (v) =>
			integer(v, "--wait-timeout-ms", 1),
		);
	if (check) command.option("--check", "exit 9 unless the completed build result is SUCCESS");
	return command;
}

export function waitOptions(options: WaitFlags, ctx: CliContext): WaitOptions {
	if (options.waitTimeout !== undefined && options.waitTimeoutMs !== undefined) {
		throw new CliError("Use only one of --wait-timeout or --wait-timeout-ms", ExitCode.BadArgs);
	}
	return {
		intervalMs: options.pollMs,
		waitTimeoutMs: options.waitTimeout ?? options.waitTimeoutMs ?? 600_000,
		onProgress: createWaitProgressReporter(ctx, options.progress ?? false),
	};
}

export function includeFlags(command: Command): Command {
	return command
		.option("--include <sections>", "extra data: scm,related,stages (comma-separated)", parseInclude)
		.option(
			"--downstream-job <job>",
			"find builds of this job caused by this build (repeatable)",
			(v, previous: string[]) => [...previous, v],
			[],
		)
		.option(
			"--related-limit <count>",
			"maximum recent builds to search per downstream job",
			(v) => integer(v, "--related-limit", 1),
			50,
		);
}

export function infoOptions(options: {
	include?: BuildInclude[];
	downstreamJob?: string[];
	relatedLimit?: number;
}): BuildInfoOptions {
	const include = options.include ?? [];
	return {
		include: options.downstreamJob?.length ? [...new Set<BuildInclude>([...include, "related"])] : include,
		downstreamJobs: options.downstreamJob,
		relatedLimit: options.relatedLimit,
	};
}

function parseInclude(input: string): BuildInclude[] {
	const values = input.split(",");
	if (values.some((value) => !["scm", "related", "stages"].includes(value))) {
		throw new CliError("--include accepts scm,related,stages", ExitCode.BadArgs);
	}
	return [...new Set(values)] as BuildInclude[];
}

export function checkResult(info: RefInfo, check?: boolean): void {
	if (!check) return;
	if (!info.complete)
		throw new CliError(`Build has not completed: ${info.ref}`, {
			exitCode: ExitCode.BuildFailed,
			code: "BUILD_INCOMPLETE",
			details: info,
		});
	if (!("result" in info) || info.result !== "SUCCESS") process.exitCode = ExitCode.BuildFailed;
}

export function refSummary(info: RefInfo): string[] {
	const lines = [
		info.ref,
		`Result: ${"result" in info ? (info.result ?? "RUNNING") : info.state.toUpperCase()}`,
	];
	if ("queueId" in info) {
		if (info.why) lines.push(info.why);
		return lines;
	}
	if (info.scm) {
		lines.push(
			...info.scm.revisions.map(
				(revision) => `SCM: ${revision.sha} ${revision.repository ?? ""} ${revision.branches.join(", ")}`,
			),
		);
		if (!info.scm.available) lines.push("SCM: checked-out revision metadata unavailable");
	}
	if (info.related) {
		lines.push(...info.related.upstream.map((build) => `Upstream: ${build.ref}`));
		lines.push(
			...info.related.downstream.map((build) => `Downstream: ${build.ref} ${build.result ?? "RUNNING"}`),
		);
		if (!info.related.downstreamSearch.jobs.length)
			lines.push("Downstream: pass --downstream-job to search by upstream cause");
		if (info.related.downstreamSearch.truncated)
			lines.push("Downstream search limited; increase --related-limit for older builds");
	}
	if (info.stages) {
		lines.push(...info.stages.items.map((stage) => `Stage: ${stage.name} ${stage.status}`));
		if (!info.stages.available) lines.push(`Stages: ${info.stages.reason}`);
	}
	return lines;
}
