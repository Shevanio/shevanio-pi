import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { __testing } from "../extensions/gentle-ai.ts";

const canonical = (mode: "shevanio-ai" | "neutral") => `{"schema":"shevanio-pi.persona/v1","mode":"${mode}"}`;
const legacy = (mode: "gentleman" | "neutral", extra = "") => `{"mode":"${mode}"${extra}}`;
const missing = () => Object.assign(new Error("missing"), { code: "ENOENT" });
const reader = (files: Map<string, string | Error>) => (path: string) => { const value = files.get(path) ?? missing(); if (value instanceof Error) throw value; return value; };
const selfDescription = "I am Shevanio AI, the parent coding-agent identity in Shevanio Pi, a Pi package/runtime harness for controlled development. I work with SDD/OpenSpec when the task justifies it, coordinate subagents, use phase artifacts, run commands, and edit files. I am not a generic chatbot.";
const providerSentence = "Gentle AI dynamically supplies runtime-specific RDD instructions via generated Pi APPEND_SYSTEM composition. Follow only those exact native instructions; if absent or unsupported, this package does not invent or fall back.";
const countOccurrences = (text: string, value: string) => text.split(value).length - 1;

test("canonical decoding is exact while legacy decoding is tolerant and normalized", () => {
	for (const [raw, allowLegacy, expected] of [
		[canonical("shevanio-ai"), false, "shevanio-ai"], [canonical("neutral"), false, "neutral"],
		[legacy("gentleman", ',"kept":true'), true, "shevanio-ai"], [legacy("neutral", ',"kept":true'), true, "neutral"],
		['{"schema":"shevanio-pi.persona/v1","mode":"shevanio-ai","extra":true}', false, undefined],
		['{"schema":"other/v1","mode":"neutral"}', true, undefined], ['{"mode":"shevanio"}', true, undefined],
		['{"mode":"shevanio-ai"}', true, undefined], ['{"mode":"gentleman"}', false, undefined],
		['[]', true, undefined], ['null', true, undefined], ['{', true, undefined],
	] as const) assert.equal(__testing.parsePersonaDocument(raw, allowLegacy), expected);
});

test("resolution is scope-first, fail-closed, collision-aware, and path-deduplicated", () => {
	const cwd = "/repo", options = { env: { SHEVANIO_PI_CONFIG_HOME: "/canonical", GENTLE_PI_CONFIG_HOME: "/legacy" }, home: "/home" };
	const paths = __testing.personaPaths(cwd, options);
	const resolve = (entries: Array<[string, string | Error]>) => __testing.resolvePersonaConfig(cwd, { ...options, read: reader(new Map(entries)) });
	assert.deepEqual(resolve([]), { mode: "shevanio-ai", source: "built_in", malformed: false });
	assert.equal(resolve([[paths.legacyGlobal, legacy("gentleman")]]).source, "legacy_global");
	assert.deepEqual(resolve([[paths.legacyProject, legacy("neutral")], [paths.canonicalGlobal, canonical("shevanio-ai")]]).mode, "neutral");
	const conflict = resolve([[paths.canonicalProject, canonical("shevanio-ai")], [paths.legacyProject, legacy("neutral")]]);
	assert.equal(conflict.source, "canonical_project");
	assert.equal(conflict.collision?.equal, false);
	assert.match(__testing.personaDiagnostics(conflict)!.message, /canonical_project.*legacy_project.*different modes/);
	const equal = resolve([[paths.canonicalGlobal, canonical("neutral")], [paths.legacyGlobal, legacy("neutral")]]);
	assert.deepEqual(__testing.personaDiagnostics(equal)?.type, "info");
	for (const bad of ["{", Object.assign(new Error("denied"), { code: "EACCES" })]) {
		const closed = resolve([[paths.canonicalProject, bad], [paths.legacyProject, legacy("neutral")]]);
		assert.deepEqual({ mode: closed.mode, source: closed.source, malformed: closed.malformed }, { mode: "shevanio-ai", source: "canonical_project", malformed: true });
		assert.match(__testing.personaDiagnostics(closed)!.message, /without fallback/);
	}
	let reads = 0;
	const sameOptions = { env: { SHEVANIO_PI_CONFIG_HOME: "/same", GENTLE_PI_CONFIG_HOME: "/same" }, home: "/home" }, samePaths = __testing.personaPaths(cwd, sameOptions);
	const shared = __testing.resolvePersonaConfig(cwd, { ...sameOptions, read: (path: string) => { reads++; if (path === samePaths.canonicalGlobal) return canonical("neutral"); throw missing(); } });
	assert.deepEqual({ source: shared.source, collision: shared.collision, reads }, { source: "canonical_global", collision: undefined, reads: 3 });
});

test("writes are canonical, scoped, idempotent, truthful, and never mutate legacy files", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "persona-config-")), cwd = join(root, "project"), canonicalHome = join(root, "canonical"), legacyHome = join(root, "legacy");
	mkdirSync(cwd); const previous = { HOME: process.env.HOME, SHEVANIO_PI_CONFIG_HOME: process.env.SHEVANIO_PI_CONFIG_HOME, GENTLE_PI_CONFIG_HOME: process.env.GENTLE_PI_CONFIG_HOME };
	Object.assign(process.env, { HOME: root, SHEVANIO_PI_CONFIG_HOME: canonicalHome, GENTLE_PI_CONFIG_HOME: legacyHome });
	t.after(() => { for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value; rmSync(root, { recursive: true, force: true }); });
	const paths = __testing.personaPaths(cwd), legacyProjectBytes = '{"mode":"neutral","user":"keep"}\n', legacyGlobalBytes = '{"mode":"gentleman","user":"keep"}\n';
	for (const [path, bytes] of [[paths.legacyProject, legacyProjectBytes], [paths.legacyGlobal, legacyGlobalBytes]] as const) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes); }
	const notices: Array<{ message: string; type: string }> = [], pickers: Array<{ label: string; options: string[] }> = []; let picks = 0, selection: string | undefined;
	const ctx = { cwd, hasUI: true, ui: { notify: (message: string, type: string) => notices.push({ message, type }), select: async (label: string, options: string[]) => { picks++; pickers.push({ label, options }); return selection; } } } as any;
	await __testing.handlePersonaCommand("bogus", ctx); assert.equal(picks, 0); assert.match(notices.pop()!.message, /Unknown persona scope/);
	await __testing.handlePersonaCommand("", ctx); assert.equal(notices.length, 0); assert.equal(readFileSync(paths.legacyGlobal, "utf8"), legacyGlobalBytes);
	assert.deepEqual(pickers.at(-1), { label: "Shevanio AI persona (current: neutral)", options: ["shevanio-ai", "neutral"] });
	selection = "shevanio-ai"; await __testing.handlePersonaCommand("global", ctx);
	assert.equal(readFileSync(paths.canonicalGlobal, "utf8"), '{\n  "schema": "shevanio-pi.persona/v1",\n  "mode": "shevanio-ai"\n}\n');
	assert.match(notices.pop()!.message, /Shevanio AI persona set to: shevanio-ai[\s\S]*ineffective.*legacy_project/); assert.equal(__testing.writePersonaMode(cwd, "shevanio-ai", "global").changed, false);
	selection = "neutral"; await __testing.handlePersonaCommand("project", ctx);
	assert.match(readFileSync(paths.canonicalProject, "utf8"), /"mode": "neutral"/);
	assert.equal(readFileSync(paths.legacyProject, "utf8"), legacyProjectBytes); assert.equal(readFileSync(paths.legacyGlobal, "utf8"), legacyGlobalBytes);
	assert.equal(__testing.personaWriteTarget(cwd, "global", { env: { GENTLE_PI_CONFIG_HOME: legacyHome }, home: root }), join(legacyHome, "persona.json"));
});

test("canonical presentation keeps parent identity, provider ownership, and exclusions intact", () => {
	const canonicalPrompt = __testing.buildGentlePrompt("shevanio-ai"), neutralPrompt = __testing.buildGentlePrompt("neutral");
	for (const [mode, prompt] of [["shevanio-ai", canonicalPrompt], ["neutral", neutralPrompt]] as const) {
		assert.match(prompt, new RegExp(`## Shevanio AI Identity and Shevanio Pi Harness[\\s\\S]*Current persona mode: ${mode}`));
		assert.equal(countOccurrences(prompt, selfDescription), 1);
		assert.equal(countOccurrences(prompt, providerSentence), 1);
		assert.match(prompt, /Shevanio AI is the parent\/product identity; Shevanio Pi is the package\/runtime harness and ecosystem configurator\./);
		assert.doesNotMatch(prompt, /\bel Gentleman\b/);
	}
	assert.equal(__testing.shouldInjectPersona({}), true); assert.equal(__testing.shouldInjectPersona({ agentName: "worker" }), false); assert.equal(__testing.shouldInjectPersona({ agentName: "sdd-apply" }), false);
	const orchestrator = readFileSync(join(import.meta.dirname, "..", "assets", "orchestrator.md"), "utf8");
	assert.equal(countOccurrences(orchestrator, providerSentence), 1); assert.doesNotMatch(orchestrator, /\bel Gentleman\b/);
	assert.equal(createHash("sha256").update(orchestrator).digest("hex"), "872391c0245d8f055e9d13fc0abc5038d423830b7431ada77ee8c390e9555d32");
});
