import type { Command } from "commander";
import { loadRuntime } from "../context.ts";
import { emitData } from "../io.ts";
import { createWaitProgressReporter } from "../wait-progress.ts";

export function registerWaitCommand(program: Command): void {
	program
		.command("wait")
		.description("Wait for a queue item or build to complete")
		.argument("<ref>", "queue URL, build URL, queue:123, or job/path#123")
		.option("--progress", "stream wait progress to stderr")
		.option("--poll-ms <ms>", "poll interval", (value) => Number.parseInt(value, 10), 2_000)
		.option(
			"--wait-timeout-ms <ms>",
			"maximum total wait time",
			(value) => Number.parseInt(value, 10),
			10 * 60_000,
		)
		.action(
			async (
				ref: string,
				options: {
					progress?: boolean;
					pollMs: number;
					waitTimeoutMs: number;
				},
			) => {
				const runtime = await loadRuntime(program);
				const data = await runtime.client.waitForRef(ref, {
					intervalMs: options.pollMs,
					waitTimeoutMs: options.waitTimeoutMs,
					onProgress: createWaitProgressReporter(runtime.ctx, options.progress ?? false),
				});
				const plain = [String(data.url ?? `${data.jobPath ?? ""}#${data.number ?? ""}`)];
				const human = [
					`${String(data.fullDisplayName ?? data.displayName ?? "Build complete")}`,
					`Result: ${String(data.result ?? "UNKNOWN")}`,
				];
				emitData(runtime.ctx, { data, human }, plain);
			},
		);
}
