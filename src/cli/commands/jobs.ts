import type { Command } from "commander";
import { loadRuntime } from "../context.ts";
import { emitData } from "../io.ts";
import type { JobParameterDefinition, NormalizedJobInfo } from "../../jenkins/types.ts";

export function registerJobsCommand(program: Command): void {
	const jobs = program.command("jobs").alias("job").description("Inspect Jenkins jobs");

	jobs
		.command("list")
		.alias("ls")
		.description("List jobs at the root or inside a folder job")
		.argument("[path]", "optional folder job path")
		.option("-r, --recursive", "walk nested folders recursively")
		.action(async (path: string | undefined, options: { recursive?: boolean }) => {
			const runtime = await loadRuntime(program);
			const data = await runtime.client.listJobs(path, options.recursive ?? false);
			const plain = data.map((job) => String(job.fullName ?? job.name ?? ""));
			const human = data.map((job) => {
				const name = String(job.fullName ?? job.name ?? "unknown");
				const color = job.color ? ` [${String(job.color)}]` : "";
				return `${name}${color}`;
			});

			emitData(runtime.ctx, { data, human }, plain);
		});

	jobs
		.command("info")
		.description("Inspect a single job")
		.argument("<job>", "job path or job URL")
		.option("--parameters", "include parameter definitions")
		.action(async (job: string, options: { parameters?: boolean }) => {
			const runtime = await loadRuntime(program);
			const includeParameters = options.parameters ?? false;
			const data = await runtime.client.getJobInfo(job, {
				includeParameters,
			});
			const human = formatJobInfoHuman(data, includeParameters);
			const plain = formatJobInfoPlain(data, includeParameters);
			emitData(runtime.ctx, { data, human }, plain);
		});
}

function formatJobInfoHuman(data: NormalizedJobInfo, includeParameters: boolean): string[] {
	const lines = [
		String(data.fullName ?? data.name ?? data.jobPath),
		`URL: ${String(data.url ?? "unknown")}`,
		`Last build: ${formatLastBuild(data.lastBuild)}`,
	];

	if (!includeParameters) {
		return lines;
	}

	lines.push("Parameters:");
	const definitions = data.parameterDefinitions ?? [];
	if (definitions.length === 0) {
		lines.push("  none");
		return lines;
	}

	for (const definition of definitions) {
		lines.push(`  ${formatParameterHeadline(definition)}`);
		if (definition.description) {
			lines.push(`    ${definition.description}`);
		}
	}

	return lines;
}

function formatJobInfoPlain(data: NormalizedJobInfo, includeParameters: boolean): string[] {
	const lines = [String(data.url ?? data.fullName ?? data.name ?? data.jobPath)];

	if (!includeParameters) {
		return lines;
	}

	const definitions = data.parameterDefinitions ?? [];
	if (definitions.length === 0) {
		lines.push("parameters\tnone");
		return lines;
	}

	for (const definition of definitions) {
		lines.push(formatParameterPlainLine(definition));
	}

	return lines;
}

function formatLastBuild(value: unknown): string {
	if (!value || typeof value !== "object") {
		return "none";
	}

	const build = value as { number?: unknown; result?: unknown; url?: unknown };
	const parts = [
		typeof build.number === "number" ? `#${build.number}` : null,
		typeof build.result === "string" ? build.result : null,
		typeof build.url === "string" ? build.url : null,
	].filter((part): part is string => Boolean(part));

	return parts.length > 0 ? parts.join(" ") : "none";
}

function formatParameterHeadline(definition: JobParameterDefinition): string {
	const details = [
		definition.type,
		definition.defaultValue !== undefined ? `default=${formatPlainValue(definition.defaultValue)}` : null,
		definition.choices && definition.choices.length > 0 ? `choices=${definition.choices.join(", ")}` : null,
	].filter((part): part is string => Boolean(part));

	return `${definition.name}${details.length > 0 ? ` (${details.join("; ")})` : ""}`;
}

function formatPlainValue(value: unknown): string {
	if (value === undefined) {
		return "";
	}
	if (value === null) {
		return "null";
	}
	return String(value);
}

function formatParameterPlainLine(definition: JobParameterDefinition): string {
	return [
		"parameter",
		definition.name,
		definition.type,
		formatPlainValue(definition.defaultValue),
		(definition.choices ?? []).join(","),
		squashWhitespace(definition.description ?? ""),
	].join("\t");
}

function squashWhitespace(value: string): string {
	return value.replace(/\s+/gu, " ").trim();
}
