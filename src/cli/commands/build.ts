import type { Command } from "commander";
import { createWaitProgressReporter } from "../wait-progress.ts";
import { loadRuntime } from "../context.ts";
import { CliError, ExitCode } from "../errors.ts";
import { emitData, printStdout } from "../io.ts";

export function registerBuildCommand(program: Command): void {
	const build = program.command("build").alias("b").description("Inspect and trigger Jenkins builds");

	build
		.command("list")
		.alias("ls")
		.description("List recent builds for a job")
		.argument("<job>", "job path or URL")
		.option("--limit <count>", "maximum number of builds", (value) => Number.parseInt(value, 10), 10)
		.action(async (job: string, options: { limit: number }) => {
			const runtime = await loadRuntime(program);
			const data = await runtime.client.listBuilds(job, options.limit);
			const plain = data.map((item) => `${String(item.number)}\t${String(item.result ?? "")}\t${String(item.url ?? "")}`);
			const human = data.map(
				(item) =>
					`#${String(item.number)} ${item.result ?? (item.building ? "BUILDING" : "UNKNOWN")} ${String(item.url ?? "")}`,
			);
			emitData(runtime.ctx, { data, human }, plain);
		});

	build
		.command("info")
		.description("Inspect a build or queue reference")
		.argument("<ref>", "queue URL, build URL, queue:123, or job/path#123")
		.action(async (ref: string) => {
			const runtime = await loadRuntime(program);
			const data = await runtime.client.getBuild(ref);
			const plain = [String(data.url ?? `${data.jobPath ?? ""}#${data.number ?? ""}`)];
			const human = [
				`${String(data.fullDisplayName ?? data.displayName ?? data.url ?? ref)}`,
				`Result: ${String(data.result ?? "RUNNING")}`,
			];
			emitData(runtime.ctx, { data, human }, plain);
		});

	build
		.command("trigger")
		.alias("run")
		.description("Trigger a build, optionally with parameters")
		.argument("<job>", "job path or URL")
		.option("--param <key=value>", "build parameter", collectParams, [] as string[])
		.option("--params-json <json>", "JSON object of build parameters")
		.option("--wait", "wait until the build completes")
		.option("--progress", "stream wait progress to stderr")
		.option("--poll-ms <ms>", "poll interval while waiting", (value) => Number.parseInt(value, 10), 2_000)
		.option(
			"--wait-timeout-ms <ms>",
			"maximum total wait time",
			(value) => Number.parseInt(value, 10),
			10 * 60_000,
		)
		.action(
			async (
				job: string,
				options: {
					param: string[];
					paramsJson?: string;
					wait?: boolean;
					progress?: boolean;
					pollMs: number;
					waitTimeoutMs: number;
				},
			) => {
				const runtime = await loadRuntime(program);
				const params = parseBuildParams(options.param, options.paramsJson);
				if (options.progress && !options.wait) {
					throw new CliError("--progress requires --wait", ExitCode.BadArgs);
				}
				const triggered = await runtime.client.triggerBuild(job, params);

				if (!options.wait) {
					const plainValue = triggered.queueUrl ?? (triggered.queueId ? `queue:${triggered.queueId}` : triggered.jobPath);
					const human = [
						`Queued ${triggered.jobPath}`,
						triggered.queueUrl
							? `Queue item: ${triggered.queueUrl}`
							: triggered.queueId
								? `Queue item: queue:${triggered.queueId}`
								: "Queue item URL not returned by Jenkins",
					];
					emitData(runtime.ctx, { data: triggered, human }, [plainValue]);
					return;
				}

				const waitRef = triggered.queueUrl ?? (triggered.queueId ? `queue:${triggered.queueId}` : null);
				if (!waitRef) {
					throw new CliError("Jenkins did not return a queue reference to wait on", ExitCode.ApiError);
				}

				const buildInfo = await runtime.client.waitForRef(waitRef, {
					intervalMs: options.pollMs,
					waitTimeoutMs: options.waitTimeoutMs,
					onProgress: createWaitProgressReporter(runtime.ctx, options.progress ?? false),
				});
				const data = {
					triggered,
					build: buildInfo,
				};
				const plain = [String(buildInfo.url ?? `${buildInfo.jobPath ?? ""}#${buildInfo.number ?? ""}`)];
				const human = [
					`${String(buildInfo.fullDisplayName ?? buildInfo.displayName ?? "Build complete")}`,
					`Result: ${String(buildInfo.result ?? "UNKNOWN")}`,
				];
				emitData(runtime.ctx, { data, human }, plain);
			},
		);

	build
		.command("logs")
		.description("Print progressive console log output for a build")
		.argument("<ref>", "queue URL, build URL, queue:123, or job/path#123")
		.option("--follow", "stream until the build is finished")
		.option("--start <offset>", "byte offset to start from", (value) => Number.parseInt(value, 10), 0)
		.option("--poll-ms <ms>", "poll interval while following", (value) => Number.parseInt(value, 10), 2_000)
		.option(
			"--wait-timeout-ms <ms>",
			"maximum wait for a queued build to start",
			(value) => Number.parseInt(value, 10),
			10 * 60_000,
		)
		.action(
			async (
				ref: string,
				options: {
					follow?: boolean;
					start: number;
					pollMs: number;
					waitTimeoutMs: number;
				},
			) => {
				const runtime = await loadRuntime(program);

				if (runtime.ctx.json) {
					const data = await runtime.client.getBuildLog(ref, {
						start: options.start,
						follow: options.follow ?? false,
						intervalMs: options.pollMs,
						waitTimeoutMs: options.waitTimeoutMs,
					});
					emitData(runtime.ctx, { data });
					return;
				}

				await runtime.client.getBuildLog(ref, {
					start: options.start,
					follow: options.follow ?? false,
					intervalMs: options.pollMs,
					waitTimeoutMs: options.waitTimeoutMs,
					onChunk: (chunk) => {
						printStdout(chunk);
					},
				});
			},
		);
}

function collectParams(value: string, previous: string[]): string[] {
	previous.push(value);
	return previous;
}

function parseBuildParams(items: string[], jsonInput?: string): Record<string, string> {
	const params: Record<string, string> = {};

	for (const item of items) {
		const equalsIndex = item.indexOf("=");
		if (equalsIndex <= 0) {
			throw new CliError(`Invalid --param value: ${item}. Expected key=value.`, ExitCode.BadArgs);
		}
		params[item.slice(0, equalsIndex)] = item.slice(equalsIndex + 1);
	}

	if (jsonInput) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(jsonInput);
		} catch {
			throw new CliError("--params-json must be valid JSON", ExitCode.BadArgs);
		}
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new CliError("--params-json must be a JSON object", ExitCode.BadArgs);
		}

		for (const [key, value] of Object.entries(parsed)) {
			params[key] = value === null ? "" : String(value);
		}
	}

	return params;
}
