import { dirname, resolve, sep } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import type { Command } from "commander";
import { loadRuntime } from "../context.ts";
import { CliError, ExitCode } from "../errors.ts";
import { emitData } from "../io.ts";
import type { JenkinsClient } from "../../jenkins/client.ts";
import type { NormalizedBuildArtifact } from "../../jenkins/types.ts";

type ArtifactCommandOptions = {
	download?: string;
	downloadAll?: string;
	output?: string;
};

export type ArtifactDownloadPlan = {
	artifact: NormalizedBuildArtifact;
	destination: string;
};

export function registerArtifactsCommand(program: Command): void {
	program
		.command("artifacts")
		.description("List and download build artifacts")
		.argument("<ref>", "job path/URL, build URL, queue URL, queue:123, or job/path#123")
		.option("--download <artifact>", "download one artifact by relative path or unique filename")
		.option("--download-all <dir>", "download every artifact into a directory")
		.option("-o, --output <path>", "destination file for --download")
		.action(async (ref: string, options: ArtifactCommandOptions) => {
			validateArtifactOptions(options);

			const runtime = await loadRuntime(program);
			const artifactRef = await resolveArtifactRef(runtime.client, ref);
			const data = await runtime.client.listArtifacts(artifactRef);

			if (!options.download && !options.downloadAll) {
				emitData(
					runtime.ctx,
					{ data, human: formatArtifactsHuman(data.artifacts) },
					formatArtifactsPlain(data.artifacts),
				);
				return;
			}

			const plans = planDownloads(data.artifacts, options);

			for (const plan of plans) {
				await mkdir(dirname(plan.destination), { recursive: true });
				await writeFile(plan.destination, await runtime.client.downloadArtifact(plan.artifact.url));
			}

			const result = {
				build: data.build,
				downloads: plans.map((plan) => ({
					artifact: plan.artifact,
					destination: plan.destination,
				})),
			};

			const human = plans.map((plan) => `${plan.artifact.relativePath} -> ${plan.destination}`);
			const plain = plans.map((plan) => `${plan.artifact.relativePath}\t${plan.destination}`);
			emitData(runtime.ctx, { data: result, human }, plain);
		});
}

function validateArtifactOptions(options: ArtifactCommandOptions): void {
	if (options.download && options.downloadAll) {
		throw new CliError("Use only one of --download or --download-all", ExitCode.BadArgs);
	}
	if (options.output && !options.download) {
		throw new CliError("--output requires --download", ExitCode.BadArgs);
	}
}

async function resolveArtifactRef(client: JenkinsClient, input: string): Promise<string> {
	if (looksLikeBuildOrQueueRef(input)) {
		return input;
	}

	const job = await client.getJobInfo(input);
	const lastBuild = extractLastBuildRef(job.lastBuild, job.jobPath);
	if (!lastBuild) {
		throw new CliError(`Job has no latest build: ${job.jobPath}`, ExitCode.NotFound);
	}

	return lastBuild;
}

function looksLikeBuildOrQueueRef(input: string): boolean {
	const trimmed = input.trim();
	if (/^queue:\d+$/iu.test(trimmed) || trimmed.includes("#")) {
		return true;
	}

	try {
		const url = new URL(trimmed);
		return /\/queue\/item\/\d+\/?$/u.test(url.pathname) || /\/\d+\/?$/u.test(url.pathname);
	} catch {
		return false;
	}
}

function extractLastBuildRef(value: unknown, jobPath: string): string | null {
	if (!value || typeof value !== "object") {
		return null;
	}

	const build = value as { number?: unknown; url?: unknown };
	if (typeof build.url === "string" && build.url.length > 0) {
		return build.url;
	}
	if (typeof build.number === "number") {
		return `${jobPath}#${build.number}`;
	}

	return null;
}

export function selectArtifact(
	artifacts: NormalizedBuildArtifact[],
	query: string,
): NormalizedBuildArtifact {
	const matches = artifacts.filter(
		(artifact) => artifact.relativePath === query || artifact.fileName === query,
	);

	if (matches.length === 0) {
		throw new CliError(`Artifact not found: ${query}`, ExitCode.NotFound);
	}
	if (matches.length > 1) {
		throw new CliError(
			`Artifact name is ambiguous: ${query}. Use one of: ${matches
				.map((artifact) => artifact.relativePath)
				.join(", ")}`,
			ExitCode.BadArgs,
		);
	}

	return matches[0] as NormalizedBuildArtifact;
}

function planDownloads(
	artifacts: NormalizedBuildArtifact[],
	options: ArtifactCommandOptions,
): ArtifactDownloadPlan[] {
	if (options.download) {
		return [planSingleDownload(artifacts, options.download, options.output)];
	}

	return planDownloadAll(artifacts, options.downloadAll ?? ".");
}

export function planDownloadAll(
	artifacts: NormalizedBuildArtifact[],
	outputDir: string,
): ArtifactDownloadPlan[] {
	const root = resolve(outputDir);
	return artifacts.map((artifact) => ({
		artifact,
		destination: resolveInside(root, artifact.relativePath),
	}));
}

function planSingleDownload(
	artifacts: NormalizedBuildArtifact[],
	query: string,
	output?: string,
): ArtifactDownloadPlan {
	const artifact = selectArtifact(artifacts, query);
	return {
		artifact,
		destination: resolve(output ?? artifact.fileName),
	};
}

function formatArtifactsHuman(artifacts: NormalizedBuildArtifact[]): string[] {
	if (artifacts.length === 0) {
		return ["No artifacts"];
	}

	return artifacts.map((artifact) => `${artifact.relativePath}  ${artifact.url}`);
}

function formatArtifactsPlain(artifacts: NormalizedBuildArtifact[]): string[] {
	return artifacts.map((artifact) => `${artifact.relativePath}\t${artifact.url}`);
}

function resolveInside(root: string, relativePath: string): string {
	const destination = resolve(root, relativePath);
	const prefix = root.endsWith(sep) ? root : `${root}${sep}`;

	if (destination !== root && !destination.startsWith(prefix)) {
		throw new CliError(`Unsafe artifact path from Jenkins: ${relativePath}`, ExitCode.ApiError);
	}

	return destination;
}
