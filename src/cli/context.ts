import type { Command } from "commander";
import { resolveEffectiveConfig } from "../config/effective.ts";
import { JenkinsClient } from "../jenkins/client.ts";
import { CliError, ExitCode } from "./errors.ts";
import { toCliContext } from "./io.ts";
import type { CliContext } from "./types.ts";

type RuntimeOptions = {
	requireAuth?: boolean;
};

export async function loadRuntime(
	command: Command,
	options: RuntimeOptions = {},
): Promise<{
	ctx: CliContext;
	client: JenkinsClient;
	configPath: string;
	config: Awaited<ReturnType<typeof resolveEffectiveConfig>>["config"];
}> {
	const ctx = toCliContext(command.optsWithGlobals());
	const resolved = await resolveEffectiveConfig(ctx);

	if (options.requireAuth ?? true) {
		const missing: string[] = [];
		if (!resolved.config.username) {
			missing.push("username");
		}
		if (!resolved.config.apiToken) {
			missing.push("api-token");
		}

		if (missing.length > 0) {
			throw new CliError(
				`Missing auth config: ${missing.join(", ")}. Set them with \`jenkins cfg set\` or environment variables.`,
				ExitCode.AuthError,
			);
		}
	}

	return {
		ctx,
		client: new JenkinsClient(resolved.config),
		configPath: resolved.path,
		config: resolved.config,
	};
}
