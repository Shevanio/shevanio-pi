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
const MANAGED_SPEAKER_AGENTS = {
	"gentle-ai-worker.md": "You are the package-owned implementation writer",
	"jd-fix-agent.md": "You are the Judgment Day fix agent",
	"jd-judge-a.md": "You are Judgment Day judge A",
	"jd-judge-b.md": "You are Judgment Day judge B",
	...Object.fromEntries(["apply", "archive", "design", "explore", "init", "onboard", "proposal", "research", "spec", "status", "sync", "tasks", "verify"].map((phase) => [`sdd-${phase}.md`, `You are the SDD ${phase} executor`])),
};

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
		env: { ...process.env, GENTLE_PI_SKIP_GENTLE_AI_INSTALL: "1", PI_OFFLINE: "1" },
		stdio: "inherit",
	});
	const packageRoot = join(installDirectory, "node_modules", "shevanio-pi");
	for (const path of ["lib/command-alias.ts", "extensions/startup-banner.ts"]) if (!existsSync(join(packageRoot, path))) throw new Error(`packed shevanio-pi is missing ${path}`);
	const packedBranchSkill = readFileSync(join(packageRoot, "skills", "branch-pr", "SKILL.md"), "utf8");
	if (!/^name: gentle-ai-branch-pr$/m.test(packedBranchSkill)) throw new Error("packed branch PR skill changed its compatibility selector");
	if (!packedBranchSkill.includes('description: "Create Shevanio AI pull requests with issue-first checks. Trigger: creating, opening, or preparing PRs for review."')) throw new Error("packed branch PR skill description is not canonical");
	if (packedBranchSkill.includes("Create Gentle AI pull requests with issue-first checks.")) throw new Error("packed branch PR skill retains the stale identity description");
	if (!/^  author: gentleman-programming$/m.test(packedBranchSkill) || !packedBranchSkill.includes("Trigger: creating, opening, or preparing PRs for review.")) throw new Error("packed branch PR skill changed provenance or trigger metadata");
	const assertManagedAgentName = (file, source) => {
		const expected = basename(file, ".md");
		if (!new RegExp(`^name: ${expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m").test(source)) throw new Error(`packed managed agent ${file} changed frontmatter identity`);
	};
	for (const [file, introduction] of Object.entries(MANAGED_SPEAKER_AGENTS)) {
		const source = readFileSync(join(packageRoot, "assets", "agents", file), "utf8");
		if (!source.includes(`${introduction} for Shevanio AI.`) || source.includes(`${introduction} for Gentle AI.`)) throw new Error(`packed managed speaker ${file} has stale ownership wording`);
		assertManagedAgentName(file, source);
	}
	for (const file of ["review-readability.md", "review-reliability.md", "review-resilience.md", "review-risk.md"]) {
		const source = readFileSync(join(packageRoot, "assets", "agents", file), "utf8");
		if (!source.includes("through the Shevanio Pi host relay") || source.includes("through the gentle-pi host relay")) throw new Error(`packed review lens ${file} has stale relay wording`);
		assertManagedAgentName(file, source);
	}
	for (const [file, canonical, stale] of [
		["sdd-apply.md", "global Shevanio Pi strict-TDD support guidance", "global Gentle AI strict-TDD support guidance"],
		["sdd-verify.md", "global Shevanio Pi strict-TDD verification support guidance", "global Gentle AI strict-TDD verification support guidance"],
		["sdd-spec.md", "unsupported in Shevanio Pi until", "unsupported in gentle-pi until"],
	]) {
		const source = readFileSync(join(packageRoot, "assets", "agents", file), "utf8");
		if (!source.includes(canonical) || source.includes(stale)) throw new Error(`packed managed agent ${file} has stale package guidance`);
	}
	const packedStatusContract = readFileSync(join(packageRoot, "assets", "support", "sdd-status-contract.md"), "utf8");
	for (const [canonical, stale] of [["contract for Shevanio Pi SDD phases", "contract for Gentle Pi SDD phases"], ["use Shevanio Pi's local SDD status engine", "use Gentle Pi's local SDD status engine"]]) if (!packedStatusContract.includes(canonical) || packedStatusContract.includes(stale)) throw new Error("packed status contract has stale package guidance");
	for (const file of ["gentle-ai-explore.md", "gentle-ai-verify.md"]) assertManagedAgentName(file, readFileSync(join(packageRoot, "assets", "agents", file), "utf8"));
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
	delete process.env.GENTLE_PI_AUTONOMOUS_MODE;
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
	if (runner.getCommand("shevanio-pi:models").description !== "Configure global per-agent models for Shevanio Pi.") throw new Error("packed models command description is not canonical");
	const registeredToolNames = runner.getAllRegisteredTools().map(({ definition }) => definition.name);
	const reviewTools = registeredToolNames.filter((name) => name.startsWith("shevanio_review")).sort();
	if (JSON.stringify(reviewTools) !== JSON.stringify(["shevanio_review", "shevanio_review_capture", "shevanio_review_scope"])) throw new Error(`packed review tool identities changed: ${reviewTools.join(", ")}`);
	for (const name of ["gentle_review", "gentle_review_capture", "gentle_review_scope"]) if (registeredToolNames.includes(name)) throw new Error(`packed legacy review tool must not be registered: ${name}`);
	const choices = [], pickers = [], notices = [];
	runner.setUIContext({ ...runner.getUIContext(), notify(message, type = "info") { notices.push({ message, type }); }, async confirm() { return false; }, async select(label, options) { pickers.push({ label, options }); return choices.shift() ?? options[0]; }, async input(_label, placeholder) { return placeholder; } });
	const canonicalGlobalGuardrails = join(process.env.SHEVANIO_PI_CONFIG_HOME, "runtime-guardrails.json"), canonicalProjectGuardrails = join(runtimeCwd, ".pi", "shevanio-pi", "runtime-guardrails.json"), legacyProjectGuardrails = join(runtimeCwd, ".pi", "gentle-ai", "runtime-guardrails.json");
	const legacyGuardrailBytes = '{"autonomousMode":true,"guardedCommands":{"gitPush":"allow","gitRebase":"confirm","npmPublish":"block"},"preserve":"legacy"}\n';
	mkdirSync(dirname(canonicalGlobalGuardrails), { recursive: true }); mkdirSync(dirname(legacyProjectGuardrails), { recursive: true });
	writeFileSync(canonicalGlobalGuardrails, '{"autonomousMode":true,"guardedCommands":{"gitPush":"block","gitRebase":"block","npmPublish":"allow"}}\n'); writeFileSync(legacyProjectGuardrails, legacyGuardrailBytes);
	const emitBash = (id, command) => runner.emitToolCall({ type: "tool_call", toolCallId: id, toolName: "bash", input: { command } });
	if (await emitBash("packed-guard-allow", "git push origin main") !== undefined) throw new Error("packed legacy project did not outrank canonical global for allow");
	const packedConfirm = await emitBash("packed-guard-confirm", "git rebase main");
	if (packedConfirm?.block !== true || !/not confirmed/.test(packedConfirm.reason ?? "")) throw new Error("packed legacy project did not preserve confirm");
	const packedBlock = await emitBash("packed-guard-block", "npm publish");
	if (packedBlock?.block !== true || !/destructive/.test(packedBlock.reason ?? "")) throw new Error("packed legacy project did not preserve block");
	mkdirSync(dirname(canonicalProjectGuardrails), { recursive: true }); writeFileSync(canonicalProjectGuardrails, '{"autonomousMode":true,"guardedCommands":{"gitPush":"block"}}\n');
	if ((await emitBash("packed-canonical-project", "git push origin main"))?.block !== true) throw new Error("packed canonical project did not outrank legacy project");
	if (readFileSync(legacyProjectGuardrails, "utf8") !== legacyGuardrailBytes) throw new Error("packed guardrail resolution changed legacy bytes");
	for (const path of [canonicalGlobalGuardrails, canonicalProjectGuardrails, legacyProjectGuardrails]) rmSync(path, { force: true });
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
	const canonicalPreflight = join(runtimeCwd, ".pi", "shevanio-pi", "sdd-preflight.json"), legacyPreflight = join(runtimeCwd, ".pi", "gentle-ai", "sdd-preflight.json"), legacyPreflightBytes = '{"executionMode":"auto","artifactStore":"openspec","chainedPrStrategy":"ask-on-risk","reviewBudgetLines":400,"engramAvailable":false,"prompted":false,"preserve":true}\n';
	writeFileSync(legacyPreflight, legacyPreflightBytes); choices.push("interactive", "auto-chain"); notices.length = 0; await session.prompt("/shevanio-pi:sdd-preflight");
	if (readFileSync(canonicalPreflight, "utf8") !== '{\n  "schema": "shevanio-pi.sdd-preflight/v1",\n  "executionMode": "interactive",\n  "artifactStore": "openspec",\n  "chainedPrStrategy": "auto-chain",\n  "reviewBudgetLines": 400\n}\n' || readFileSync(legacyPreflight, "utf8") !== legacyPreflightBytes) throw new Error("packed canonical/legacy preflight authority failed");
	if (!notices.some(({ message }) => message.includes(`Preference source: canonical-project (${canonicalPreflight})`) && message.includes(legacyPreflight))) throw new Error("packed preflight diagnostics do not name both project sources");
	const alwaysOnAsset = readFileSync(join(packageRoot, "assets", "orchestrator.md"), "utf8");
	const lazyWorkflowAsset = readFileSync(join(packageRoot, "assets", "sdd-orchestrator-workflow.md"), "utf8");
	const compatibilitySkill = readFileSync(join(packageRoot, "skills", "gentle-ai", "SKILL.md"), "utf8");
	const activePiOwnedFiles = ["extensions/gentle-ai.ts", "lib/sdd-preflight.ts", "extensions/skill-registry.ts", "lib/gentle-ai-binary.ts", "runtime/gentle-ai-binary.mjs", "lib/native-review-cli.ts", "runtime/native-review-cli.mjs", "lib/provider-contract-bundle.ts", "scripts/check-provider-contract.mjs", "scripts/install-gentle-ai.mjs", "README.md", "docs/native-authority-architecture.md", "docs/skill-style-guide.md", "prompts/skill-creation.md", "skills/skill-creator/SKILL.md"];
	const stalePiOwnedPhrases = ["el Gentleman", "Gentle AI safety policy", "Gentle AI SDD preflight complete", "Skip the Gentle AI skill registry", "Auto-generated by gentle-pi", "Reinstall gentle-pi", "gentle-pi does not implement", "gentle-pi provider contract bundle verifier", "roles gentle-pi supports", "this gentle-pi build", "gentle-pi supports major", "gentle-pi provider contract mirror", "until gentle-pi is reinstalled", "gentle-pi could not install", "field gentle-pi lacks", "gentle-pi negotiates", "`gentle-pi` projects", "gentle-pi is a Node.js", "part of `gentle-pi`", "packaged `gentle-pi` skill"];
	for (const relativePath of activePiOwnedFiles) {
		const source = readFileSync(join(packageRoot, relativePath), "utf8");
		for (const phrase of stalePiOwnedPhrases) if (source.includes(phrase)) throw new Error(`packed active Pi-owned file ${relativePath} retains stale phrase: ${phrase}`);
	}
	if (!packedPrompt.systemPrompt.includes(PARENT_PACKAGE_MODEL) || packedPrompt.systemPrompt.split(SELF_DESCRIPTION).length - 1 !== 1 || /\bel Gentleman\b/.test(packedPrompt.systemPrompt)) throw new Error("packed parent identity composition failed");
	if (alwaysOnAsset.split(PROVIDER_SENTENCE).length - 1 !== 1 || /\bel Gentleman\b/.test(alwaysOnAsset)) throw new Error("packed always-on provider boundary failed");
	if (!lazyWorkflowAsset.includes(PARENT_PACKAGE_MODEL) || /\bel Gentleman\b/.test(lazyWorkflowAsset)) throw new Error("packed lazy workflow identity failed");
	if (!compatibilitySkill.includes(PARENT_PACKAGE_MODEL) || !/^name: gentle-ai$/m.test(compatibilitySkill) || /\bel Gentleman\b/.test(compatibilitySkill)) throw new Error("packed compatibility skill identity failed");
	await runner.emit({ type: "session_shutdown", reason: "quit" });
	const packageManifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
	process.stdout.write(`packed package E2E passed (shevanio-pi ${packageManifest.version ?? "unknown"}; 13 canonical commands + deprecated aliases; guardrail and persona authority verified; bundled Gentle AI contract fixture ${decoded.packageVersion ?? "unknown"}; provider install skipped)\n`);
} finally {
	process.chdir(originalCwd);
	rmSync(temporary, { recursive: true, force: true });
}
