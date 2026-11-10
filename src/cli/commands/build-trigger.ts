import type { Command } from "commander";
import { loadRuntime } from "../context.ts";
import { CliError, ExitCode } from "../errors.ts";
import { emitData } from "../io.ts";
import { checkResult, refSummary, waitFlags, waitOptions, type WaitFlags } from "../build-options.ts";

type TriggerFlags = WaitFlags & { param: string[]; paramsJson?: string; wait?: boolean };

export function registerTriggerCommand(build: Command, program: Command): void {
	waitFlags(
		build
			.command("trigger")
			.alias("run")
			.description("Trigger a build, optionally with parameters")
			.argument("<job>", "job path or URL")
			.option("--param <key=value>", "build parameter", collectParams, [] as string[])
			.option("--params-json <json>", "JSON object of build parameters")
			.option("--wait", "wait until the build completes"),
	).action(async (job: string, options: TriggerFlags) => {
		const params = parseBuildParams(options.param, options.paramsJson);
		if ((options.progress || options.check) && !options.wait)
			throw new CliError("--progress and --check require --wait", ExitCode.BadArgs);
		const runtime = await loadRuntime(program);
		const timing = waitOptions(options, runtime.ctx);
		const client = options.wait
			? runtime.client.withDeadline(Date.now() + timing.waitTimeoutMs!)
			: runtime.client;
		const triggered = await client.triggerBuild(job, params);
		const ref = triggered.queueUrl ?? (triggered.queueId !== null ? `queue:${triggered.queueId}` : null);
		if (!options.wait) {
			emitData(
				runtime.ctx,
				{
					data: triggered,
					human: [`Queued ${triggered.jobPath}`, ref ?? "Queue item URL not returned by Jenkins"],
				},
				[ref ?? triggered.jobPath],
			);
			return;
		}
		if (!ref)
			throw new CliError(
				"Jenkins did not return a queue reference to wait on; the build may already be queued",
				ExitCode.ApiError,
			);
		const buildInfo = await client.waitForRef(ref, timing);
		checkResult(buildInfo, options.check);
		emitData(runtime.ctx, { data: { triggered, build: buildInfo }, human: refSummary(buildInfo) }, [
			buildInfo.url ?? buildInfo.ref,
		]);
	});
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
