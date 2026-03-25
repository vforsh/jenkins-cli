import { describe, expect, it } from "bun:test";
import { extractQueueId, jobPathToApiPath, normalizeJobPath, parseRef } from "../src/jenkins/ref.ts";

describe("jenkins refs", () => {
	it("normalizes job URLs to slash paths", () => {
		expect(normalizeJobPath("https://jenkins.example.com/job/team-folder/job/app-build/")).toBe(
			"team-folder/app-build",
		);
	});

	it("builds Jenkins API paths from folder jobs", () => {
		expect(jobPathToApiPath("team-folder/app-build")).toBe("/job/team-folder/job/app-build");
	});

	it("parses queue and build refs", () => {
		expect(parseRef("queue:42")).toEqual({ kind: "queue", id: 42 });
		expect(parseRef("team-folder/app-build#6760")).toEqual({
			kind: "build",
			jobPath: "team-folder/app-build",
			buildNumber: 6760,
		});
	});

	it("extracts queue ids from Jenkins locations", () => {
		expect(extractQueueId("https://jenkins.example.com/queue/item/123/")).toBe(123);
	});
});
