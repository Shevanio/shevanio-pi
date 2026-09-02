#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createAgentSession, DefaultResourceLoader, SessionManager } from "@earendil-works/pi-coding-agent";

const root = fileURLToPath(new URL("..", import.meta.url));
const originalCwd = process.cwd();
const temporary = mkdtempSync(join(tmpdir(), "shevanio-pi-packed-runner-"));
const packDirectory = join(temporary, "pack");
const installDirectory = join(temporary, "install");
const SELF_DESCRIPTION = "I am Shevanio AI, the parent coding-agent identity in Shevanio Pi, a Pi package/runtime harness for controlled development. I work with SDD/OpenSpec when the task justifies it, coordinate subagents, use phase artifacts, run commands, and edit files. I am not a generic chatbot.";
const PARENT_PACKAGE_MODEL = "Shevanio AI is the parent/product identity; Shevanio Pi is the package/runtime harness and ecosystem configurator.";
const PROVIDER_SENTENCE = "Gentle AI dynamically supplies runtime-specific RDD instructions via generated Pi APPEND_SYSTEM composition. Follow only those exact native instructions; if absent or unsupported, this package does not invent or fall back.";

function windowsNpmInvocation() {
	const candidates = [];
	if (process.env.npm_execpath !== undefined && /[\\/]npm[\\/]bin[\\/]npm-cli\.js$/i.test(process.env.npm_execpath)) candidates.push(process.env.npm_execpath);
	for (const executable of new Set([process.execPath, realpathSync(process.execPath)])) candidates.push(join(dirname(executable), "node_modules", "npm", "bin", "npm-cli.js"));
	const installedCli = candidates.find((path) => existsSync(path));
	if (installedCli !== undefined) return { file: process.execPath, prefix: [installedCli] };
	let commandPaths = [];
	try { commandPaths = execFileSync("where.exe", ["npm"], { encoding: "utf8", windowsHide: true }).split(/\r?\n/).filter(Boolean); }
	catch { /* fall through to the explicit resolution error */ }
	for (const path of commandPaths) {
		if (basename(path).toLowerCase() === "npm.exe") return { file: path, prefix: [] };
		const cli = join(dirname(path), "node_modules", "npm", "bin", "npm-cli.js");
		if (existsSync(cli)) return { file: process.execPath, prefix: [cli] };
	}
	throw new Error("could not resolve npm-cli.js without a command shell");
}

function runNpm(arguments_, options) {
	const invocation = process.platform === "win32" ? windowsNpmInvocation() : { file: "npm", prefix: [] };
	return execFileSync(invocation.file, [...invocation.prefix, ...arguments_], options);
}

try {
	mkdirSync(packDirectory);
	mkdirSync(installDirectory);
	const packed = JSON.parse(runNpm(["pack", "--ignore-scripts", "--json", "--pack-destination", packDirectory], {
		cwd: root,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "inherit"],
}));
	if (packed.length !== 1 || typeof packed[0]?.filename !== "string") throw new Error("npm pack did not return one tarball");
	const tarball = join(packDirectory, packed[0].filename);
	writeFileSync(join(installDirectory, "package.json"), JSON.stringify({ name: "shevanio-pi-packed-runner-test", private: true }), "utf8");
	runNpm(["install", "--ignore-scripts=false", "--no-audit", "--no-fund", "--package-lock=false", "--omit=dev", "--legacy-peer-deps", tarball], {
		cwd: installDirectory,
		env: { ...process.env, GENTLE_PI_SKIP_GENTLE_AI_INSTALL: "1" },
		stdio: "inherit",
	});
	const packageRoot = join(installDirectory, "node_modules", "shevanio-pi");
	for (const path of ["lib/command-alias.ts", "extensions/startup-banner.ts"]) if (!existsSync(join(packageRoot, path))) throw new Error(`packed shevanio-pi is missing ${path}`);
	const capabilities = JSON.parse(readFileSync(join(packageRoot, "contracts", "review-integration", "v2", "fixtures", "capabilities.fixture.json"), "utf8"));
	// Import the PACKED consumer's own decoder and exercise it against the bundled,
	// byte-pinned capabilities fixture. This proves canonical package discovery and
	// validates the whole compatibility envelope without installing or launching a
	// provider binary; provider/runtime E2E belongs to the separate contract lanes.
	const { decodeReviewCapabilitiesV2 } = await import(pathToFileURL(join(packageRoot, "runtime", "review-integration-v2.mjs")).href);
	const decoded = decodeReviewCapabilitiesV2(capabilities, capabilities.executable.sha256);
	if (decoded.contract !== "gentle-ai.review-integration/v2" || decoded.packageVersion !== capabilities.package.version) throw new Error("packed shevanio-pi contract fixture is incompatible");
	const suffixes = ["background-subagents", "banner", "banner-color", "dev-binary", "doctor", "install-sdd", "models", "persona", "review-mode", "sdd-preflight", "status", "toggle-rose", "toggle-text-logo"];
	const runtimeCwd = join(temporary, "runtime-cwd"), runtimeAgentDir = join(temporary, "runtime-agent"), runtimeHome = join(temporary, "runtime-home");
	for (const path of [runtimeCwd, runtimeAgentDir, runtimeHome]) mkdirSync(path);
	Object.assign(process.env, { HOME: runtimeHome, USERPROFILE: runtimeHome, SHEVANIO_PI_CONFIG_HOME: join(runtimeHome, "shevanio-config"), GENTLE_PI_CONFIG_HOME: join(runtimeHome, "config"), GENTLE_PI_AGENT_HOME: runtimeAgentDir, GENTLE_PI_NO_SKILL_REGISTRY: "1", PI_OFFLINE: "1" });
	process.chdir(runtimeCwd);
	const loader = new DefaultResourceLoader({ cwd: runtimeCwd, agentDir: runtimeAgentDir, additionalExtensionPaths: ["ask-user-choice.ts", "codegraph-tools.ts", "gentle-ai.ts", "pi-pretty.ts", "quiet-tools.ts", "sdd-init.ts", "skill-registry.ts", "startup-banner.ts"].map((path) => join(packageRoot, "extensions", path)), noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
	await loader.reload();
	if (loader.getExtensions().errors.length !== 0) throw new Error(`packed extensions failed to load: ${JSON.stringify(loader.getExtensions().errors)}`);
	const { session } = await createAgentSession({ cwd: runtimeCwd, agentDir: runtimeAgentDir, resourceLoader: loader, sessionManager: SessionManager.inMemory(runtimeCwd), noTools: "builtin" });
	const runner = session.extensionRunner, commands = runner.getRegisteredCommands();
	for (const suffix of suffixes) {
		for (const name of [`shevanio-pi:${suffix}`, `gentle:${suffix}`]) {
			const matches = commands.filter((command) => command.name === name);
			if (matches.length !== 1 || matches[0].invocationName !== name) throw new Error(`packed command ${name} is missing or duplicated`);
		}
		if (!runner.getCommand(`gentle:${suffix}`).description.startsWith(`Deprecated alias; use /shevanio-pi:${suffix}. Removed in shevanio-pi 3.0.0.`)) throw new Error(`packed alias gentle:${suffix} has an invalid deprecation description`);
	}
	if (commands.some(({ invocationName }) => /:(?:1|2)$/.test(invocationName))) throw new Error("packed commands contain package-internal duplicate suffixes");
	for (const name of ["sdd-status", "sdd-continue", "sdd-init", "skill-registry:refresh"]) if (commands.filter((command) => command.name === name && command.invocationName === name).length !== 1) throw new Error(`generic command ${name} changed`);
	const registeredToolNames = runner.getAllRegisteredTools().map(({ definition }) => definition.name);
	const reviewTools = registeredToolNames.filter((name) => name.startsWith("shevanio_review")).sort();
	if (JSON.stringify(reviewTools) !== JSON.stringify(["shevanio_review", "shevanio_review_capture", "shevanio_review_scope"])) throw new Error(`packed review tool identities changed: ${reviewTools.join(", ")}`);
	for (const name of ["gentle_review", "gentle_review_capture", "gentle_review_scope"]) if (registeredToolNames.includes(name)) throw new Error(`packed legacy review tool must not be registered: ${name}`);
	const choices = [], pickers = [];
	runner.setUIContext({ ...runner.getUIContext(), notify() {}, async select(label, options) { pickers.push({ label, options }); return choices.shift() ?? options[0]; } });
	const canonicalGlobalPersona = join(process.env.SHEVANIO_PI_CONFIG_HOME, "persona.json"), legacyGlobalPersona = join(process.env.GENTLE_PI_CONFIG_HOME, "persona.json");
	const canonicalProjectPersona = join(runtimeCwd, ".pi", "shevanio-pi", "persona.json"), legacyProjectPersona = join(runtimeCwd, ".pi", "gentle-ai", "persona.json");
	const legacyGlobalBytes = '{"mode":"neutral","preserve":true}\n', legacyProjectBytes = '{"mode":"gentleman","preserve":true}\n';
	mkdirSync(dirname(legacyGlobalPersona), { recursive: true }); writeFileSync(legacyGlobalPersona, legacyGlobalBytes);
	choices.push("shevanio-ai"); await session.prompt("/shevanio-pi:persona global");
	if (JSON.stringify(pickers.at(-1)) !== JSON.stringify({ label: "Shevanio AI persona (current: neutral)", options: ["shevanio-ai", "neutral"] })) throw new Error("packed persona picker is not canonical");
	if (readFileSync(canonicalGlobalPersona, "utf8") !== '{\n  "schema": "shevanio-pi.persona/v1",\n  "mode": "shevanio-ai"\n}\n' || readFileSync(legacyGlobalPersona, "utf8") !== legacyGlobalBytes) throw new Error("packed global persona authority failed");
	mkdirSync(dirname(legacyProjectPersona), { recursive: true }); writeFileSync(legacyProjectPersona, legacyProjectBytes);
	choices.push("neutral"); await session.prompt("/shevanio-pi:persona project");
	const packedPrompt = await runner.emitBeforeAgentStart("packed persona", undefined, "BASE", {});
	if (!/"mode": "neutral"/.test(readFileSync(canonicalProjectPersona, "utf8")) || readFileSync(legacyProjectPersona, "utf8") !== legacyProjectBytes || !/Current persona mode: neutral/.test(packedPrompt.systemPrompt)) throw new Error("packed project persona precedence failed");
	const alwaysOnAsset = readFileSync(join(packageRoot, "assets", "orchestrator.md"), "utf8");
	const lazyWorkflowAsset = readFileSync(join(packageRoot, "assets", "sdd-orchestrator-workflow.md"), "utf8");
	const compatibilitySkill = readFileSync(join(packageRoot, "skills", "gentle-ai", "SKILL.md"), "utf8");
	if (!packedPrompt.systemPrompt.includes(PARENT_PACKAGE_MODEL) || packedPrompt.systemPrompt.split(SELF_DESCRIPTION).length - 1 !== 1 || /\bel Gentleman\b/.test(packedPrompt.systemPrompt)) throw new Error("packed parent identity composition failed");
	if (alwaysOnAsset.split(PROVIDER_SENTENCE).length - 1 !== 1 || /\bel Gentleman\b/.test(alwaysOnAsset)) throw new Error("packed always-on provider boundary failed");
	if (!lazyWorkflowAsset.includes(PARENT_PACKAGE_MODEL) || /\bel Gentleman\b/.test(lazyWorkflowAsset)) throw new Error("packed lazy workflow identity failed");
	if (!compatibilitySkill.includes(PARENT_PACKAGE_MODEL) || !/^name: gentle-ai$/m.test(compatibilitySkill) || /\bel Gentleman\b/.test(compatibilitySkill)) throw new Error("packed compatibility skill identity failed");
	await runner.emit({ type: "session_shutdown", reason: "quit" });
	const packageManifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
	process.stdout.write(`packed package E2E passed (shevanio-pi ${packageManifest.version ?? "unknown"}; 13 canonical commands + deprecated aliases; persona authority verified; bundled Gentle AI contract fixture ${decoded.packageVersion ?? "unknown"}; provider install skipped)\n`);
} finally {
	process.chdir(originalCwd);
	rmSync(temporary, { recursive: true, force: true });
}
