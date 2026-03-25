import { z } from "zod";
import { CliError, ExitCode } from "../cli/errors.ts";

export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_RETRIES = 1;

export const configSchema = z.object({
	endpoint: z.string().url().optional(),
	username: z.string().min(1).optional(),
	apiToken: z.string().min(1).optional(),
	region: z.string().min(1).optional(),
	timeoutMs: z.number().int().positive().optional(),
	retries: z.number().int().min(0).max(10).optional(),
});

export type Config = z.infer<typeof configSchema>;

export type ConfigKey =
	| "endpoint"
	| "username"
	| "api-token"
	| "region"
	| "timeout-ms"
	| "retries";

export const CONFIG_KEYS: ConfigKey[] = [
	"endpoint",
	"username",
	"api-token",
	"region",
	"timeout-ms",
	"retries",
];

export const SECRET_KEYS = new Set<ConfigKey>(["api-token"]);

export function mapConfigKey(key: ConfigKey): keyof Config {
	switch (key) {
		case "endpoint":
			return "endpoint";
		case "username":
			return "username";
		case "api-token":
			return "apiToken";
		case "region":
			return "region";
		case "timeout-ms":
			return "timeoutMs";
		case "retries":
			return "retries";
	}
}

export function parseConfigKey(input: string): ConfigKey {
	if ((CONFIG_KEYS as string[]).includes(input)) {
		return input as ConfigKey;
	}

	throw new CliError(
		`Unknown config key: ${input}. Expected one of: ${CONFIG_KEYS.join(", ")}`,
		ExitCode.BadArgs,
	);
}

export function coerceConfigValue(key: ConfigKey, value: string): Config[keyof Config] {
	switch (key) {
		case "endpoint":
			try {
				return new URL(value).toString().replace(/\/$/, "");
			} catch {
				throw new CliError("endpoint must be a valid URL", ExitCode.BadArgs);
			}
		case "username":
		case "api-token":
		case "region":
			if (value.trim().length === 0) {
				throw new CliError(`${key} must not be empty`, ExitCode.BadArgs);
			}
			return value;
		case "timeout-ms":
		case "retries": {
			const parsed = Number.parseInt(value, 10);
			if (!Number.isFinite(parsed)) {
				throw new CliError(`${key} must be an integer`, ExitCode.BadArgs);
			}
			if (key === "timeout-ms" && parsed <= 0) {
				throw new CliError("timeout-ms must be greater than 0", ExitCode.BadArgs);
			}
			if (key === "retries" && parsed < 0) {
				throw new CliError("retries must be 0 or greater", ExitCode.BadArgs);
			}
			return parsed;
		}
	}
}
