import { describe, expect, it } from "bun:test";
import { formatWaitEvent } from "../src/cli/wait-progress.ts";

describe("wait progress formatting", () => {
	it("formats queue and running phases tersely", () => {
		expect(
			formatWaitEvent({
				kind: "queued",
				queueId: 42,
				why: "Waiting for next available executor",
				stuck: true,
				blocked: false,
				buildable: false,
			}),
		).toBe("queued: Waiting for next available executor | stuck");

		expect(
			formatWaitEvent({
				kind: "running",
				jobPath: "team-folder/app-build",
				buildNumber: 123,
				buildUrl: "https://jenkins.example.com/job/team-folder/job/app-build/123/",
				elapsedMs: 75_000,
				estimatedDurationMs: 180_000,
			}),
		).toBe("running: team-folder/app-build #123 1m 15s elapsed / 3m 0s est");
	});

	it("formats started and finished phases with build refs", () => {
		expect(
			formatWaitEvent({
				kind: "started",
				jobPath: "team-folder/app-build",
				buildNumber: 123,
				buildUrl: "https://jenkins.example.com/job/team-folder/job/app-build/123/",
			}),
		).toBe("started: team-folder/app-build #123 https://jenkins.example.com/job/team-folder/job/app-build/123/");

		expect(
			formatWaitEvent({
				kind: "finished",
				jobPath: "team-folder/app-build",
				buildNumber: 123,
				buildUrl: "https://jenkins.example.com/job/team-folder/job/app-build/123/",
				result: "SUCCESS",
				elapsedMs: 180_000,
			}),
		).toBe(
			"finished: team-folder/app-build #123 SUCCESS https://jenkins.example.com/job/team-folder/job/app-build/123/",
		);
	});
});
