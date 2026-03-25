import type { Command } from "commander";
import { emitData, toCliContext } from "../io.ts";

const SKILL_URL = "https://github.com/vforsh/jenkins-cli/tree/main/skill/jenkins";

export function registerSkillCommand(program: Command): void {
	program
		.command("skill")
		.description("Print the install URL for the Jenkins CLI skill")
		.action(() => {
			const ctx = toCliContext(program.optsWithGlobals());
			emitData(ctx, { data: { url: SKILL_URL }, human: SKILL_URL }, [SKILL_URL]);
		});
}
