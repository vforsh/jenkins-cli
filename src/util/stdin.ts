export async function readStdinString(): Promise<string | null> {
	if (process.stdin.isTTY) {
		return null;
	}

	let data = "";
	for await (const chunk of process.stdin) {
		data += chunk.toString();
	}

	return data;
}

export async function readStdinTrimmed(): Promise<string | null> {
	const value = await readStdinString();
	if (value === null) {
		return null;
	}

	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}
