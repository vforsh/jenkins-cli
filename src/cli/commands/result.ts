import type { Command } from "commander";
import { loadRuntime } from "../context.ts";
import { emitData } from "../io.ts";
import { checkResult, refSummary } from "../build-options.ts";

export function registerResultCommand(program: Command): void {
	program
		.command("result")
		.description("Fetch the current queue or build state")
		.argument("<ref>", "queue/build URL, queue:123, job/path#123 or job/path/123")
		.option("--check", "exit 9 unless the completed build result is SUCCESS")
		.action(async (ref: string, options: { check?: boolean }) => {
			const runtime = await loadRuntime(program);
			const data = await runtime.client.inspectRef(ref);
			checkResult(data, options.check);
			emitData(runtime.ctx, { data, human: refSummary(data) }, [
				`${"result" in data ? (data.result ?? "RUNNING") : data.state.toUpperCase()}\t${data.url ?? data.ref}`,
			]);
		});
}
