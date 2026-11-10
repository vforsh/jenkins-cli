import type { Command } from "commander";
import { loadRuntime } from "../context.ts";
import { emitData } from "../io.ts";
import { integer } from "../values.ts";
import { checkResult, includeFlags, infoOptions, refSummary } from "../build-options.ts";
import { registerTriggerCommand } from "./build-trigger.ts";
import { registerLogsCommand } from "./build-logs.ts";
import { registerWatchCommand } from "./build-watch.ts";
import type { BuildInclude } from "../../jenkins/types.ts";

export function registerBuildCommand(program: Command): void {
	const build = program.command("build").alias("b").description("Inspect, trigger and watch Jenkins builds");
	build
		.command("list")
		.alias("ls")
		.description("List recent builds for a job")
		.argument("<job>", "job path or URL")
		.option("--limit <count>", "maximum number of builds", (v) => integer(v, "--limit", 1), 10)
		.action(async (job: string, options: { limit: number }) => {
			const runtime = await loadRuntime(program);
			const data = await runtime.client.listBuilds(job, options.limit);
			emitData(
				runtime.ctx,
				{
					data,
					human: data.map(
						(item) =>
							`#${item.number} ${item.result ?? (item.building ? "BUILDING" : "UNKNOWN")} ${item.url ?? ""}`,
					),
				},
				data.map((item) => `${item.number}\t${item.result ?? ""}\t${item.url ?? ""}`),
			);
		});

	includeFlags(
		build
			.command("info")
			.alias("show")
			.alias("get")
			.description("Inspect a build or queued item")
			.argument("<ref>", "queue:123, job/path#123, job/path/123, or queue/build URL")
			.option("--check", "exit 9 unless the completed build result is SUCCESS"),
	).action(
		async (
			ref: string,
			options: { include?: BuildInclude[]; downstreamJob?: string[]; relatedLimit?: number; check?: boolean },
		) => {
			const runtime = await loadRuntime(program);
			const data = await runtime.client.inspectRef(ref, infoOptions(options));
			checkResult(data, options.check);
			emitData(runtime.ctx, { data, human: refSummary(data) }, [data.url ?? data.ref]);
		},
	);
	registerTriggerCommand(build, program);
	registerLogsCommand(build, program);
	registerWatchCommand(build, program);
}
