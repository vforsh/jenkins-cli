import { CommanderError } from "commander";
import { buildProgram } from "./cli/program.ts";
import { CliError, ExitCode } from "./cli/errors.ts";
import { handleFatalError } from "./cli/io.ts";
import type { GlobalOptions } from "./cli/types.ts";

export async function main(argv: string[]): Promise<void> {
	const program = buildProgram();

	if (argv.length <= 2) {
		program.outputHelp();
		return;
	}

	let opts: GlobalOptions = {};
	try {
		program.parseOptions(argv.slice(2));
		const rawOpts = program.opts();
		opts = {
			json: rawOpts.json ?? false,
			plain: rawOpts.plain ?? false,
			quiet: rawOpts.quiet ?? false,
			verbose: rawOpts.verbose ?? false,
			noColor: rawOpts.noColor ?? false,
		};
	} catch {
		// Full parse below will surface the real error with formatting.
	}

	try {
		await program.parseAsync(argv);
	} catch (error) {
		if (error instanceof CommanderError) {
			if (error.code === "commander.help") {
				process.exit(error.exitCode);
			}

			const message = error.message.replace(/^error:\s*/i, "");
			handleFatalError(new CliError(message, ExitCode.BadArgs), opts);
		}

		handleFatalError(error, opts);
	}
}
