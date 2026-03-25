import type { JobApiProperty, JobParameterDefinition, JobParameterDefinitionApi, ScalarValue } from "./types.ts";

export function normalizeJobParameterDefinitions(properties?: JobApiProperty[]): JobParameterDefinition[] {
	return (properties ?? [])
		.filter((property) => isParameterProperty(property))
		.flatMap((property) => property.parameterDefinitions ?? [])
		.map(normalizeJobParameterDefinition)
		.filter((definition): definition is JobParameterDefinition => definition !== null);
}

function isParameterProperty(property: JobApiProperty): boolean {
	return Boolean(
		Array.isArray(property.parameterDefinitions) ||
			(property._class && property._class.endsWith("ParametersDefinitionProperty")),
	);
}

function normalizeJobParameterDefinition(definition: JobParameterDefinitionApi): JobParameterDefinition | null {
	if (!definition.name) {
		return null;
	}

	const defaultValue = normalizeScalarValue(definition.defaultParameterValue?.value ?? definition.defaultValue);
	const choices = normalizeChoices(definition.choices);
	const description =
		typeof definition.description === "string" && definition.description.trim().length > 0
			? definition.description.trim()
			: undefined;

	return {
		name: definition.name,
		type: normalizeParameterType(definition.type ?? definition._class),
		...(defaultValue !== undefined ? { defaultValue } : {}),
		...(choices.length > 0 ? { choices } : {}),
		...(description ? { description } : {}),
	};
}

function normalizeParameterType(rawType: string | undefined): string {
	const value = rawType ?? "";

	if (/BooleanParameterDefinition$/.test(value)) {
		return "boolean";
	}
	if (/TextParameterDefinition$/.test(value)) {
		return "text";
	}
	if (/ChoiceParameterDefinition$/.test(value)) {
		return "choice";
	}
	if (/PasswordParameterDefinition$/.test(value)) {
		return "password";
	}
	if (/RunParameterDefinition$/.test(value)) {
		return "run";
	}
	if (/FileParameterDefinition$/.test(value)) {
		return "file";
	}
	if (/CredentialsParameterDefinition$/.test(value)) {
		return "credentials";
	}
	if (/StringParameterDefinition$/.test(value)) {
		return "string";
	}

	const simplified = value.replace(/^.*\./, "").replace(/ParameterDefinition$/, "");
	return simplified ? simplified.toLowerCase() : "unknown";
}

function normalizeChoices(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.map((item) => String(item)).filter((item) => item.length > 0);
	}

	if (typeof value === "string") {
		return value
			.split(/\r?\n/u)
			.map((item) => item.trim())
			.filter((item) => item.length > 0);
	}

	return [];
}

function normalizeScalarValue(value: unknown): ScalarValue | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
		return value;
	}

	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}
