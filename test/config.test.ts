import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { resolveEffectiveConfig } from "../src/config/effective.ts";
import { ExitCode } from "../src/cli/errors.ts";
import { coerceConfigValue } from "../src/config/schema.ts";
import { loadConfig, saveConfig } from "../src/config/store.ts";
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

describe("config import/export CLI", () => {
	const config = {
		endpoint: "https://jenkins.example.com",
		username: "test-user",
		apiToken: "test-token",
		timeoutMs: 45000,
		retries: 2,
		region: "test",
	};

	for (const alias of ["cfg", "config"]) {
		for (const position of [0, 1, 2]) {
			it(`round-trips ${alias} with --json at position ${position}`, async () => {
				await withTempConfigRoot(async () => {
					await saveConfig(config);
					const args = [alias, "export"];
					args.splice(position, 0, "--json");
					const exported = await runConfigCli(args);
					expect(exported.exitCode).toBe(0);
					expect(exported.stderr).toBe("");
					expect(JSON.parse(exported.stdout)).toEqual({ ok: true, data: config });

					await saveConfig({ username: "replace-me" });
					const imported = await runConfigCli(
						args.map((arg) => (arg === "export" ? "import" : arg)),
						exported.stdout,
					);
					expect(imported.exitCode).toBe(0);
					expect(JSON.parse(imported.stdout).data.imported).toBe(true);
					expect(imported.stdout + imported.stderr).not.toContain(config.apiToken);
					expect(await loadConfig()).toEqual(config);
				});
			});
		}
	}

	it("accepts a plain config object", async () => {
		await withTempConfigRoot(async () => {
			const result = await runConfigCli(["cfg", "import", "--json"], JSON.stringify(config));
			expect(result.exitCode).toBe(0);
			expect(await loadConfig()).toEqual(config);
		});
	});

	for (const command of ["export", "import"]) {
		it(`requires explicit --json for ${command} without changing config or exposing secrets`, async () => {
			await withTempConfigRoot(async () => {
				await saveConfig(config);
				const result = await runConfigCli(["cfg", command], "{}");
				expect(result.exitCode).toBe(ExitCode.BadArgs);
				expect(result.stderr).toContain("requires --json");
				expect(result.stdout).toBe("");
				expect(await loadConfig()).toEqual(config);
			});
		});

		it(`rejects --plain with --json for ${command}`, async () => {
			await withTempConfigRoot(async () => {
				await saveConfig(config);
				const result = await runConfigCli(["cfg", command, "--json", "--plain"], "{}");
				expect(result.exitCode).toBe(ExitCode.BadArgs);
				expect(JSON.parse(result.stdout).error.message).toContain("Use only one");
				expect(result.stdout + result.stderr).not.toContain(config.apiToken);
				expect(await loadConfig()).toEqual(config);
			});
		});
	}

	for (const input of [
		"",
		"{",
		"null",
		"[]",
		'{"ok":false,"data":{}}',
		'{"ok":true}',
		'{"typo":"value"}',
		'{"apiToken":42}',
	]) {
		it(`rejects invalid import ${JSON.stringify(input)} without overwriting config`, async () => {
			await withTempConfigRoot(async () => {
				await saveConfig(config);
				const result = await runConfigCli(["cfg", "import", "--json"], input);
				expect(result.exitCode).toBe(ExitCode.BadArgs);
				expect(JSON.parse(result.stdout).ok).toBe(false);
				expect(await loadConfig()).toEqual(config);
			});
		});
	}
});

async function runConfigCli(args: string[], input = "") {
	const executable = fileURLToPath(new URL("../bin/jenkins", import.meta.url));
	const child = Bun.spawn([process.execPath, executable, ...args], {
		env: process.env,
		stdin: new Blob([input]),
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { exitCode, stdout, stderr };
}

async function withTempConfigRoot(run: () => Promise<void>): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), "jenkins-cli-test-"));
	for (const key of ENV_KEYS) {
		delete process.env[key];
	}
	process.env.XDG_CONFIG_HOME = root;

	try {
		await run();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}
