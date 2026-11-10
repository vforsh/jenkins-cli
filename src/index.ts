import { CommanderError } from "commander";
import { buildProgram } from "./cli/program.ts";
import { CliError, ExitCode } from "./cli/errors.ts";
import { handleFatalError } from "./cli/io.ts";

export async function main(argv: string[]): Promise<void> {
	const program = buildProgram();
	// Error formatting must work even when parsing fails before reaching global options.
	const raw = {
		verbose: argv.includes("--verbose") || argv.includes("-v"),
		json: argv.slice(2, argv.indexOf("--") < 0 ? undefined : argv.indexOf("--")).includes("--json"),
	};
	let diagnostic = "";
	const configure = (command: typeof program): void => {
		command.exitOverride().configureOutput({
			writeErr: (text) => {
				diagnostic += text;
			},
		});
		command.commands.forEach(configure);
	};
	configure(program);
	try {
		if (argv.length <= 2) {
			program.outputHelp();
			return;
		}
		await program.parseAsync(argv);
	} catch (error) {
		if (error instanceof CommanderError) {
			if (error.exitCode === 0) return;
			const code = COMMANDER_ERROR_CODES[error.code] ?? "INVALID_ARGUMENT";
			const hint = diagnostic.match(/\(Did you mean[^\n]+/u)?.[0];
			handleFatalError(
				new CliError(error.message.replace(/^error:\s*/iu, ""), {
					exitCode: ExitCode.BadArgs,
					code,
					hint: hint
						? `${hint} Run jenkins help --json for command syntax.`
						: "Run jenkins help --json for command syntax.",
				}),
				raw,
			);
		}
		handleFatalError(error, raw);
	}
}

const COMMANDER_ERROR_CODES: Record<string, string> = {
	"commander.unknownCommand": "UNKNOWN_COMMAND",
	"commander.unknownOption": "UNKNOWN_OPTION",
};
