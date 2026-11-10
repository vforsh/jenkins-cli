import type { BuildApiInfo, BuildCause, BuildInclude, RelatedBuild, ScmInfo } from "./types.ts";
import { normalizeJobPath } from "./ref.ts";

export const SUMMARY_TREE = "number,url,result,building,timestamp,duration,displayName,fullDisplayName,id";
const BUILD_TREE = `${SUMMARY_TREE},estimatedDuration,description,builtOn`;
export const SCM_ACTION_TREE =
	"remoteUrls,lastBuiltRevision[SHA1,branch[name]],revision[hash,SHA1,head[name]]";
export const CAUSE_TREE = "causes[_class,shortDescription,upstreamProject,upstreamBuild,upstreamUrl]";

export function buildInfoTree(include: BuildInclude[]): string {
	const actions = [
		"parameters[name,value]",
		include.includes("scm") ? SCM_ACTION_TREE : "",
		include.includes("related") ? CAUSE_TREE : "",
	]
		.filter(Boolean)
		.join(",");
	return [BUILD_TREE, `actions[${actions}]`, include.includes("scm") ? "changeSets[items[commitId,msg]]" : ""]
		.filter(Boolean)
		.join(",");
}

export function buildCandidatesTree(include: BuildInclude[]): string {
	const actions = [
		include.includes("scm") ? SCM_ACTION_TREE : "",
		include.includes("related") ? CAUSE_TREE : "",
	].filter(Boolean);
	return SUMMARY_TREE + (actions.length ? `,actions[${actions.join(",")}]` : "");
}

export function normalizeScm(build: BuildApiInfo): ScmInfo {
	const revisions: ScmInfo["revisions"] = [];
	for (const action of build.actions ?? []) {
		const git = action.lastBuiltRevision;
		if (git?.SHA1) {
			for (const repository of action.remoteUrls?.length ? action.remoteUrls : [undefined]) {
				revisions.push({
					sha: git.SHA1,
					repository,
					branches: (git.branch ?? []).flatMap((b) => (b.name ? [b.name] : [])),
					source: "git",
				});
			}
		}
	}
	for (const action of build.actions ?? []) {
		const sha = action.revision?.hash ?? action.revision?.SHA1;
		if (sha && !revisions.some((r) => r.sha === sha)) {
			revisions.push({
				sha,
				branches: action.revision?.head?.name ? [action.revision.head.name] : [],
				source: "scm",
			});
		}
	}
	return {
		available: revisions.length > 0,
		revisions: revisions.filter(
			(r, i) =>
				revisions.findIndex((other) => other.sha === r.sha && other.repository === r.repository) === i,
		),
		// Changelog entries describe changes since the previous build, not necessarily the checked-out revision.
		changes: (build.changeSets ?? []).flatMap((set) =>
			(set.items ?? []).map((item) => ({ commitId: item.commitId, message: item.msg })),
		),
	};
}

export function buildCauses(build: BuildApiInfo): BuildCause[] {
	return (build.actions ?? []).flatMap((action) => action.causes ?? []);
}

export function upstreamBuilds(build: BuildApiInfo, serverUrl: (path: string) => string): RelatedBuild[] {
	return buildCauses(build).flatMap((cause) => {
		if (!cause.upstreamProject || cause.upstreamBuild === undefined) return [];
		return [
			{
				jobPath: cause.upstreamProject,
				number: cause.upstreamBuild,
				ref: `${cause.upstreamProject}#${cause.upstreamBuild}`,
				url: cause.upstreamUrl ? serverUrl(`${cause.upstreamUrl}${cause.upstreamBuild}/`) : undefined,
			},
		];
	});
}

export function isDownstreamOf(
	candidate: BuildApiInfo,
	parent: { jobPath?: string; number?: number },
): boolean {
	return buildCauses(candidate).some(
		(cause) => cause.upstreamProject === parent.jobPath && cause.upstreamBuild === parent.number,
	);
}

export function canonicalJobPath(url: string | undefined, fallback?: string): string | undefined {
	return url ? normalizeJobPath(url) : fallback;
}
