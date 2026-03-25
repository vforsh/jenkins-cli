export type RequestOptions = {
	method?: "GET" | "POST";
	query?: Record<string, string | number | undefined>;
	body?: URLSearchParams;
	expect?: "json" | "text" | "none";
	mutate?: boolean;
};

export type JobApiSummary = {
	name?: string;
	fullName?: string;
	url?: string;
	color?: string;
	_class?: string;
};

export type BuildApiSummary = {
	number?: number;
	url?: string;
	result?: string | null;
	building?: boolean;
	timestamp?: number;
	duration?: number;
	displayName?: string;
	fullDisplayName?: string;
	id?: string;
};

export type QueueItem = {
	id?: number;
	cancelled?: boolean;
	blocked?: boolean;
	buildable?: boolean;
	stuck?: boolean;
	why?: string | null;
	task?: {
		name?: string;
		url?: string;
	};
	executable?: {
		number?: number;
		url?: string;
	};
};

export type BuildApiInfo = BuildApiSummary & {
	description?: string | null;
	estimatedDuration?: number;
	builtOn?: string;
	actions?: Array<{
		parameters?: Array<{
			name?: string;
			value?: unknown;
		}>;
	}>;
};
