import { createInterface, emitKeypressEvents } from "node:readline";
import { CliError, ExitCode } from "../cli/errors.ts";

type PromptOptions = {
	label: string;
	secret?: boolean;
	input?: NodeJS.ReadStream;
	output?: NodeJS.WriteStream;
};

export async function promptValue(options: PromptOptions): Promise<string | null> {
	const input = options.input ?? process.stdin;
	const output = options.output ?? process.stderr;

	if (!input.isTTY || !output.isTTY) {
		return null;
	}

	if (options.secret) {
		return promptSecret(options.label, input, output);
	}

	return promptPlain(options.label, input, output);
}

async function promptPlain(
	label: string,
	input: NodeJS.ReadStream,
	output: NodeJS.WriteStream,
): Promise<string> {
	const readline = createInterface({ input, output, terminal: true });

	try {
		return await new Promise<string>((resolve) => {
			readline.question(`${label}: `, resolve);
		});
	} finally {
		readline.close();
	}
}

function promptSecret(
	label: string,
	input: NodeJS.ReadStream,
	output: NodeJS.WriteStream,
): Promise<string> {
	return new Promise((resolve, reject) => {
		let value = "";
		let settled = false;
		const wasRaw = input.isRaw ?? false;

		const cleanup = () => {
			input.off("keypress", onKeypress);
			input.setRawMode(wasRaw);
			if (!wasRaw) {
				input.pause();
			}
		};

		const settle = (next: () => void) => {
			if (settled) {
				return;
			}
			settled = true;
			cleanup();
			output.write("\n");
			next();
		};

		const redraw = () => {
			// Clear the prompt line so backspace never leaves stale mask characters behind.
			output.write(`\r\x1b[2K${label}: ${"*".repeat(value.length)}`);
		};

		const onKeypress = (text: string, key: { ctrl?: boolean; name?: string }) => {
			if (key.ctrl && key.name === "c") {
				settle(() => reject(new CliError("Prompt cancelled", ExitCode.BadArgs)));
				return;
			}

			if (key.name === "return" || key.name === "enter") {
				settle(() => resolve(value));
				return;
			}

			if (key.name === "backspace" || key.name === "delete") {
				value = value.slice(0, -1);
				redraw();
				return;
			}

			if (key.ctrl || key.name === "tab" || key.name === "escape") {
				return;
			}

			value += text;
			redraw();
		};

		emitKeypressEvents(input);
		input.on("keypress", onKeypress);
		input.setRawMode(true);
		input.resume();
		output.write(`${label}: `);
	});
}
