import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { createGentleAiExtension } from "../extensions/gentle-ai.ts";
import startupBanner from "../extensions/startup-banner.ts";
import { deprecatedAliasNotice, registerCanonicalCommand } from "../lib/command-alias.ts";

const SUFFIXES = ["background-subagents", "banner", "banner-color", "dev-binary", "doctor", "install-sdd", "models", "persona", "review-mode", "sdd-preflight", "status", "toggle-rose", "toggle-text-logo"];
type Registration = Parameters<ExtensionAPI["registerCommand"]>[1] & { name: string };
function registrations(): Registration[] {
	const commands: Registration[] = [];
	const pi = {
		on() {},
		registerTool() {},
		registerCommand(name: string, command: Parameters<ExtensionAPI["registerCommand"]>[1]) { commands.push({ name, ...command }); },
	} as unknown as ExtensionAPI;
	createGentleAiExtension({ nativeReviewCli: null })(pi);
	startupBanner(pi);
	return commands;
}

test("the 13 package commands expose one canonical route and one approved legacy alias", () => {
	const commands = registrations();
	const names = commands.map(({ name }) => name);
	assert.deepEqual(names.filter((name) => name.startsWith("shevanio-pi:")).map((name) => name.slice("shevanio-pi:".length)).sort(), SUFFIXES);
	assert.deepEqual(names.filter((name) => name.startsWith("gentle:")).map((name) => name.slice("gentle:".length)).sort(), SUFFIXES);
	assert.deepEqual(names.filter((name) => !name.startsWith("shevanio-pi:") && !name.startsWith("gentle:")).sort(), ["sdd-continue", "sdd-status"]);
	assert.equal(names.some((name) => /^(?:gentle-ai|gentleman):/.test(name)), false);
	assert.equal(names.some((name) => /^gentle:sdd-(?:status|continue|init)$/.test(name)), false);
	for (const suffix of SUFFIXES) {
		assert.ok(commands.find(({ name }) => name === `gentle:${suffix}`)?.description?.startsWith(deprecatedAliasNotice(suffix)));
	}
});

test("canonical execution is silent while the alias warns once and forwards once", async () => {
	const commands: Registration[] = [];
	const calls: string[] = [];
	const notifications: Array<{ message: string; type?: string }> = [];
	registerCanonicalCommand({ registerCommand(name, command) { commands.push({ name, ...command }); } }, "probe", {
		description: "Probe command routing.",
		handler: async (args) => { calls.push(args); },
	});
	const ctx = { ui: { notify(message: string, type?: string) { notifications.push({ message, type }); } } } as unknown as ExtensionCommandContext;
	const args = "  --flag=value unchanged  ";
	await commands.find(({ name }) => name === "shevanio-pi:probe")!.handler(args, ctx);
	assert.deepEqual(calls, [args]);
	assert.deepEqual(notifications, []);
	calls.length = 0;
	await commands.find(({ name }) => name === "gentle:probe")!.handler(args, ctx);
	assert.deepEqual(calls, [args]);
	assert.deepEqual(notifications, [{ message: deprecatedAliasNotice("probe"), type: "warning" }]);
});
