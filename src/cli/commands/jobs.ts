import type { Command } from "commander";
import { loadRuntime } from "../context.ts";
import { emitData } from "../io.ts";

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
		.action(async (job: string) => {
			const runtime = await loadRuntime(program);
			const data = await runtime.client.getJobInfo(job);
			const human = [
				`${String(data.fullName ?? data.name)}`,
				`URL: ${String(data.url ?? "unknown")}`,
				`Last build: ${data.lastBuild ? JSON.stringify(data.lastBuild) : "none"}`,
			];
			emitData(runtime.ctx, { data, human }, [String(data.url ?? data.fullName ?? data.name ?? "")]);
		});
}
