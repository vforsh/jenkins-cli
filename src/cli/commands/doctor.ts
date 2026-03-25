import { access, constants } from "node:fs/promises";
import { dirname } from "node:path";
import type { Command } from "commander";
import { loadRuntime } from "../context.ts";
import { emitData, toCliContext } from "../io.ts";
import type { DoctorCheck } from "../types.ts";

export function registerDoctorCommand(program: Command): void {
	program
		.command("doctor")
		.alias("check")
		.description("Run readiness checks for the Jenkins CLI")
		.action(async () => {
			const ctx = toCliContext(program.optsWithGlobals());
			const runtime = await loadRuntime(program, { requireAuth: false });
			const checks: DoctorCheck[] = [];

			checks.push({
				name: "bun",
				status: process.versions.bun ? "OK" : "FAIL",
				message: process.versions.bun
					? `Bun ${process.versions.bun}`
					: "Bun runtime is unavailable",
			});

			checks.push({
				name: "config",
				status: "OK",
				message: `Resolved config path ${runtime.configPath}`,
			});

			try {
				await access(dirname(runtime.configPath), constants.W_OK);
				checks.push({
					name: "config-dir",
					status: "OK",
					message: "Config directory is writable",
				});
			} catch {
				checks.push({
					name: "config-dir",
					status: "WARN",
					message: "Config directory does not exist yet or is not writable",
				});
			}

			try {
				const info = await runtime.client.getServerInfo();
				checks.push({
					name: "endpoint",
					status: "OK",
					message: `${runtime.config.endpoint} reachable${info.version ? ` (Jenkins ${info.version})` : ""}`,
				});
			} catch (error) {
				checks.push({
					name: "endpoint",
					status: "FAIL",
					message: error instanceof Error ? error.message : String(error),
				});
			}

			if (runtime.config.username && runtime.config.apiToken) {
				try {
					await runtime.client.listJobs(undefined, false);
					checks.push({
						name: "auth",
						status: "OK",
						message: `Authenticated as ${runtime.config.username}`,
					});
				} catch (error) {
					checks.push({
						name: "auth",
						status: "FAIL",
						message: error instanceof Error ? error.message : String(error),
					});
				}
			} else {
				checks.push({
					name: "auth",
					status: "WARN",
					message: "username/api-token not configured yet",
				});
			}

			const failures = checks.filter((check) => check.status === "FAIL");
			const warnings = checks.filter((check) => check.status === "WARN");
			const status = failures.length > 0 ? "FAIL" : warnings.length > 0 ? "WARN" : "OK";

			const plain = checks.map((check) => `${check.status}\t${check.name}\t${check.message}`);
			const human = checks.map((check) => `${check.status} ${check.name} ${check.message}`);

			emitData(ctx, { data: { status, checks }, human }, plain);

			if (failures.length > 0) {
				process.exit(1);
			}
		});
}
