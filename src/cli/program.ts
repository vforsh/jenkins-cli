import { readFileSync } from "node:fs";
import { Command } from "commander";
import { CliError } from "./errors.ts";
import { registerBuildCommand } from "./commands/build.ts";
import { registerConfigCommand } from "./commands/config.ts";
import { registerDoctorCommand } from "./commands/doctor.ts";
import { registerJobsCommand } from "./commands/jobs.ts";
import { registerResultCommand } from "./commands/result.ts";
import { registerSkillCommand } from "./commands/skill.ts";
import { registerWaitCommand } from "./commands/wait.ts";

export function buildProgram(): Command {
	const pkg = readPackageJson();
	const program = new Command();

	program
		.name("jenkins")
		.description("CLI for self-hosted Jenkins instances")
		.version(pkg.version ?? "0.0.0")
		.option("--json", "machine-readable JSON output")
		.option("--plain", "stable line-based output")
		.option("-q, --quiet", "suppress non-essential stderr output")
		.option("-v, --verbose", "verbose diagnostics to stderr")
		.option("--no-color", "disable ANSI colors")
		.option("--endpoint <url>", "override Jenkins endpoint")
		.option("--region <name>", "optional label for the current Jenkins instance")
		.option("--timeout <ms>", "HTTP timeout in milliseconds", (value) => Number.parseInt(value, 10))
		.option("--retries <count>", "retry count for transient network failures", (value) =>
			Number.parseInt(value, 10),
		)
		.hook("preAction", (command) => {
			const options = command.optsWithGlobals();
			if (options.json && options.plain) {
				throw new CliError("Use only one of --json or --plain", 2);
			}
		});

	registerJobsCommand(program);
	registerBuildCommand(program);
	registerWaitCommand(program);
	registerResultCommand(program);
	registerConfigCommand(program);
	registerDoctorCommand(program);
	registerSkillCommand(program);

	return program;
}

function readPackageJson(): { version?: string } {
	try {
		const url = new URL("../../package.json", import.meta.url);
		return JSON.parse(readFileSync(url, "utf8")) as { version?: string };
	} catch {
		return {};
	}
}
