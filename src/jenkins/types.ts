export type RequestOptions = {
	method?: "GET" | "POST";
	query?: Record<string, string | number | undefined>;
	body?: URLSearchParams;
	expect?: "json" | "text" | "none" | "bytes";
	mutate?: boolean;
};

export type ScalarValue = string | number | boolean | null;

export type JobApiSummary = {
	name?: string;
	fullName?: string;
	url?: string;
	color?: string;
	_class?: string;
};

export type JobParameterDefinitionApi = {
	name?: string;
	description?: string | null;
	type?: string;
	_class?: string;
	defaultParameterValue?: {
		value?: unknown;
	} | null;
	defaultValue?: unknown;
	choices?: unknown;
};

export type JobApiProperty = {
	_class?: string;
	parameterDefinitions?: JobParameterDefinitionApi[];
};

export type JobParameterDefinition = {
	name: string;
	type: string;
	defaultValue?: ScalarValue;
	choices?: string[];
	description?: string;
};

export type NormalizedJob = {
	name?: string;
	fullName?: string;
	url?: string;
	color?: string;
	type?: string;
};

export type NormalizedJobInfo = NormalizedJob & {
	jobPath: string;
	description?: unknown;
	buildable?: unknown;
	lastBuild?: unknown;
	lastSuccessfulBuild?: unknown;
	lastCompletedBuild?: unknown;
	healthReport?: unknown;
	parameterDefinitions?: JobParameterDefinition[];
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

export type NormalizedBuildSummary = {
	jobPath?: string;
	number?: number;
	url?: string;
	result?: string | null;
	building: boolean;
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

export type BuildArtifactApi = {
	fileName?: string;
	relativePath?: string;
};

export type NormalizedBuildArtifact = {
	fileName: string;
	relativePath: string;
	url: string;
};

export type NormalizedBuildInfo = NormalizedBuildSummary & {
	description?: string | null;
	estimatedDuration?: number;
	builtOn?: string;
	parameters: Array<{
		name?: string;
		value?: unknown;
	}>;
};

export type WaitEvent =
	| {
			kind: "queued";
			queueId: number;
			jobPath?: string;
			why?: string;
			stuck: boolean;
			blocked: boolean;
			buildable: boolean;
	  }
	| {
			kind: "started";
			queueId?: number;
			jobPath?: string;
			buildNumber?: number;
			buildUrl?: string;
	  }
	| {
			kind: "running";
			jobPath?: string;
			buildNumber?: number;
			buildUrl?: string;
			elapsedMs?: number;
			estimatedDurationMs?: number;
	  }
	| {
			kind: "finished";
			jobPath?: string;
			buildNumber?: number;
			buildUrl?: string;
			result?: string | null;
			elapsedMs?: number;
			estimatedDurationMs?: number;
	  };

export type WaitOptions = {
	intervalMs?: number;
	waitTimeoutMs?: number;
	onProgress?: (event: WaitEvent) => void;
};
