import type { Command } from "commander";
import { loadRuntime } from "../context.ts";
import { emitData } from "../io.ts";
import { checkResult, refSummary, waitFlags, waitOptions, type WaitFlags } from "../build-options.ts";

export function registerWaitCommand(program: Command): void {
	waitFlags(
		program
			.command("wait")
			.description("Wait for an exact queue item or build to complete")
			.argument("<ref>", "queue/build URL, queue:123, job/path#123 or job/path/123"),
	).action(async (ref: string, options: WaitFlags) => {
		const runtime = await loadRuntime(program);
		const data = await runtime.client.waitForRef(ref, waitOptions(options, runtime.ctx));
		checkResult(data, options.check);
		emitData(runtime.ctx, { data, human: refSummary(data) }, [data.url ?? data.ref]);
	});
}
