import type { Command } from "commander";
import { loadRuntime } from "../context.ts";
import { emitData } from "../io.ts";

export function registerResultCommand(program: Command): void {
	program
		.command("result")
		.description("Fetch the current result for a queue item or build")
		.argument("<ref>", "queue URL, build URL, queue:123, or job/path#123")
		.action(async (ref: string) => {
			const runtime = await loadRuntime(program);
			const data = await runtime.client.getBuild(ref);
			const plain = [`${String(data.result ?? "RUNNING")}\t${String(data.url ?? "")}`];
			const human = [
				`${String(data.fullDisplayName ?? data.displayName ?? ref)}`,
				`Result: ${String(data.result ?? "RUNNING")}`,
			];
			emitData(runtime.ctx, { data, human }, plain);
		});
}
