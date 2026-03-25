import type {
	BuildApiInfo,
	BuildApiSummary,
	JobApiSummary,
	NormalizedBuildInfo,
	NormalizedBuildSummary,
	NormalizedJob,
} from "./types.ts";

export function isContainerJob(job: JobApiSummary): boolean {
	return Boolean(job._class && /Folder|ComputedFolder|OrganizationFolder/.test(job._class));
}

export function truncate(value: string, max = 200): string {
	return value.length > max ? `${value.slice(0, max)}...` : value;
}

export function ensureTrailingSlash(value: string): string {
	return value.endsWith("/") ? value : `${value}/`;
}

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeJob(job: JobApiSummary): NormalizedJob {
	return {
		name: job.name,
		fullName: job.fullName ?? job.name,
		url: job.url,
		color: job.color,
		type: job._class,
	};
}

export function normalizeBuild(build: BuildApiSummary, jobPath?: string): NormalizedBuildSummary {
	return {
		jobPath,
		number: build.number,
		url: build.url,
		result: build.result,
		building: build.building ?? false,
		timestamp: build.timestamp,
		duration: build.duration,
		displayName: build.displayName,
		fullDisplayName: build.fullDisplayName,
		id: build.id,
	};
}

export function normalizeBuildInfo(build: BuildApiInfo, jobPath?: string): NormalizedBuildInfo {
	const parameters = (build.actions ?? [])
		.flatMap((action) => action.parameters ?? [])
		.filter((param) => param.name)
		.map((param) => ({ name: param.name, value: param.value }));

	return {
		...normalizeBuild(build, jobPath),
		description: build.description,
		estimatedDuration: build.estimatedDuration,
		builtOn: build.builtOn,
		parameters,
	};
}
