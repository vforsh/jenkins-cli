import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { CliError, ExitCode } from "../cli/errors.ts";
import { configSchema, type Config } from "./schema.ts";

export function getConfigPath(command = "jenkins"): string {
	const xdg = process.env.XDG_CONFIG_HOME;
	const base = xdg && xdg.trim().length > 0 ? xdg : join(homedir(), ".config");
	return join(base, command, "config.json");
}

export async function loadConfig(path = getConfigPath()): Promise<Config> {
	try {
		const raw = await readFile(path, "utf8");
		return configSchema.parse(JSON.parse(raw));
	} catch (error) {
		if (isMissing(error)) {
			return {};
		}

		if (error instanceof SyntaxError) {
			throw new CliError(`Config JSON is invalid: ${path}`, ExitCode.ConfigError);
		}

		throw error;
	}
}

export async function saveConfig(config: Config, path = getConfigPath()): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const validated = configSchema.parse(config);
	await writeFile(path, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
}

function isMissing(error: unknown): boolean {
	return Boolean(
		error && typeof error === "object" && "code" in error && (error as { code: string }).code === "ENOENT",
	);
}
