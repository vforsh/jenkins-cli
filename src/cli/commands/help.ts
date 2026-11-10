import type { Command } from "commander";
import { CliError, ExitCode } from "../errors.ts";
import { emitData, toCliContext } from "../io.ts";

export function registerHelpCommand(program: Command): void {
	program.addHelpCommand(false);
	program
		.command("help")
		.description("Show command help; --json describes arguments, options and subcommands")
		.argument("[command...]", "command path, e.g. build watch")
		.action((path: string[]) => {
			let target = program;
			for (const name of path) {
				const child = target.commands.find(
					(command) => command.name() === name || command.aliases().includes(name),
				);
				if (!child) throw new CliError(`Unknown help command: ${path.join(" ")}`, ExitCode.BadArgs);
				target = child;
			}
			const ctx = toCliContext(program.optsWithGlobals());
			if (!ctx.json) {
				target.outputHelp();
				return;
			}
			emitData(ctx, {
				data: {
					command: ["jenkins", ...path].join(" "),
					description: target.description(),
					arguments: target.registeredArguments.map((arg) => ({
						name: arg.name(),
						required: arg.required,
						variadic: arg.variadic,
						description: arg.description,
					})),
					options: [...target.options, ...(target === program ? [] : program.options)].map((option) => ({
						flags: option.flags,
						description: option.description,
						default: option.defaultValue,
					})),
					commands: target.commands.map((command) => ({
						name: command.name(),
						aliases: command.aliases(),
						description: command.description(),
					})),
				},
			});
		});
}
