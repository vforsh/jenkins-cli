export function redactSecret(value: string | undefined): string | undefined {
	return value ? "[redacted]" : undefined;
}
