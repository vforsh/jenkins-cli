import { describe, expect, it } from "bun:test";
import { CliError, ExitCode } from "../src/cli/errors.ts";
import { planDownloadAll, selectArtifact } from "../src/cli/commands/artifacts.ts";
import type { NormalizedBuildArtifact } from "../src/jenkins/types.ts";

const artifacts: NormalizedBuildArtifact[] = [
	{
		fileName: "public.zip",
		relativePath: "dist/public.zip",
		url: "https://jenkins.example.com/job/app/1/artifact/dist/public.zip",
	},
	{
		fileName: "manifest.json",
		relativePath: "manifest.json",
		url: "https://jenkins.example.com/job/app/1/artifact/manifest.json",
	},
];

describe("artifacts command helpers", () => {
	it("selects by relative path or unique filename", () => {
		expect(selectArtifact(artifacts, "dist/public.zip").relativePath).toBe("dist/public.zip");
		expect(selectArtifact(artifacts, "public.zip").relativePath).toBe("dist/public.zip");
	});

	it("rejects ambiguous filenames", () => {
		expect(() =>
			selectArtifact(
				[
					...artifacts,
					{
						fileName: "public.zip",
						relativePath: "other/public.zip",
						url: "https://jenkins.example.com/job/app/1/artifact/other/public.zip",
					},
				],
				"public.zip",
			),
		).toThrow(CliError);
	});

	it("keeps download-all destinations inside the requested directory", () => {
		const [first, second] = planDownloadAll(artifacts, "/tmp/jenkins-artifacts");
		expect(first?.destination).toBe("/tmp/jenkins-artifacts/dist/public.zip");
		expect(second?.destination).toBe("/tmp/jenkins-artifacts/manifest.json");

		try {
			planDownloadAll(
				[
					{
						fileName: "pwnd.txt",
						relativePath: "../pwnd.txt",
						url: "https://jenkins.example.com/job/app/1/artifact/../pwnd.txt",
					},
				],
				"/tmp/jenkins-artifacts",
			);
			throw new Error("expected unsafe path to throw");
		} catch (error) {
			expect(error).toBeInstanceOf(CliError);
			expect((error as CliError).exitCode).toBe(ExitCode.ApiError);
		}
	});
});
