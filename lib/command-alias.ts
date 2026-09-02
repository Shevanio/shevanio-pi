import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type CommandDefinition = Parameters<ExtensionAPI["registerCommand"]>[1];

export function deprecatedAliasNotice(suffix: string): string {
	return `Deprecated alias; use /shevanio-pi:${suffix}. Removed in shevanio-pi 3.0.0.`;
}

export function registerCanonicalCommand(pi: Pick<ExtensionAPI, "registerCommand">, suffix: string, command: CommandDefinition): void {
	pi.registerCommand(`shevanio-pi:${suffix}`, command);
	const notice = deprecatedAliasNotice(suffix);
	pi.registerCommand(`gentle:${suffix}`, {
		...command,
		description: `${notice}${command.description ? ` ${command.description}` : ""}`,
		handler: async (args, ctx) => {
			ctx.ui.notify(notice, "warning");
			await command.handler(args, ctx);
		},
	});
}
