import type { Command } from "commander";
import { loadRuntime } from "../context.ts";
import { emitData, printStdout, status } from "../io.ts";
import { integer } from "../values.ts";
import { waitFlags, waitOptions, type WaitFlags } from "../build-options.ts";
import type { LogOptions } from "../../jenkins/types.ts";

type LogFlags = WaitFlags & Omit<LogOptions, "onChunk">;

export function registerLogsCommand(build: Command, program: Command): void {
	const command = waitFlags(
		build
			.command("logs")
			.alias("log")
			.description("Read bounded console logs, optionally resuming a cursor")
			.argument("<ref>", "queue/build URL, queue:123, job/path#123 or job/path/123")
			.option("--follow", "follow until finished, within the total wait budget")
			.option("--start <offset>", "server byte offset (legacy alternative to --cursor)", (v) =>
				integer(v, "--start"),
			)
			.option("--cursor <cursor>", "resume from a cursor returned by this build's previous JSON response")
			.option("--tail <lines>", "return only the last N selected lines", (v) => integer(v, "--tail", 1))
			.option("--grep <regex>", "select matching lines (JavaScript regular expression)")
			.option("--context <lines>", "include surrounding lines for --grep", (v) => integer(v, "--context"))
			.option("--max-bytes <bytes>", "cap returned text, keeping its end (JSON default: 65536)", (v) =>
				integer(v, "--max-bytes", 1),
			),
		false,
	);
	command.action(async (ref: string, options: LogFlags) => {
		const runtime = await loadRuntime(program);
		const timing = waitOptions(options, runtime.ctx);
		const streaming =
			!runtime.ctx.json &&
			options.tail === undefined &&
			options.grep === undefined &&
			options.maxBytes === undefined;
		const data = await runtime.client.getBuildLog(ref, {
			...options,
			...timing,
			onChunk: streaming ? printStdout : undefined,
		});
		if (runtime.ctx.json) emitData(runtime.ctx, { data });
		else if (!streaming) printStdout(data.text.endsWith("\n") || !data.text ? data.text : data.text + "\n");
		if (data.truncated && !runtime.ctx.json)
			status(runtime.ctx, "Log output truncated; use --json for the continuation cursor.");
	});
}
