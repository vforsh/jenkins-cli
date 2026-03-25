import type { Command } from "commander";
import { emitData, toCliContext } from "../io.ts";
import { CliError, ExitCode } from "../errors.ts";
import {
	CONFIG_KEYS,
	SECRET_KEYS,
	coerceConfigValue,
	mapConfigKey,
	parseConfigKey,
	type Config,
	type ConfigKey,
} from "../../config/schema.ts";
import { redactConfig, resolveEffectiveConfig } from "../../config/effective.ts";
import { getConfigPath, loadConfig, saveConfig } from "../../config/store.ts";
import { readStdinString, readStdinTrimmed } from "../../util/stdin.ts";

export function registerConfigCommand(program: Command): void {
	const config = program.command("config").alias("cfg").description("Manage Jenkins CLI config");

	config
		.command("path")
		.description("Print config file path")
		.action(() => {
			const ctx = getConfigContext(program);
			const path = configPath();
			emitData(ctx, { data: { path }, human: path }, [path]);
		});

	config
		.command("list")
		.alias("ls")
		.description("List effective config values")
		.action(async () => {
			const ctx = getConfigContext(program);
			const resolved = await resolveEffectiveConfig(ctx);
			const data = {
				path: resolved.path,
				config: redactConfig(resolved.config),
			};
			const plain = Object.entries(data.config).flatMap(([key, value]) =>
				value === undefined ? [] : [`${key}=${String(value)}`],
			);
			emitData(ctx, { data }, plain);
		});

	config
		.command("get")
		.description("Get one or more config values")
		.argument("<keys...>", `one or more of: ${CONFIG_KEYS.join(", ")}`)
		.action(async (keys: string[]) => {
			const ctx = getConfigContext(program);
			const resolved = await resolveEffectiveConfig(ctx);
			const data: Record<string, unknown> = {};

			for (const input of keys) {
				const key = parseConfigKey(input);
				const mapped = mapConfigKey(key);
				const value = resolved.config[mapped];
				if (value === undefined) {
					throw new CliError(`Config key is not set: ${key}`, ExitCode.ConfigError);
				}
				data[key] = SECRET_KEYS.has(key) ? "[redacted]" : value;
			}

			const plain = Object.entries(data).map(([key, value]) => `${key}=${String(value)}`);
			emitData(ctx, { data }, plain);
		});

	config
		.command("set")
		.description("Set config values. Secrets must be provided via stdin.")
		.argument("<items...>", "either <key> <value> or key=value pairs")
		.action(async (items: string[]) => {
			const ctx = getConfigContext(program);
			const current = await loadConfig();
			const updates = await parseConfigUpdates(items);
			const next: Config = { ...current, ...updates };

			await saveConfig(next);
			const display = formatConfigUpdates(updates);

			const plain = Object.entries(display).map(([key, value]) => `${key}=${String(value)}`);
			emitData(ctx, { data: { updated: display, path: configPath() } }, plain);
		});

	config
		.command("unset")
		.description("Unset one or more config values")
		.argument("<keys...>", `one or more of: ${CONFIG_KEYS.join(", ")}`)
		.action(async (keys: string[]) => {
			const ctx = getConfigContext(program);
			const current = await loadConfig();
			const next = { ...current };

			for (const input of keys) {
				const key = parseConfigKey(input);
				delete next[mapConfigKey(key)];
			}

			await saveConfig(next);
			const plain = keys.map((key) => `${key}=unset`);
			emitData(ctx, { data: { unset: keys, path: configPath() } }, plain);
		});

	config
		.command("import")
		.description("Import config JSON from stdin")
		.requiredOption("--json", "require JSON stdin input")
		.action(async () => {
			const ctx = getConfigContext(program);
			const input = await readStdinString();
			if (!input) {
				throw new CliError("Expected JSON config payload on stdin", ExitCode.BadArgs);
			}

			const parsed = JSON.parse(input) as Config;
			await saveConfig(parsed);
			emitData(ctx, { data: { imported: true, path: configPath() } }, [configPath()]);
		});

	config
		.command("export")
		.description("Export effective config")
		.requiredOption("--json", "export is JSON-only by design")
		.action(async () => {
			const ctx = getConfigContext(program);
			const resolved = await resolveEffectiveConfig(ctx);
			emitData(
				ctx,
				{
					data: resolved.config,
				},
				[],
			);
		});
}

function getConfigContext(program: Command) {
	return toCliContext(program.optsWithGlobals());
}

function configPath(): string {
	return getConfigPath();
}

async function parseConfigUpdates(items: string[]): Promise<Partial<Config>> {
	if (items.length === 0) {
		throw new CliError("Provide either <key> <value> or key=value pairs", ExitCode.BadArgs);
	}

	const [first, second] = items;
	if (items.length === 2 && first && second && !first.includes("=")) {
		const key = parseConfigKey(first);
		const mapped = mapConfigKey(key);
		const valueArg = second;
		if (SECRET_KEYS.has(key) && valueArg !== "-") {
			throw new CliError(
				`Secret key ${key} must be provided via stdin: printf 'token' | jenkins cfg set ${key} -`,
				ExitCode.BadArgs,
			);
		}

		const rawValue = valueArg === "-" ? await readStdinTrimmed() : valueArg;
		if (!rawValue) {
			throw new CliError(`Missing value for ${key}`, ExitCode.BadArgs);
		}

		return {
			[mapped]: coerceConfigValue(key, rawValue),
		} as Partial<Config>;
	}

	const updates: Partial<Config> = {};
	for (const item of items) {
		const equalsIndex = item.indexOf("=");
		if (equalsIndex <= 0) {
			throw new CliError(
				`Expected key=value pairs for batch updates. Got: ${item}`,
				ExitCode.BadArgs,
			);
		}
		const key = parseConfigKey(item.slice(0, equalsIndex));
		if (SECRET_KEYS.has(key)) {
			throw new CliError(
				`Secret key ${key} must be set via stdin in single-key mode.`,
				ExitCode.BadArgs,
			);
		}
		const value = item.slice(equalsIndex + 1);
		assignConfigValue(updates, key, coerceConfigValue(key, value));
	}

	return updates;
}

function assignConfigValue(target: Partial<Config>, key: ConfigKey, value: Config[keyof Config]): void {
	switch (key) {
		case "endpoint":
			target.endpoint = value as Config["endpoint"];
			return;
		case "username":
			target.username = value as Config["username"];
			return;
		case "api-token":
			target.apiToken = value as Config["apiToken"];
			return;
		case "region":
			target.region = value as Config["region"];
			return;
		case "timeout-ms":
			target.timeoutMs = value as Config["timeoutMs"];
			return;
		case "retries":
			target.retries = value as Config["retries"];
			return;
	}
}

function formatConfigUpdates(updates: Partial<Config>): Record<string, unknown> {
	const display: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(updates)) {
		const configKey = reverseMapConfigKey(key as keyof Config);
		display[configKey] = SECRET_KEYS.has(configKey) ? "[redacted]" : value;
	}

	return display;
}

function reverseMapConfigKey(key: keyof Config): ConfigKey {
	switch (key) {
		case "endpoint":
			return "endpoint";
		case "username":
			return "username";
		case "apiToken":
			return "api-token";
		case "region":
			return "region";
		case "timeoutMs":
			return "timeout-ms";
		case "retries":
			return "retries";
	}
}
