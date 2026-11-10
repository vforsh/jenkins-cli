import type { Command } from "commander";
import { loadRuntime } from "../context.ts";
import { emitData } from "../io.ts";
import { integer } from "../values.ts";
import { checkResult, refSummary, waitFlags, waitOptions, type WaitFlags } from "../build-options.ts";

type WatchFlags = WaitFlags & {
	commit?: string;
	repository?: string;
	after?: number;
	limit: number;
	downstreamJob?: string;
};

export function registerWatchCommand(build: Command, program: Command): void {
	waitFlags(
		build
			.command("watch")
			.description("Wait for a matching build to appear and finish; never triggers a build")
			.argument("<job>", "job path or URL")
			.option("--commit <sha>", "match a checked-out Git/SCM SHA (at least 7 hex characters)")
			.option("--repository <url>", "restrict SHA matching to this exact SCM repository URL")
			.option("--after <number>", "match build numbers strictly greater than this baseline", (v) =>
				integer(v, "--after"),
			)
			.option("--limit <count>", "recent builds to search per poll", (v) => integer(v, "--limit", 1), 100)
			.option("--downstream-job <job>", "also wait for a build in this job caused by the matched build"),
	).action(async (job: string, options: WatchFlags) => {
		const runtime = await loadRuntime(program);
		const data = await runtime.client.watchBuild(job, { ...options, ...waitOptions(options, runtime.ctx) });
		checkResult(data, options.check);
		emitData(runtime.ctx, { data, human: refSummary(data) }, [data.url ?? data.ref]);
	});
}
