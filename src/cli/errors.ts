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
}

type CliErrorOptions = {
	exitCode?: ExitCode;
	details?: unknown;
	cause?: unknown;
};

export class CliError extends Error {
	readonly exitCode: ExitCode;
	readonly details?: unknown;

	constructor(message: string, options: ExitCode | CliErrorOptions = ExitCode.Failure) {
		const normalized =
			typeof options === "number" ? { exitCode: options } satisfies CliErrorOptions : options;

		super(message, normalized.cause ? { cause: normalized.cause } : undefined);
		this.name = "CliError";
		this.exitCode = normalized.exitCode ?? ExitCode.Failure;
		this.details = normalized.details;
	}
}
