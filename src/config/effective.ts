import { CliError, ExitCode } from "../cli/errors.ts";
import type { CliContext } from "../cli/types.ts";
import { redactSecret } from "../util/redact.ts";
import { getConfigPath, loadConfig } from "./store.ts";
import {
	DEFAULT_RETRIES,
	DEFAULT_TIMEOUT_MS,
	configSchema,
	type Config,
} from "./schema.ts";

export type EffectiveConfig = {
	endpoint: string;
	username?: string;
	apiToken?: string;
	region?: string;
	timeoutMs: number;
	retries: number;
};

export async function resolveEffectiveConfig(
	ctx: Pick<CliContext, "endpoint" | "region" | "timeoutMs" | "retries"> = {},
): Promise<{ path: string; fileConfig: Config; config: EffectiveConfig }> {
	const path = getConfigPath();
	const fileConfig = await loadConfig(path);
	const config: EffectiveConfig = {
		endpoint: resolveEndpoint(ctx, fileConfig),
		username: firstNonEmpty(process.env.JENKINS_USERNAME, fileConfig.username),
		apiToken: firstNonEmpty(process.env.JENKINS_API_TOKEN, fileConfig.apiToken),
		region: firstNonEmpty(ctx.region, process.env.JENKINS_REGION, fileConfig.region),
		timeoutMs: normalizeInt(
			ctx.timeoutMs,
			process.env.JENKINS_TIMEOUT_MS,
			fileConfig.timeoutMs,
			DEFAULT_TIMEOUT_MS,
			"timeout",
		),
		retries: normalizeInt(
			ctx.retries,
			process.env.JENKINS_RETRIES,
			fileConfig.retries,
			DEFAULT_RETRIES,
			"retries",
		),
	};
	configSchema.parse(config);

	return { path, fileConfig, config };
}

export function redactConfig(config: EffectiveConfig): Record<string, unknown> {
	return {
		endpoint: config.endpoint,
		username: config.username,
		apiToken: redactSecret(config.apiToken),
		region: config.region,
		timeoutMs: config.timeoutMs,
		retries: config.retries,
	};
}

function resolveEndpoint(
	ctx: Pick<CliContext, "endpoint">,
	fileConfig: Pick<Config, "endpoint">,
): string {
	const endpointValue = firstNonEmpty(ctx.endpoint, process.env.JENKINS_ENDPOINT, fileConfig.endpoint);
	if (!endpointValue) {
		throw new CliError(
			"Missing endpoint config. Set it with `jenkins cfg set endpoint=https://your-jenkins.example` or JENKINS_ENDPOINT.",
			ExitCode.ConfigError,
		);
	}

	return normalizeUrl(endpointValue, "endpoint");
}

function normalizeUrl(input: string, label: string): string {
	try {
		return new URL(input).toString().replace(/\/$/, "");
	} catch {
		throw new CliError(`${label} must be a valid URL`, ExitCode.ConfigError);
	}
}

function normalizeInt(
	primary: number | undefined,
	secondary: string | undefined,
	tertiary: number | undefined,
	fallback: number,
	label: string,
): number {
	const value = primary ?? parseEnvInt(secondary, label) ?? tertiary ?? fallback;
	if (!Number.isInteger(value)) {
		throw new CliError(`${label} must be an integer`, ExitCode.ConfigError);
	}

	if (label === "timeout" && value <= 0) {
		throw new CliError("timeout must be greater than 0", ExitCode.ConfigError);
	}

	if (label === "retries" && value < 0) {
		throw new CliError("retries must be 0 or greater", ExitCode.ConfigError);
	}

	return value;
}

function parseEnvInt(value: string | undefined, label: string): number | undefined {
	if (!value || value.trim().length === 0) {
		return undefined;
	}

	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed)) {
		throw new CliError(`${label} env value must be an integer`, ExitCode.ConfigError);
	}
	return parsed;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
	for (const value of values) {
		if (value && value.trim().length > 0) {
			return value;
		}
	}

	return undefined;
}
