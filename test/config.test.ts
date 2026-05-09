import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveEffectiveConfig } from "../src/config/effective.ts";
import { ExitCode } from "../src/cli/errors.ts";
import { coerceConfigValue } from "../src/config/schema.ts";
import { saveConfig } from "../src/config/store.ts";
import { parseConfigUpdates } from "../src/cli/commands/config.ts";

const ENV_KEYS = [
	"XDG_CONFIG_HOME",
	"JENKINS_ENDPOINT",
	"JENKINS_USERNAME",
	"JENKINS_API_TOKEN",
	"JENKINS_TIMEOUT_MS",
	"JENKINS_RETRIES",
	"JENKINS_REGION",
] as const;

const originalEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
	for (const key of ENV_KEYS) {
		const value = originalEnv.get(key);
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
});

describe("config helpers", () => {
	it("coerces endpoint and numeric values", () => {
		expect(coerceConfigValue("endpoint", "https://jenkins.example.com/")).toBe(
			"https://jenkins.example.com",
		);
		expect(coerceConfigValue("timeout-ms", "45000")).toBe(45000);
		expect(coerceConfigValue("retries", "3")).toBe(3);
	});

	it("requires endpoint when no config or env value is present", async () => {
		await withTempConfigRoot(async () => {
			expect(resolveEffectiveConfig()).rejects.toMatchObject({
				exitCode: ExitCode.ConfigError,
				message: expect.stringContaining("Missing endpoint config"),
			});
		});
	});

	it("prefers environment values over config file values", async () => {
		await withTempConfigRoot(async () => {
			await saveConfig({
				endpoint: "https://example.invalid",
				username: "file-user",
				apiToken: "file-token",
				timeoutMs: 15_000,
				retries: 0,
			});

			process.env.JENKINS_ENDPOINT = "https://jenkins.example.com";
			process.env.JENKINS_USERNAME = "env-user";
			process.env.JENKINS_API_TOKEN = "env-token";
			process.env.JENKINS_TIMEOUT_MS = "33000";
			process.env.JENKINS_RETRIES = "2";

			const resolved = await resolveEffectiveConfig();
			expect(resolved.config.endpoint).toBe("https://jenkins.example.com");
			expect(resolved.config.username).toBe("env-user");
			expect(resolved.config.apiToken).toBe("env-token");
			expect(resolved.config.timeoutMs).toBe(33000);
			expect(resolved.config.retries).toBe(2);
		});
	});

	it("prompts for a single config key without a value", async () => {
		const updates = await parseConfigUpdates(["username"], {
			prompt: async (key) => `${key}-value`,
		});

		expect(updates).toEqual({ username: "username-value" });
	});

	it("allows secrets through interactive single-key mode", async () => {
		const updates = await parseConfigUpdates(["api-token"], {
			prompt: async () => "secret-token",
		});

		expect(updates).toEqual({ apiToken: "secret-token" });
	});

	it("still rejects secrets passed as command arguments", async () => {
		expect(parseConfigUpdates(["api-token", "secret-token"])).rejects.toMatchObject({
			exitCode: ExitCode.BadArgs,
			message: expect.stringContaining("interactively or via stdin"),
		});
	});
});

async function withTempConfigRoot(run: () => Promise<void>): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), "jenkins-cli-test-"));
	process.env.XDG_CONFIG_HOME = root;

	try {
		await run();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}
