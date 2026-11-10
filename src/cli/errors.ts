export enum ExitCode {
	Success = 0,
	Failure = 1,
	BadArgs = 2,
	ConfigError = 3,
	AuthError = 4,
	NetworkError = 5,
	NotFound = 6,
	ApiError = 7,
	Timeout = 8,
	BuildFailed = 9,
}

type CliErrorOptions = {
	exitCode?: ExitCode;
	details?: unknown;
	cause?: unknown;
	code?: string;
	hint?: string;
};

export class CliError extends Error {
	readonly exitCode: ExitCode;
	readonly details?: unknown;
	readonly code: string;
	readonly hint?: string;

	constructor(message: string, options: ExitCode | CliErrorOptions = ExitCode.Failure) {
		const normalized =
			typeof options === "number" ? ({ exitCode: options } satisfies CliErrorOptions) : options;

		super(message, normalized.cause ? { cause: normalized.cause } : undefined);
		this.name = "CliError";
		this.exitCode = normalized.exitCode ?? ExitCode.Failure;
		this.details = normalized.details;
		this.code = normalized.code ?? ERROR_CODES[this.exitCode] ?? "FAILURE";
		this.hint = normalized.hint;
	}
}

const ERROR_CODES: Record<number, string> = {
	1: "FAILURE",
	2: "INVALID_ARGUMENT",
	3: "CONFIG_ERROR",
	4: "AUTH_ERROR",
	5: "NETWORK_ERROR",
	6: "NOT_FOUND",
	7: "API_ERROR",
	8: "REQUEST_TIMEOUT",
	9: "BUILD_FAILED",
};
