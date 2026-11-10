export type GlobalOptions = {
	json?: boolean;
	plain?: boolean;
	quiet?: boolean;
	verbose?: boolean;
	noColor?: boolean;
	endpoint?: string;
	region?: string;
	timeout?: number | string;
	requestTimeout?: number;
	fields?: string;
	retries?: number | string;
};

export type CliContext = {
	json: boolean;
	plain: boolean;
	quiet: boolean;
	verbose: boolean;
	color: boolean;
	endpoint?: string;
	region?: string;
	timeoutMs?: number;
	fields?: string[];
	retries?: number;
};

export type DoctorCheck = {
	name: string;
	status: "OK" | "WARN" | "FAIL";
	message: string;
};
