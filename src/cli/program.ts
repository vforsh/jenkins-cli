import { readFileSync } from "node:fs";
import { Command } from "commander";
import { duration, integer } from "./values.ts";
import { toCliContext } from "./io.ts";
import { CliError } from "./errors.ts";
import { registerArtifactsCommand } from "./commands/artifacts.ts";
import { registerBuildCommand } from "./commands/build.ts";
import { registerConfigCommand } from "./commands/config.ts";
import { registerDoctorCommand } from "./commands/doctor.ts";
import { registerHelpCommand } from "./commands/help.ts";
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
		.option("--fields <paths>", "select data fields in JSON, e.g. number,result,scm.revisions")
		.option("--plain", "stable line-based output")
		.option("-q, --quiet", "suppress non-essential stderr output")
		.option("-v, --verbose", "verbose diagnostics to stderr")
		.option("--no-color", "disable ANSI colors")
		.option("--endpoint <url>", "override Jenkins endpoint")
		.option("--region <name>", "optional label for the current Jenkins instance")
		.option("--request-timeout <duration>", "HTTP request timeout, e.g. 30s", (v) =>
			duration(v, "--request-timeout"),
		)
		.option("--timeout <ms>", "legacy HTTP timeout in milliseconds; use --wait-timeout for builds", (v) =>
			integer(v, "--timeout", 1),
		)
		.option("--retries <count>", "retry count for transient network failures", (value) =>
			integer(value, "--retries"),
		)
		.hook("preAction", (command) => {
			const options = command.optsWithGlobals();
			toCliContext(options);
			if (options.fields && !options.json) throw new CliError("--fields requires --json", 2);
			if (options.timeout !== undefined && options.requestTimeout !== undefined)
				throw new CliError("Use only one of --timeout or --request-timeout", 2);
			if (options.json && options.plain) {
				throw new CliError("Use only one of --json or --plain", 2);
			}
		});

	registerJobsCommand(program);
	registerBuildCommand(program);
	registerArtifactsCommand(program);
	registerWaitCommand(program);
	registerResultCommand(program);
	registerConfigCommand(program);
	registerDoctorCommand(program);
	registerSkillCommand(program);

	registerHelpCommand(program);
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
