import { CliError, ExitCode } from "../cli/errors.ts";
import type { EffectiveConfig } from "../config/effective.ts";
import { truncate } from "./helpers.ts";
import { waitTimeout } from "./timing.ts";
import type { RequestOptions } from "./types.ts";

/** Owns request deadlines and response headers; callers never share mutable last-response state. */
export class JenkinsHttp {
	private crumbPromise?: Promise<Record<string, string>>;

	constructor(
		private readonly config: EffectiveConfig,
		private readonly deadline?: number,
	) {}

	url(path: string, query?: RequestOptions["query"]): string {
		const base = this.config.endpoint.replace(/\/$/u, "") + "/";
		const url = new URL(path.replace(/^\//u, ""), base);
		if (url.origin !== new URL(base).origin) {
			throw new CliError("Reference belongs to a different Jenkins server", ExitCode.BadArgs);
		}
		for (const [key, value] of Object.entries(query ?? {})) {
			if (value !== undefined) url.searchParams.set(key, String(value));
		}
		return url.toString();
	}

	async request(path: string, options: RequestOptions = {}): Promise<unknown> {
		const url = this.url(path, options.query);
		// Retrying a POST after a dropped response can silently queue a duplicate build.
		const retries = options.mutate ? 0 : this.config.retries;
		const crumb = options.mutate ? await this.crumbHeaders() : {};
		for (let attempt = 0; ; attempt++) {
			const remaining = this.deadline === undefined ? Infinity : this.deadline - Date.now();
			if (remaining <= 0) throw waitTimeout(path);
			const timeoutMs = Math.min(this.config.timeoutMs, remaining);
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), timeoutMs);
			try {
				const headers = new Headers({ accept: "application/json, text/plain;q=0.9, */*;q=0.8", ...crumb });
				if (this.config.username && this.config.apiToken) {
					headers.set(
						"authorization",
						`Basic ${Buffer.from(`${this.config.username}:${this.config.apiToken}`).toString("base64")}`,
					);
				}
				if (options.body) headers.set("content-type", "application/x-www-form-urlencoded;charset=UTF-8");
				const response = await fetch(url, {
					method: options.method ?? "GET",
					body: options.body,
					headers,
					signal: controller.signal,
					redirect: options.mutate ? "manual" : "follow",
				});
				if (response.url.includes("/securityRealm/commenceLogin")) {
					throw new CliError("Jenkins redirected to login. Check username/api-token.", ExitCode.AuthError);
				}
				if (response.status >= 400) throw await httpError(response, url);
				// Keep the timer alive while consuming the body as well as waiting for headers.
				switch (options.expect ?? "json") {
					case "none":
						return response;
					case "bytes":
						return new Uint8Array(await response.arrayBuffer());
					case "text":
						return await response.text();
					case "textWithHeaders":
						return { text: await response.text(), headers: response.headers };
					case "json": {
						const text = await response.text();
						try {
							return text.length ? JSON.parse(text) : {};
						} catch {
							throw new CliError(`Expected JSON from Jenkins but got: ${truncate(text)}`, ExitCode.ApiError);
						}
					}
				}
			} catch (error) {
				if (error instanceof CliError) throw error;
				if (controller.signal.aborted) {
					if (remaining <= this.config.timeoutMs) throw waitTimeout(path);
					throw new CliError(`Request timed out after ${timeoutMs}ms`, ExitCode.Timeout);
				}
				if (attempt >= retries)
					throw new CliError("Failed to reach Jenkins", { exitCode: ExitCode.NetworkError, details: error });
			} finally {
				clearTimeout(timer);
			}
		}
	}

	private async crumbHeaders(): Promise<Record<string, string>> {
		this.crumbPromise ??= (async () => {
			try {
				const data = (await this.request("/crumbIssuer/api/json")) as {
					crumb?: string;
					crumbRequestField?: string;
				};
				return data.crumb && data.crumbRequestField ? { [data.crumbRequestField]: data.crumb } : {};
			} catch (error) {
				if (error instanceof CliError && error.exitCode === ExitCode.NotFound) return {};
				throw error;
			}
		})();
		return this.crumbPromise;
	}
}

async function httpError(response: Response, url: string): Promise<CliError> {
	if (response.status === 401 || response.status === 403)
		return new CliError(`Jenkins denied access (${response.status}): ${url}`, ExitCode.AuthError);
	if (response.status === 404) return new CliError(`Jenkins resource not found: ${url}`, ExitCode.NotFound);
	return new CliError(
		`Jenkins request failed with ${response.status}: ${truncate(await response.text())}`,
		ExitCode.ApiError,
	);
}
