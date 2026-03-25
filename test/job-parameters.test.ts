import { describe, expect, it } from "bun:test";
import { normalizeJobParameterDefinitions } from "../src/jenkins/job-parameters.ts";

describe("job parameter definitions", () => {
	it("normalizes common Jenkins parameter definition shapes", () => {
		const definitions = normalizeJobParameterDefinitions([
			{
				_class: "hudson.model.ParametersDefinitionProperty",
				parameterDefinitions: [
					{
						name: "ENV",
						_class: "hudson.model.ChoiceParameterDefinition",
						description: "Deployment target",
						choices: ["staging", "production"],
					},
					{
						name: "DEBUG",
						_class: "hudson.model.BooleanParameterDefinition",
						defaultParameterValue: { value: false },
					},
					{
						name: "NOTES",
						_class: "hudson.model.TextParameterDefinition",
						defaultValue: "ship it",
					},
				],
			},
		]);

		expect(definitions).toEqual([
			{
				name: "ENV",
				type: "choice",
				choices: ["staging", "production"],
				description: "Deployment target",
			},
			{
				name: "DEBUG",
				type: "boolean",
				defaultValue: false,
			},
			{
				name: "NOTES",
				type: "text",
				defaultValue: "ship it",
			},
		]);
	});

	it("handles newline-delimited choices and ignores nameless definitions", () => {
		const definitions = normalizeJobParameterDefinitions([
			{
				parameterDefinitions: [
					{
						name: "REGION",
						type: "ChoiceParameterDefinition",
						choices: "eu\nus\napac",
					},
					{
						_class: "hudson.model.StringParameterDefinition",
					},
				],
			},
		]);

		expect(definitions).toEqual([
			{
				name: "REGION",
				type: "choice",
				choices: ["eu", "us", "apac"],
			},
		]);
	});
});
