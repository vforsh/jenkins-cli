export type RequestOptions = {
	method?: "GET" | "POST";
	query?: Record<string, string | number | undefined>;
	body?: URLSearchParams;
	expect?: "json" | "text" | "none" | "bytes" | "textWithHeaders";
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
	actions?: Array<BuildAction>;
	changeSets?: Array<{ items?: Array<{ commitId?: string; msg?: string }> }>;
};

export type BuildAction = {
	_class?: string;
	remoteUrls?: string[];
	lastBuiltRevision?: { SHA1?: string; branch?: Array<{ name?: string }> };
	revision?: { hash?: string; SHA1?: string; head?: { name?: string } };
	causes?: BuildCause[];
	parameters?: Array<{
		name?: string;
		value?: unknown;
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
	ref: string;
	state: "running" | "finished";
	complete: boolean;
	scm?: ScmInfo;
	related?: RelatedBuilds;
	stages?: { available: boolean; reason?: string; items: PipelineStage[] };
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
	deadline?: number;
	intervalMs?: number;
	waitTimeoutMs?: number;
	onProgress?: (event: WaitEvent) => void;
};

export type BuildCause = {
	_class?: string;
	shortDescription?: string;
	upstreamProject?: string;
	upstreamBuild?: number;
	upstreamUrl?: string;
};

export type ScmRevision = {
	sha: string;
	repository?: string;
	branches: string[];
	source: "git" | "scm";
};
export type ScmInfo = {
	available: boolean;
	revisions: ScmRevision[];
	changes: Array<{ commitId?: string; message?: string }>;
};
export type RelatedBuild = {
	jobPath: string;
	number: number;
	ref: string;
	url?: string;
	result?: string | null;
	building?: boolean;
};
export type RelatedBuilds = {
	causes: BuildCause[];
	upstream: RelatedBuild[];
	downstream: RelatedBuild[];
	downstreamSearch: { jobs: string[]; limitPerJob: number; truncated: boolean };
};
export type PipelineStage = {
	id: string;
	name: string;
	status: string;
	startTimeMs?: number;
	durationMs?: number;
};
export type BuildInclude = "scm" | "related" | "stages";
export type BuildInfoOptions = { include?: BuildInclude[]; downstreamJobs?: string[]; relatedLimit?: number };
export type QueueInfo = {
	ref: string;
	queueId: number;
	state: "queued" | "cancelled";
	complete: boolean;
	jobPath?: string;
	url?: string;
	why?: string;
	blocked: boolean;
	stuck: boolean;
	buildable: boolean;
};
export type RefInfo = NormalizedBuildInfo | QueueInfo;
export type WatchOptions = WaitOptions & {
	commit?: string;
	repository?: string;
	after?: number;
	limit?: number;
	downstreamJob?: string;
};
export type LogOptions = WaitOptions & {
	start?: number;
	cursor?: string;
	follow?: boolean;
	tail?: number;
	grep?: string;
	context?: number;
	maxBytes?: number;
	onChunk?: (text: string) => void;
};
export type LogResult = {
	text: string;
	nextStart: number;
	cursor: string;
	complete: boolean;
	truncated: boolean;
	filtered: boolean;
	ref: string;
};
