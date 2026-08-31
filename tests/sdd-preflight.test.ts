import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	collectSddPreflightPreferences,
	DEFAULT_SDD_PREFLIGHT,
	ensureSddPreflight,
	getSddPreflightPreferences,
	installSddAssets,
	legacySddPreflightDiskPath,
	readSddPreflightFromDisk,
	SDD_PREFLIGHT_FIELDS,
	sddPreflightDiskPath,
	writeSddPreflightToDisk,
	type SddPreflightPreferences,
} from "../lib/sdd-preflight.ts";

async function workspace(): Promise<string> {
	return mkdtemp(join(tmpdir(), "gentle-pi-sdd-preflight-"));
}

function replaceExactly(source: string, current: string, previous: string): string {
	assert.equal(source.split(current).length - 1, 1, `expected one ${JSON.stringify(current)}`);
	return source.replace(current, previous);
}

function routingFrontmatter(source: string): string[] {
	return source.match(/^(?:model|thinking):.*$/gm) ?? [];
}

const SAMPLE_PREFS: SddPreflightPreferences = {
	executionMode: "auto",
	artifactStore: "engram",
	chainedPrStrategy: "auto-chain",
	reviewBudgetLines: 400,
	engramAvailable: true,
	prompted: true,
};

function preflightContext(cwd: string, hasUI: boolean, calls: string[] = [], answers: Record<string, string> = {}) {
	return { cwd, hasUI, ui: { select: async (title: string) => (calls.push(`select:${title}`), answers[title]), input: async (title: string) => (calls.push(`input:${title}`), answers[title]), notify: () => {} } } as Parameters<typeof collectSddPreflightPreferences>[0];
}
function writeRawPreflight(cwd: string, chainedPrStrategy: string, prompted = true): string {
	const path = legacySddPreflightDiskPath(cwd); mkdirSync(join(cwd, ".pi", "gentle-ai"), { recursive: true }); writeFileSync(path, JSON.stringify({ executionMode: "auto", artifactStore: "openspec", chainedPrStrategy, reviewBudgetLines: 400, engramAvailable: false, prompted })); return path;
}
test("production callers distinguish automatic defaults from explicit preflight prompts", () => {
	const root = join(import.meta.dirname, ".."), gentleAi = readFileSync(join(root, "extensions", "gentle-ai.ts"), "utf8"), sddInit = readFileSync(join(root, "extensions", "sdd-init.ts"), "utf8");
	assert.match(gentleAi, /if \(isSddAgent\) await runSddPreflight\(ctx\);/); assert.match(gentleAi, /await runSddPreflight\(ctx, SDD_PREFLIGHT_FIELDS, true\);/); assert.match(sddInit, /applyModelConfig: \(\) => applySavedModelConfig\(ctx\)\s*\},\s*\{\s*promptFields: \[\]\s*\}\s*\);/s);
});
test("capability-constrained artifact selector elision", async () => {
	const calls: string[] = [], prefs = await collectSddPreflightPreferences(preflightContext(await workspace(), true, calls), false, { promptFields: ["artifactStore"] });
	assert.deepEqual(prefs, DEFAULT_SDD_PREFLIGHT); assert.deepEqual(calls, []);
});
test("headless/UI canonical-domain parity", async () => {
	const calls: string[] = [], ui = await collectSddPreflightPreferences(preflightContext(await workspace(), true, calls), false), headless = await collectSddPreflightPreferences(preflightContext(await workspace(), false), false);
	assert.deepEqual(ui, DEFAULT_SDD_PREFLIGHT); assert.deepEqual(headless, ui); assert.deepEqual(calls, []);
});
test("explicit UI selections override defaults when a field is genuinely unresolved", async () => {
	const calls: string[] = [], prefs = await collectSddPreflightPreferences(preflightContext(await workspace(), true, calls, { "SDD execution mode": "interactive", "SDD artifact store": "engram", "SDD delivery strategy": "auto-chain", "SDD review budget lines": "700" }), true, { persisted: DEFAULT_SDD_PREFLIGHT, promptFields: ["executionMode", "artifactStore", "chainedPrStrategy", "reviewBudgetLines"] });
	assert.deepEqual({ executionMode: prefs.executionMode, artifactStore: prefs.artifactStore, chainedPrStrategy: prefs.chainedPrStrategy, reviewBudgetLines: prefs.reviewBudgetLines }, { executionMode: "interactive", artifactStore: "engram", chainedPrStrategy: "auto-chain", reviewBudgetLines: 700 }); assert.equal(prefs.prompted, true); assert.equal(calls.length, 4);
});
test("legacy persisted strategies normalize to canonical values", async () => {
	const mappings = { "auto-forecast": "ask-on-risk", "ask-always": "ask-on-risk", "single-pr-default": "single-pr", "force-chained": "auto-chain" } as const;
	for (const [legacy, canonical] of Object.entries(mappings)) { const cwd = await workspace(); writeRawPreflight(cwd, legacy); assert.equal(readSddPreflightFromDisk(cwd)?.chainedPrStrategy, canonical); }
});
test("exception-ok requires narrow delivery-gate provenance", async () => {
	for (const prompted of [false, true]) { const cwd = await workspace(); writeRawPreflight(cwd, "exception-ok", prompted); assert.equal(readSddPreflightFromDisk(cwd)?.chainedPrStrategy, "ask-on-risk"); }
	const accepted = await collectSddPreflightPreferences(preflightContext(await workspace(), false), false, { persisted: { ...DEFAULT_SDD_PREFLIGHT, chainedPrStrategy: "exception-ok" }, acceptSizeException: true }); assert.equal(accepted.chainedPrStrategy, "exception-ok"); assert.equal(accepted.sizeExceptionAccepted, true);
	const durable = await workspace(); writeSddPreflightToDisk(durable, accepted); assert.equal(readSddPreflightFromDisk(durable)?.chainedPrStrategy, "ask-on-risk");
});

test("preflight paths are fixed project-local canonical and legacy authorities", async () => {
	const cwd = await workspace();
	const path = sddPreflightDiskPath(cwd);
	assert.equal(path, join(cwd, ".pi", "shevanio-pi", "sdd-preflight.json")); assert.equal(legacySddPreflightDiskPath(cwd), join(cwd, ".pi", "gentle-ai", "sdd-preflight.json"));
});

test("writeSddPreflightToDisk creates parent dirs and writes valid JSON", async () => {
	const cwd = await workspace();
	writeSddPreflightToDisk(cwd, SAMPLE_PREFS);

	const path = sddPreflightDiskPath(cwd);
	assert.ok(existsSync(path));
	const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
	assert.deepEqual(parsed, { schema: "shevanio-pi.sdd-preflight/v1", executionMode: "auto", artifactStore: "engram", chainedPrStrategy: "auto-chain", reviewBudgetLines: 400 });
});

test("readSddPreflightFromDisk returns undefined when no file exists", async () => {
	const cwd = await workspace();
	assert.equal(readSddPreflightFromDisk(cwd), undefined);
});

test("readSddPreflightFromDisk returns persisted prefs after write", async () => {
	const cwd = await workspace();
	writeSddPreflightToDisk(cwd, SAMPLE_PREFS);

	const loaded = readSddPreflightFromDisk(cwd);
	assert.deepEqual({ executionMode: loaded?.executionMode, artifactStore: loaded?.artifactStore, chainedPrStrategy: loaded?.chainedPrStrategy, reviewBudgetLines: loaded?.reviewBudgetLines }, { executionMode: "auto", artifactStore: "engram", chainedPrStrategy: "auto-chain", reviewBudgetLines: 400 }); assert.equal(loaded?.preferenceSource, "canonical-project");
});

test("persisted preferences are reused with zero prompts", async () => {
	const cwd = await workspace(); writeSddPreflightToDisk(cwd, SAMPLE_PREFS);
	const loaded = readSddPreflightFromDisk(cwd); assert.ok(loaded);
	const calls: string[] = [], reused = await collectSddPreflightPreferences(preflightContext(cwd, true, calls), true, { persisted: loaded });
	assert.equal(reused.artifactStore, "engram"); assert.equal(reused.engramAvailable, true); assert.equal(reused.prompted, false); assert.deepEqual(calls, []);
});

test("readSddPreflightFromDisk returns undefined for corrupt JSON", async () => {
	const cwd = await workspace();
	const path = sddPreflightDiskPath(cwd);
	mkdirSync(join(cwd, ".pi", "shevanio-pi"), { recursive: true });
	writeFileSync(path, "not-json{{{");

	assert.equal(readSddPreflightFromDisk(cwd)?.preferenceSource, "canonical-project"); assert.equal(readSddPreflightFromDisk(cwd)?.executionMode, "auto");
});

test("readSddPreflightFromDisk returns undefined for JSON with invalid fields", async () => {
	const cwd = await workspace();
	const path = sddPreflightDiskPath(cwd);
	mkdirSync(join(cwd, ".pi", "shevanio-pi"), { recursive: true });
	writeFileSync(path, JSON.stringify({ executionMode: "invalid", artifactStore: "openspec", chainedPrStrategy: "auto-forecast", reviewBudgetLines: 400, engramAvailable: false, prompted: false }));

	// executionMode "invalid" is not "interactive" | "auto" → should reject
	assert.equal(readSddPreflightFromDisk(cwd)?.preferenceSource, "canonical-project"); assert.equal(readSddPreflightFromDisk(cwd)?.executionMode, "auto");
});

test("canonical v1 rejects unknown chainedPrStrategy", async () => {
	const cwd = await workspace();
	const path = sddPreflightDiskPath(cwd);
	mkdirSync(join(cwd, ".pi", "shevanio-pi"), { recursive: true });
	writeFileSync(path, JSON.stringify({
		executionMode: "interactive",
		artifactStore: "openspec",
		chainedPrStrategy: "unknown-strategy",
		reviewBudgetLines: 400,
		engramAvailable: false,
		prompted: true,
	}));

	const loaded = readSddPreflightFromDisk(cwd);
	assert.equal(loaded?.chainedPrStrategy, "ask-on-risk"); assert.equal(loaded?.diagnostics?.[0].level, "warning");
});

test("writeSddPreflightToDisk is non-fatal when directory is not writable (no throw)", async () => {
	const cwd = await workspace(); writeFileSync(join(cwd, ".pi"), "blocked");
	const result = writeSddPreflightToDisk(cwd, SAMPLE_PREFS); assert.equal(result.status, "failed"); assert.match(result.error ?? "", /directory|EEXIST|ENOTDIR/i);
});

const callbacks = (tools: string[] = []) => ({ pi: { getActiveTools: () => tools }, installAssets: () => ({ agents: 0, chains: 0, support: 0, skipped: 0 }), applyModelConfig: () => ({ updated: 0, skipped: 0 }) }) as Parameters<typeof ensureSddPreflight>[1];
function ensuredContext(cwd: string, session: string, answers: Record<string, string> = {}) { return { ...preflightContext(cwd, Object.keys(answers).length > 0, [], answers), sessionManager: { getSessionFile: () => join(cwd, `${session}.jsonl`), getSessionId: () => session } } as Parameters<typeof ensureSddPreflight>[0]; }

test("canonical precedence, malformed authority, collision diagnostics, and reads preserve legacy bytes", async () => {
	const cwd = await workspace(), legacyPath = writeRawPreflight(cwd, "auto-forecast"), legacyBytes = readFileSync(legacyPath, "utf8");
	writeSddPreflightToDisk(cwd, { ...SAMPLE_PREFS, artifactStore: "openspec", chainedPrStrategy: "ask-on-risk" });
	let loaded = readSddPreflightFromDisk(cwd)!; assert.equal(loaded.preferenceSource, "canonical-project"); assert.equal(loaded.diagnostics?.[0].level, "info");
	writeFileSync(legacyPath, legacyBytes.replace("auto-forecast", "force-chained")); loaded = readSddPreflightFromDisk(cwd)!; assert.equal(loaded.chainedPrStrategy, "ask-on-risk"); assert.equal(loaded.diagnostics?.[0].level, "warning");
	const distinctLegacy = readFileSync(legacyPath, "utf8"); writeFileSync(sddPreflightDiskPath(cwd), "{broken"); loaded = readSddPreflightFromDisk(cwd)!;
	assert.equal(loaded.preferenceSource, "canonical-project"); assert.equal(loaded.executionMode, DEFAULT_SDD_PREFLIGHT.executionMode); assert.match(loaded.diagnostics?.[0].message ?? "", new RegExp(sddPreflightDiskPath(cwd).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))); assert.equal(readFileSync(legacyPath, "utf8"), distinctLegacy);
	const legacyOnly = await workspace(); writeFileSync(writeRawPreflight(legacyOnly, "ask-on-risk"), "invalid"); assert.equal(readSddPreflightFromDisk(legacyOnly)?.preferenceSource, "legacy-project"); assert.equal(existsSync(sddPreflightDiskPath(legacyOnly)), false);
});

test("automatic and explicit writes honor authority, exact-byte idempotency, and cache/session boundaries", async () => {
	const fresh = await workspace(), first = await ensureSddPreflight(ensuredContext(fresh, "same"), callbacks()); assert.equal(first.preferenceSource, "canonical-project");
	const canonicalPath = sddPreflightDiskPath(fresh), before = statSync(canonicalPath, { bigint: true }).mtimeNs; assert.equal(writeSddPreflightToDisk(fresh, first).status, "unchanged"); assert.equal(statSync(canonicalPath, { bigint: true }).mtimeNs, before);
	const legacyCwd = await workspace(), legacyPath = writeRawPreflight(legacyCwd, "force-chained"), legacyBytes = readFileSync(legacyPath, "utf8"); await ensureSddPreflight(ensuredContext(legacyCwd, "auto"), callbacks()); assert.equal(existsSync(sddPreflightDiskPath(legacyCwd)), false); assert.equal(readFileSync(legacyPath, "utf8"), legacyBytes);
	const explicit = await ensureSddPreflight(ensuredContext(legacyCwd, "auto", { "SDD execution mode": "interactive", "SDD delivery strategy": "single-pr", "SDD review budget lines": "500" }), callbacks(), { promptFields: SDD_PREFLIGHT_FIELDS, explicitWrite: true }); assert.equal(explicit.preferenceSource, "canonical-project"); assert.equal(explicit.executionMode, "interactive"); assert.equal(readFileSync(legacyPath, "utf8"), legacyBytes);
	const other = await workspace(); writeSddPreflightToDisk(other, { ...SAMPLE_PREFS, executionMode: "interactive" }); const crossRepo = await ensureSddPreflight(ensuredContext(other, "same"), callbacks(["mem_save"])); assert.equal(crossRepo.executionMode, "interactive"); assert.equal(crossRepo.engramAvailable, true);
	writeSddPreflightToDisk(other, { ...SAMPLE_PREFS, executionMode: "auto" }); assert.equal((await ensureSddPreflight(ensuredContext(other, "same"), callbacks())).executionMode, "interactive"); assert.equal((await ensureSddPreflight(ensuredContext(other, "new"), callbacks())).executionMode, "auto");
});

test("get never disk-seeds capability state and concurrent ensure remains single-flight", async () => {
	const cwd = await workspace(); writeSddPreflightToDisk(cwd, SAMPLE_PREFS); const ctx = ensuredContext(cwd, "capability"); assert.equal(getSddPreflightPreferences(ctx), undefined);
	let installs = 0; const delayed = { ...callbacks(["mem_save"]), installAssets: async () => { installs += 1; await new Promise((resolve) => setTimeout(resolve, 5)); return { agents: 0, chains: 0, support: 0, skipped: 0 }; } };
	const [a, b] = await Promise.all([ensureSddPreflight(ctx, delayed), ensureSddPreflight(ctx, delayed)]); assert.equal(a, b); assert.equal(a.engramAvailable, true); assert.equal(a.artifactStore, "engram"); assert.equal(installs, 1);
});

test("forced asset refresh migrates the exact v0.10.7 malformed sdd-apply asset and preserves user edits", () => {
	const packageRoot = join(import.meta.dirname, "..");
	const legacySource = readFileSync(
		join(
			packageRoot,
			"tests",
			"fixtures",
			"v0.10.7",
			"assets",
			"agents",
			"sdd-apply.md",
		),
		"utf8",
	);
	const currentSource = readFileSync(
		join(packageRoot, "assets", "agents", "sdd-apply.md"),
		"utf8",
	);
	const temporaryAgentHome = mkdtempSync(join(tmpdir(), "gentle-pi-v0107-preflight-"));
	const temporaryUserAgentHome = mkdtempSync(join(tmpdir(), "gentle-pi-v0107-user-preflight-"));
	const previousAgentHome = process.env.GENTLE_PI_AGENT_HOME;
	const installed = join(temporaryAgentHome, "agents", "sdd-apply.md");
	const userInstalled = join(temporaryUserAgentHome, "agents", "sdd-apply.md");
	const userEdited = legacySource.replace(
		"You are the SDD apply executor for Gentle AI.",
		"You are the user-customized SDD apply executor for Gentle AI.",
	);
	try {
		process.env.GENTLE_PI_AGENT_HOME = temporaryAgentHome;
		mkdirSync(join(temporaryAgentHome, "agents"), { recursive: true });
		writeFileSync(installed, legacySource);
		mkdirSync(join(temporaryAgentHome, "gentle-ai"), { recursive: true });
		writeFileSync(
			join(temporaryAgentHome, "gentle-ai", "managed-assets.json"),
			JSON.stringify({ schemaVersion: 1, assets: {} }),
		);

		installSddAssets(packageRoot, true);

		assert.equal(readFileSync(installed, "utf8"), currentSource);
		assert.match(readFileSync(installed, "utf8"), /^tools:\n  - read$/m);
		const managedAssets = JSON.parse(
			readFileSync(
				join(temporaryAgentHome, "gentle-ai", "managed-assets.json"),
				"utf8",
			),
		) as { assets: Record<string, string> };
		assert.equal(
			managedAssets.assets["agents/sdd-apply.md"],
			createHash("sha256").update(currentSource).digest("hex"),
			"the migrated asset must record current package ownership",
		);

		installSddAssets(packageRoot, true);
		assert.equal(
			readFileSync(installed, "utf8"),
			currentSource,
			"a current package-managed asset must remain refreshable",
		);

		process.env.GENTLE_PI_AGENT_HOME = temporaryUserAgentHome;
		mkdirSync(join(temporaryUserAgentHome, "agents"), { recursive: true });
		writeFileSync(userInstalled, userEdited);
		installSddAssets(packageRoot, true);
		assert.equal(
			readFileSync(userInstalled, "utf8"),
			userEdited,
			"a user-edited variant of the malformed legacy asset must remain untouched",
		);
	} finally {
		if (previousAgentHome === undefined) delete process.env.GENTLE_PI_AGENT_HOME;
		else process.env.GENTLE_PI_AGENT_HOME = previousAgentHome;
		rmSync(temporaryAgentHome, { recursive: true, force: true });
		rmSync(temporaryUserAgentHome, { recursive: true, force: true });
	}
});

test("forced refresh updates hash-owned identity assets and releases user-edited copies", () => {
	const packageRoot = join(import.meta.dirname, "..");
	const currentApply = readFileSync(join(packageRoot, "assets", "agents", "sdd-apply.md"), "utf8");
	const currentSupport = readFileSync(join(packageRoot, "assets", "support", "sdd-status-contract.md"), "utf8");
	const previousApply = replaceExactly(
		replaceExactly(currentApply, "for Shevanio AI.", "for Gentle AI."),
		"global Shevanio Pi strict-TDD support guidance",
		"global Gentle AI strict-TDD support guidance",
	);
	const previousSupport = replaceExactly(
		replaceExactly(currentSupport, "for Shevanio Pi SDD phases", "for Gentle Pi SDD phases"),
		"use Shevanio Pi's local SDD status engine",
		"use Gentle Pi's local SDD status engine",
	);
	const temporaryHome = mkdtempSync(join(tmpdir(), "shevanio-pi-identity-home-"));
	const temporaryAgentHome = mkdtempSync(join(tmpdir(), "shevanio-pi-identity-agent-home-"));
	const previousHome = process.env.HOME;
	const previousAgentHome = process.env.GENTLE_PI_AGENT_HOME;
	const installedApply = join(temporaryAgentHome, "agents", "sdd-apply.md");
	const installedSupport = join(temporaryAgentHome, "gentle-ai", "support", "sdd-status-contract.md");
	const manifestPath = join(temporaryAgentHome, "gentle-ai", "managed-assets.json");
	try {
		process.env.HOME = temporaryHome;
		process.env.GENTLE_PI_AGENT_HOME = temporaryAgentHome;
		mkdirSync(join(temporaryAgentHome, "agents"), { recursive: true });
		mkdirSync(join(temporaryAgentHome, "gentle-ai", "support"), { recursive: true });
		writeFileSync(installedApply, previousApply);
		writeFileSync(installedSupport, previousSupport);
		writeFileSync(manifestPath, JSON.stringify({ schemaVersion: 1, assets: {
			"agents/sdd-apply.md": createHash("sha256").update(previousApply).digest("hex"),
			"gentle-ai/support/sdd-status-contract.md": createHash("sha256").update(previousSupport).digest("hex"),
		} }, null, 2));

		installSddAssets(packageRoot, true);
		assert.equal(readFileSync(installedApply, "utf8"), currentApply);
		assert.equal(readFileSync(installedSupport, "utf8"), currentSupport);
		assert.deepEqual(routingFrontmatter(readFileSync(installedApply, "utf8")), routingFrontmatter(currentApply), "package model/thinking frontmatter must not change during refresh");
		let manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { assets: Record<string, string> };
		assert.equal(manifest.assets["agents/sdd-apply.md"], createHash("sha256").update(currentApply).digest("hex"));
		assert.equal(manifest.assets["gentle-ai/support/sdd-status-contract.md"], createHash("sha256").update(currentSupport).digest("hex"));

		const userApply = replaceExactly(
			replaceExactly(currentApply, "description: Implement SDD tasks", "description: User-owned SDD tasks"),
			"You are the SDD apply executor for Shevanio AI.",
			"You are the user-owned SDD apply executor.",
		);
		const userSupport = `${currentSupport}\nUser-owned support policy.\n`;
		writeFileSync(installedApply, userApply);
		writeFileSync(installedSupport, userSupport);
		installSddAssets(packageRoot, true);
		assert.equal(readFileSync(installedApply, "utf8"), userApply);
		assert.equal(readFileSync(installedSupport, "utf8"), userSupport);
		manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { assets: Record<string, string> };
		assert.equal(manifest.assets["agents/sdd-apply.md"], undefined);
		assert.equal(manifest.assets["gentle-ai/support/sdd-status-contract.md"], undefined);
	} finally {
		if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
		if (previousAgentHome === undefined) delete process.env.GENTLE_PI_AGENT_HOME; else process.env.GENTLE_PI_AGENT_HOME = previousAgentHome;
		rmSync(temporaryHome, { recursive: true, force: true });
		rmSync(temporaryAgentHome, { recursive: true, force: true });
	}
});

test("forced asset refresh migrates only untouched v0.14 package contracts and preserves user edits", () => {
	const packageRoot = join(import.meta.dirname, "..");
	const fixture = readFileSync(
		join(packageRoot, "tests", "fixtures", "v0.14", "assets", "agents", "review-risk.md"),
		"utf8",
	);
	const temporaryAgentHome = mkdtempSync(join(tmpdir(), "gentle-pi-v014-preflight-"));
	const previousAgentHome = process.env.GENTLE_PI_AGENT_HOME;
	const untouched = join(temporaryAgentHome, "agents", "review-risk.md");
	const edited = join(temporaryAgentHome, "agents", "review-readability.md");
	try {
		process.env.GENTLE_PI_AGENT_HOME = temporaryAgentHome;
		mkdirSync(join(temporaryAgentHome, "agents"), { recursive: true });
		writeFileSync(untouched, fixture);
		writeFileSync(edited, `${fixture}\nuser-owned edit\n`);

		installSddAssets(packageRoot, true);

		assert.match(readFileSync(untouched, "utf8"), /initial_review_tree/);
		assert.equal(readFileSync(edited, "utf8"), `${fixture}\nuser-owned edit\n`);
	} finally {
		if (previousAgentHome === undefined) delete process.env.GENTLE_PI_AGENT_HOME;
		else process.env.GENTLE_PI_AGENT_HOME = previousAgentHome;
		rmSync(temporaryAgentHome, { recursive: true, force: true });
	}
});

// gentle-ai calls the dual-store mode "hybrid"; this repo called the same
// operator-facing choice "both". Two names for one concept is how a caller ends
// up mapping between them by hand. gentle-ai owns the contract, so "hybrid" is
// canonical here too — but "both" is already persisted in operator preflight
// files on disk, so it must keep loading rather than fall back to the default.
test("a persisted legacy 'both' artifact store loads as hybrid", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "sdd-preflight-legacy-"));
	mkdirSync(join(cwd, ".pi", "gentle-ai"), { recursive: true });
	writeFileSync(
		legacySddPreflightDiskPath(cwd),
		JSON.stringify({ executionMode: "auto", artifactStore: "both", chainedPrStrategy: "ask-on-risk", reviewBudgetLines: 400, engramAvailable: true, prompted: true }),
	);

	const loaded = readSddPreflightFromDisk(cwd);
	assert.equal(loaded?.artifactStore, "hybrid", "legacy 'both' must normalize to the canonical name, not be discarded");
});

test("a persisted canonical 'hybrid' artifact store loads unchanged", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "sdd-preflight-hybrid-"));
	mkdirSync(join(cwd, ".pi", "gentle-ai"), { recursive: true });
	writeFileSync(
		legacySddPreflightDiskPath(cwd),
		JSON.stringify({ schema: "shevanio-pi.sdd-preflight/v1", executionMode: "auto", artifactStore: "hybrid", chainedPrStrategy: "ask-on-risk", reviewBudgetLines: 400 }),
	);

	const loaded = readSddPreflightFromDisk(cwd);
	assert.equal(loaded?.artifactStore, "hybrid");
});
