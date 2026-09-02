import assert from "node:assert/strict";
import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { __testing } from "../extensions/gentle-ai.ts";

const { classifyGuardedCommand } = __testing;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
	return mkdtempSync(join(tmpdir(), "gentle-pi-autonomous-"));
}

function writeConfig(dir: string, relPath: string, content: unknown): void {
	const full = join(dir, relPath);
	mkdirSync(dirname(full), { recursive: true });
	writeFileSync(full, JSON.stringify(content, null, 2));
}

// ---------------------------------------------------------------------------
// classifyGuardedCommand — base contract
// ---------------------------------------------------------------------------

test("classifyGuardedCommand: git push plain → confirm by default (no autonomous mode)", () => {
	const result = classifyGuardedCommand("git push origin main", {
		autonomousMode: false,
		guardedCommands: {},
	});
	assert.equal(result, "confirm");
});

test("classifyGuardedCommand: git rebase → confirm by default (no autonomous mode)", () => {
	const result = classifyGuardedCommand("git rebase main", {
		autonomousMode: false,
		guardedCommands: {},
	});
	assert.equal(result, "confirm");
});

test("classifyGuardedCommand: npm publish → confirm by default (no autonomous mode)", () => {
	const result = classifyGuardedCommand("npm publish", {
		autonomousMode: false,
		guardedCommands: {},
	});
	assert.equal(result, "confirm");
});

test("classifyGuardedCommand: unknown command → not-guarded", () => {
	const result = classifyGuardedCommand("echo hello", {
		autonomousMode: false,
		guardedCommands: {},
	});
	assert.equal(result, "not-guarded");
});

// ---------------------------------------------------------------------------
// Hard-deny always blocks regardless of autonomous mode or config
// ---------------------------------------------------------------------------

test("classifyGuardedCommand: git push --force always blocked even with gitPush=allow", () => {
	const result = classifyGuardedCommand("git push --force origin main", {
		autonomousMode: true,
		guardedCommands: { gitPush: "allow" },
	});
	assert.equal(result, "block");
});

test("classifyGuardedCommand: git push --force-with-lease always blocked", () => {
	const result = classifyGuardedCommand("git push --force-with-lease origin main", {
		autonomousMode: true,
		guardedCommands: { gitPush: "allow" },
	});
	assert.equal(result, "block");
});

test("classifyGuardedCommand: git push -f always blocked even in autonomous mode", () => {
	const result = classifyGuardedCommand("git push -f origin main", {
		autonomousMode: true,
		guardedCommands: { gitPush: "allow" },
	});
	assert.equal(result, "block");
});

test("classifyGuardedCommand: git reset --hard always blocked", () => {
	const result = classifyGuardedCommand("git reset --hard HEAD~1", {
		autonomousMode: true,
		guardedCommands: {},
	});
	assert.equal(result, "block");
});

test("classifyGuardedCommand: rm -rf / always blocked", () => {
	const result = classifyGuardedCommand("rm -rf /", {
		autonomousMode: true,
		guardedCommands: {},
	});
	assert.equal(result, "block");
});

test("classifyGuardedCommand: rm -rf ~ always blocked", () => {
	const result = classifyGuardedCommand("rm -rf ~", {
		autonomousMode: true,
		guardedCommands: {},
	});
	assert.equal(result, "block");
});

test("classifyGuardedCommand: chmod -R 777 always blocked", () => {
	const result = classifyGuardedCommand("chmod -R 777 /etc", {
		autonomousMode: true,
		guardedCommands: {},
	});
	assert.equal(result, "block");
});

// ---------------------------------------------------------------------------
// Autonomous mode + allow action
// ---------------------------------------------------------------------------

test("classifyGuardedCommand: git push plain allowed when autonomousMode=true and gitPush=allow", () => {
	const result = classifyGuardedCommand("git push origin feature/test", {
		autonomousMode: true,
		guardedCommands: { gitPush: "allow" },
	});
	assert.equal(result, "allow");
});

test("classifyGuardedCommand: git push plain still confirm when autonomousMode=false even with gitPush=allow in config", () => {
	const result = classifyGuardedCommand("git push origin feature/test", {
		autonomousMode: false,
		guardedCommands: { gitPush: "allow" },
	});
	assert.equal(result, "confirm");
});

// ---------------------------------------------------------------------------
// Autonomous mode + confirm action (stays gated)
// ---------------------------------------------------------------------------

test("classifyGuardedCommand: git rebase stays confirm when autonomousMode=true and gitRebase=confirm", () => {
	const result = classifyGuardedCommand("git rebase main", {
		autonomousMode: true,
		guardedCommands: { gitRebase: "confirm" },
	});
	assert.equal(result, "confirm");
});

test("classifyGuardedCommand: git branch -D stays confirm in autonomous mode (gitBranchDeleteForce=confirm)", () => {
	const result = classifyGuardedCommand("git branch -D old-feature", {
		autonomousMode: true,
		guardedCommands: { gitBranchDeleteForce: "confirm" },
	});
	assert.equal(result, "confirm");
});

test("classifyGuardedCommand: git branch -df stays confirm in autonomous mode", () => {
	const result = classifyGuardedCommand("git branch -df old-feature", {
		autonomousMode: true,
		guardedCommands: { gitBranchDeleteForce: "confirm" },
	});
	assert.equal(result, "confirm");
});

test("classifyGuardedCommand: git branch --delete --force stays confirm in autonomous mode", () => {
	const result = classifyGuardedCommand("git branch --delete --force old-feature", {
		autonomousMode: true,
		guardedCommands: { gitBranchDeleteForce: "confirm" },
	});
	assert.equal(result, "confirm");
});

// ---------------------------------------------------------------------------
// Autonomous mode + block action
// ---------------------------------------------------------------------------

test("classifyGuardedCommand: npm publish blocked when autonomousMode=true and npmPublish=block", () => {
	const result = classifyGuardedCommand("npm publish", {
		autonomousMode: true,
		guardedCommands: { npmPublish: "block" },
	});
	assert.equal(result, "block");
});

// ---------------------------------------------------------------------------
// loadRuntimeGuardrailsConfig — file loading
// ---------------------------------------------------------------------------

test("loadRuntimeGuardrailsConfig: returns off config when no file exists", () => {
	const dir = makeTmpDir();
	try {
		const config = __testing.loadRuntimeGuardrailsConfig(dir, {
			gentlePiConfigHome: join(dir, "global-config"),
		});
		assert.equal(config.autonomousMode, false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("loadRuntimeGuardrailsConfig: env var GENTLE_PI_AUTONOMOUS_MODE=1 activates mode", () => {
	const original = process.env.GENTLE_PI_AUTONOMOUS_MODE;
	process.env.GENTLE_PI_AUTONOMOUS_MODE = "1";
	const dir = makeTmpDir();
	try {
		const config = __testing.loadRuntimeGuardrailsConfig(dir, {
			gentlePiConfigHome: join(dir, "global-config"),
		});
		assert.equal(config.autonomousMode, true);
	} finally {
		rmSync(dir, { recursive: true, force: true });
		if (original === undefined) delete process.env.GENTLE_PI_AUTONOMOUS_MODE;
		else process.env.GENTLE_PI_AUTONOMOUS_MODE = original;
	}
});

test("loadRuntimeGuardrailsConfig: global config file activates autonomous mode", () => {
	const dir = makeTmpDir();
	try {
		const globalConfigDir = join(dir, "global-config");
		writeConfig(globalConfigDir, "runtime-guardrails.json", {
			autonomousMode: true,
			guardedCommands: { gitPush: "allow" },
		});
		const config = __testing.loadRuntimeGuardrailsConfig(join(dir, "project"), {
			gentlePiConfigHome: globalConfigDir,
		});
		assert.equal(config.autonomousMode, true);
		assert.equal(config.guardedCommands.gitPush, "allow");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("loadRuntimeGuardrailsConfig: project config overrides global config", () => {
	const dir = makeTmpDir();
	try {
		const globalConfigDir = join(dir, "global-config");
		const projectDir = join(dir, "project");

		writeConfig(globalConfigDir, "runtime-guardrails.json", {
			autonomousMode: true,
			guardedCommands: { gitPush: "allow", npmPublish: "confirm" },
		});
		writeConfig(projectDir, join(".pi", "gentle-ai", "runtime-guardrails.json"), {
			autonomousMode: true,
			guardedCommands: { gitPush: "confirm", npmPublish: "block" },
		});

		const config = __testing.loadRuntimeGuardrailsConfig(projectDir, {
			gentlePiConfigHome: globalConfigDir,
		});
		assert.equal(config.autonomousMode, true);
		assert.equal(config.guardedCommands.gitPush, "confirm");
		assert.equal(config.guardedCommands.npmPublish, "block");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("loadRuntimeGuardrailsConfig: invalid JSON in config fails safe (autonomousMode=false)", () => {
	const dir = makeTmpDir();
	try {
		const globalConfigDir = join(dir, "global-config");
		const configPath = join(globalConfigDir, "runtime-guardrails.json");
		mkdirSync(globalConfigDir, { recursive: true });
		writeFileSync(configPath, "{ not valid json }");

		const config = __testing.loadRuntimeGuardrailsConfig(join(dir, "project"), {
			gentlePiConfigHome: globalConfigDir,
		});
		assert.equal(config.autonomousMode, false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("loadRuntimeGuardrailsConfig: non-object JSON fails safe", () => {
	const dir = makeTmpDir();
	try {
		const globalConfigDir = join(dir, "global-config");
		writeConfig(globalConfigDir, "runtime-guardrails.json", [1, 2, 3]);

		const config = __testing.loadRuntimeGuardrailsConfig(join(dir, "project"), {
			gentlePiConfigHome: globalConfigDir,
		});
		assert.equal(config.autonomousMode, false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("loadRuntimeGuardrailsConfig: invalid project config fails safe (autonomousMode=false)", () => {
	const dir = makeTmpDir();
	try {
		const globalConfigDir = join(dir, "global-config");
		const projectDir = join(dir, "project");

		writeConfig(globalConfigDir, "runtime-guardrails.json", {
			autonomousMode: true,
			guardedCommands: { gitPush: "allow" },
		});
		const projectConfigPath = join(
			projectDir,
			".pi",
			"gentle-ai",
			"runtime-guardrails.json",
		);
		mkdirSync(dirname(projectConfigPath), { recursive: true });
		writeFileSync(projectConfigPath, "{ bad json }");

		const config = __testing.loadRuntimeGuardrailsConfig(projectDir, {
			gentlePiConfigHome: globalConfigDir,
		});
		assert.equal(config.autonomousMode, false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runtime guardrail authority reads all four canonical and legacy positions", () => {
	const dir = makeTmpDir();
	try {
		for (const source of ["canonical-global", "legacy-global", "canonical-project", "legacy-project"] as const) {
			const root = join(dir, source), cwd = join(root, "project"), canonicalHome = join(root, "canonical"), legacyHome = join(root, "legacy");
			const path = source.endsWith("global")
				? join(source.startsWith("canonical") ? canonicalHome : legacyHome, "runtime-guardrails.json")
				: join(cwd, ".pi", source.startsWith("canonical") ? "shevanio-pi" : "gentle-ai", "runtime-guardrails.json");
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, '{"autonomousMode":true,"guardedCommands":{"gitPush":"allow"}}');
			const resolved = __testing.resolveRuntimeGuardrailsConfig(cwd, { shevanioPiConfigHome: canonicalHome, gentlePiConfigHome: legacyHome });
			assert.equal((source.endsWith("global") ? resolved.global : resolved.project)?.selected?.source, source);
			assert.deepEqual(resolved.config, { autonomousMode: true, guardedCommands: { gitPush: "allow" } });
		}
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test("canonical files win within both scopes and diagnostics report conflicts", () => {
	const dir = makeTmpDir(), cwd = join(dir, "project"), canonicalHome = join(dir, "canonical"), legacyHome = join(dir, "legacy");
	try {
		writeConfig(canonicalHome, "runtime-guardrails.json", { autonomousMode: true, guardedCommands: { gitRebase: "allow" } });
		writeConfig(legacyHome, "runtime-guardrails.json", { autonomousMode: true, guardedCommands: { gitRebase: "block" } });
		writeConfig(cwd, join(".pi", "shevanio-pi", "runtime-guardrails.json"), { autonomousMode: false, guardedCommands: { gitPush: "block" } });
		writeConfig(cwd, join(".pi", "gentle-ai", "runtime-guardrails.json"), { autonomousMode: true, guardedCommands: { gitPush: "allow" } });
		const resolved = __testing.resolveRuntimeGuardrailsConfig(cwd, { shevanioPiConfigHome: canonicalHome, gentlePiConfigHome: legacyHome });
		assert.deepEqual(resolved.config, { autonomousMode: false, guardedCommands: { gitRebase: "allow", gitPush: "block" } });
		assert.equal(resolved.global?.selected?.source, "canonical-global");
		assert.equal(resolved.project?.selected?.source, "canonical-project");
		assert.equal(__testing.runtimeGuardrailDiagnostics(resolved).filter((line) => line.startsWith("warn:")).length, 2);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test("legacy project overlays canonical global with the existing exact merge", () => {
	const dir = makeTmpDir(), cwd = join(dir, "project"), canonicalHome = join(dir, "canonical"), legacyHome = join(dir, "legacy");
	try {
		writeConfig(canonicalHome, "runtime-guardrails.json", { autonomousMode: true, guardedCommands: { gitPush: "block", npmPublish: "confirm" } });
		writeConfig(cwd, join(".pi", "gentle-ai", "runtime-guardrails.json"), { autonomousMode: false, guardedCommands: { gitPush: "allow" } });
		const resolved = __testing.resolveRuntimeGuardrailsConfig(cwd, { shevanioPiConfigHome: canonicalHome, gentlePiConfigHome: legacyHome });
		assert.equal(resolved.project?.selected?.source, "legacy-project");
		assert.deepEqual(resolved.config, { autonomousMode: false, guardedCommands: { gitPush: "allow", npmPublish: "confirm" } });
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test("equal normalized same-scope files are informational", () => {
	const dir = makeTmpDir(), canonicalHome = join(dir, "canonical"), legacyHome = join(dir, "legacy");
	try {
		writeConfig(canonicalHome, "runtime-guardrails.json", { autonomousMode: true, guardedCommands: { gitPush: "allow" }, canonicalOnly: true });
		writeConfig(legacyHome, "runtime-guardrails.json", { guardedCommands: { ignored: "block", gitPush: "allow" }, autonomousMode: true });
		const resolved = __testing.resolveRuntimeGuardrailsConfig(join(dir, "project"), { shevanioPiConfigHome: canonicalHome, gentlePiConfigHome: legacyHome });
		assert.match(__testing.runtimeGuardrailDiagnostics(resolved).join("\n"), /^info: Runtime guardrails global match:.*canonical-global.*legacy-global/m);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test("malformed or unreadable winning canonical authority never falls through", () => {
	const dir = makeTmpDir();
	try {
		for (const scope of ["global", "project"] as const) {
			const root = join(dir, scope), cwd = join(root, "project"), canonicalHome = join(root, "canonical"), legacyHome = join(root, "legacy");
			const canonical = scope === "global" ? join(canonicalHome, "runtime-guardrails.json") : join(cwd, ".pi", "shevanio-pi", "runtime-guardrails.json");
			const legacy = scope === "global" ? join(legacyHome, "runtime-guardrails.json") : join(cwd, ".pi", "gentle-ai", "runtime-guardrails.json");
			mkdirSync(dirname(canonical), { recursive: true }); mkdirSync(dirname(legacy), { recursive: true });
			writeFileSync(canonical, "{bad json"); writeFileSync(legacy, '{"autonomousMode":true,"guardedCommands":{"gitPush":"allow"}}');
			const resolved = __testing.resolveRuntimeGuardrailsConfig(cwd, { shevanioPiConfigHome: canonicalHome, gentlePiConfigHome: legacyHome });
			assert.deepEqual(resolved.config, { autonomousMode: false, guardedCommands: {} });
			assert.match(__testing.runtimeGuardrailDiagnostics(resolved).join("\n"), new RegExp(`fail: Runtime guardrails ${scope} source canonical-${scope} file`));
		}
		const root = join(dir, "unreadable"), canonicalHome = join(root, "canonical"), legacyHome = join(root, "legacy"), canonical = join(canonicalHome, "runtime-guardrails.json");
		writeConfig(canonicalHome, "runtime-guardrails.json", { autonomousMode: true }); writeConfig(legacyHome, "runtime-guardrails.json", { autonomousMode: true, guardedCommands: { gitPush: "allow" } });
		const resolved = __testing.resolveRuntimeGuardrailsConfig(join(root, "project"), { shevanioPiConfigHome: canonicalHome, gentlePiConfigHome: legacyHome, readFile(path) { if (path === canonical) throw Object.assign(new Error("denied"), { code: "EACCES" }); return readFileSync(path, "utf8"); } });
		assert.deepEqual(resolved.config, { autonomousMode: false, guardedCommands: {} });
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test("canonical and legacy aliases to one existing file are read once without collision", () => {
	const dir = makeTmpDir(), cwd = join(dir, "project"), sharedHome = join(dir, "shared");
	try {
		const shared = join(sharedHome, "runtime-guardrails.json");
		writeConfig(sharedHome, "runtime-guardrails.json", { autonomousMode: true, guardedCommands: { gitPush: "allow" } });
		let reads = 0;
		const samePath = __testing.resolveRuntimeGuardrailsConfig(cwd, { shevanioPiConfigHome: sharedHome, gentlePiConfigHome: sharedHome, readFile(path) { if (path === shared) reads += 1; return readFileSync(path, "utf8"); } });
		assert.equal(reads, 1); assert.equal(samePath.global?.collision, undefined);
		if (process.platform !== "win32") {
			const canonicalHome = join(dir, "hardlink-canonical"), legacyHome = join(dir, "hardlink-legacy"), canonical = join(canonicalHome, "runtime-guardrails.json"), legacy = join(legacyHome, "runtime-guardrails.json");
			writeConfig(canonicalHome, "runtime-guardrails.json", { autonomousMode: true }); mkdirSync(legacyHome); linkSync(canonical, legacy); reads = 0;
			const sameInode = __testing.resolveRuntimeGuardrailsConfig(cwd, { shevanioPiConfigHome: canonicalHome, gentlePiConfigHome: legacyHome, readFile(path) { if (path === canonical || path === legacy) reads += 1; return readFileSync(path, "utf8"); } });
			assert.equal(reads, 1); assert.equal(sameInode.global?.collision, undefined);
		}
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test("physical-file deduplication never reuses bytes across global and project scopes", () => {
	const dir = makeTmpDir(), cwd = join(dir, "project"), canonicalHome = join(dir, "canonical"), legacyHome = join(dir, "legacy");
	const global = join(canonicalHome, "runtime-guardrails.json"), project = join(cwd, ".pi", "shevanio-pi", "runtime-guardrails.json"), reads: string[] = [];
	try {
		const resolved = __testing.resolveRuntimeGuardrailsConfig(cwd, {
			shevanioPiConfigHome: canonicalHome,
			gentlePiConfigHome: legacyHome,
			fileMetadata(path) { return path === global || path === project ? { identity: "raced-project-inode", regular: true } : undefined; },
			readFile(path) {
				reads.push(path);
				if (path === global) return '{"autonomousMode":true,"guardedCommands":{"gitPush":"allow"}}';
				if (path === project) return '{"autonomousMode":true,"guardedCommands":{"gitPush":"block"}}';
				throw Object.assign(new Error("missing"), { code: "ENOENT" });
			},
		});
		assert.deepEqual(reads.filter((path) => path === global || path === project), [global, project]);
		assert.equal(classifyGuardedCommand("git push origin main", resolved.config), "block");
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an existing non-regular guardrail target is malformed without being read", () => {
	const dir = makeTmpDir(), cwd = join(dir, "project"), canonicalHome = join(dir, "canonical"), target = join(canonicalHome, "runtime-guardrails.json");
	try {
		mkdirSync(target, { recursive: true });
		let targetReads = 0;
		const resolved = __testing.resolveRuntimeGuardrailsConfig(cwd, { shevanioPiConfigHome: canonicalHome, gentlePiConfigHome: join(dir, "legacy"), readFile(path) { if (path === target) targetReads += 1; return readFileSync(path, "utf8"); } });
		assert.equal(targetReads, 0);
		assert.deepEqual(resolved.config, { autonomousMode: false, guardedCommands: {} });
		assert.match(__testing.runtimeGuardrailDiagnostics(resolved).join("\n"), /canonical-global.*malformed or unreadable/);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// When autonomous mode is OFF nothing changes vs current behavior
// ---------------------------------------------------------------------------

test("classifyGuardedCommand: pi remove confirm when autonomousMode=false", () => {
	const result = classifyGuardedCommand("pi remove my-package", {
		autonomousMode: false,
		guardedCommands: { piRemove: "allow" },
	});
	assert.equal(result, "confirm");
});

test("classifyGuardedCommand: pi remove allowed when autonomousMode=true and piRemove=allow", () => {
	const result = classifyGuardedCommand("pi remove my-package", {
		autonomousMode: true,
		guardedCommands: { piRemove: "allow" },
	});
	assert.equal(result, "allow");
});

// ---------------------------------------------------------------------------
// Fix 1: git global flags bypass — git -C <dir> push / git --work-tree push
// ---------------------------------------------------------------------------

test("classifyGuardedCommand: git -C /repo push --force → block even with gitPush=allow", () => {
	const result = classifyGuardedCommand("git -C /repo push --force origin main", {
		autonomousMode: true,
		guardedCommands: { gitPush: "allow" },
	});
	assert.equal(result, "block");
});

test("classifyGuardedCommand: git --work-tree=/tmp push --force → block", () => {
	const result = classifyGuardedCommand("git --work-tree=/tmp push --force origin main", {
		autonomousMode: true,
		guardedCommands: { gitPush: "allow" },
	});
	assert.equal(result, "block");
});

test("classifyGuardedCommand: git -C /repo push -f → block", () => {
	const result = classifyGuardedCommand("git -C /repo push -f origin main", {
		autonomousMode: true,
		guardedCommands: { gitPush: "allow" },
	});
	assert.equal(result, "block");
});

test("classifyGuardedCommand: git -C /repo push origin feat → classified as gitPush (allow when configured)", () => {
	const result = classifyGuardedCommand("git -C /repo push origin feat", {
		autonomousMode: true,
		guardedCommands: { gitPush: "allow" },
	});
	assert.equal(result, "allow");
});

test("classifyGuardedCommand: git -C /repo push origin feat → confirm when autonomousMode=false", () => {
	const result = classifyGuardedCommand("git -C /repo push origin feat", {
		autonomousMode: false,
		guardedCommands: {},
	});
	assert.equal(result, "confirm");
});

// ---------------------------------------------------------------------------
// Fix 2: rm -rf $HOME was not blocked (dead regex branch)
// ---------------------------------------------------------------------------

test("classifyGuardedCommand: rm -rf $HOME → block", () => {
	const result = classifyGuardedCommand("rm -rf $HOME", {
		autonomousMode: true,
		guardedCommands: {},
	});
	assert.equal(result, "block");
});

test("classifyGuardedCommand: rm -rf $HOME/foo → block", () => {
	const result = classifyGuardedCommand("rm -rf $HOME/foo", {
		autonomousMode: true,
		guardedCommands: {},
	});
	assert.equal(result, "block");
});

// ---------------------------------------------------------------------------
// Fix 5a: gitBranchDeleteForce allow path is tested
// ---------------------------------------------------------------------------

test("classifyGuardedCommand: gitBranchDeleteForce=allow in autonomous mode → allow", () => {
	const result = classifyGuardedCommand("git branch -D old-feature", {
		autonomousMode: true,
		guardedCommands: { gitBranchDeleteForce: "allow" },
	});
	assert.equal(result, "allow");
});

// ---------------------------------------------------------------------------
// Fix 5b: AUTONOMOUS_DEFAULT_ACTIONS fallback — empty guardedCommands in autonomous mode
// ---------------------------------------------------------------------------

test("classifyGuardedCommand: autonomousMode=true, empty guardedCommands, gitPush defaults to allow", () => {
	const result = classifyGuardedCommand("git push origin main", {
		autonomousMode: true,
		guardedCommands: {},
	});
	assert.equal(result, "allow");
});

// ---------------------------------------------------------------------------
// Fix 5c: env var negatives — only "1" activates autonomous mode
// ---------------------------------------------------------------------------

test("loadRuntimeGuardrailsConfig: GENTLE_PI_AUTONOMOUS_MODE=0 does NOT activate autonomous mode", () => {
	const original = process.env.GENTLE_PI_AUTONOMOUS_MODE;
	process.env.GENTLE_PI_AUTONOMOUS_MODE = "0";
	const dir = makeTmpDir();
	try {
		const config = __testing.loadRuntimeGuardrailsConfig(dir, {
			gentlePiConfigHome: join(dir, "global-config"),
		});
		assert.equal(config.autonomousMode, false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
		if (original === undefined) delete process.env.GENTLE_PI_AUTONOMOUS_MODE;
		else process.env.GENTLE_PI_AUTONOMOUS_MODE = original;
	}
});

test("loadRuntimeGuardrailsConfig: GENTLE_PI_AUTONOMOUS_MODE=true does NOT activate autonomous mode", () => {
	const original = process.env.GENTLE_PI_AUTONOMOUS_MODE;
	process.env.GENTLE_PI_AUTONOMOUS_MODE = "true";
	const dir = makeTmpDir();
	try {
		const config = __testing.loadRuntimeGuardrailsConfig(dir, {
			gentlePiConfigHome: join(dir, "global-config"),
		});
		assert.equal(config.autonomousMode, false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
		if (original === undefined) delete process.env.GENTLE_PI_AUTONOMOUS_MODE;
		else process.env.GENTLE_PI_AUTONOMOUS_MODE = original;
	}
});

test("loadRuntimeGuardrailsConfig: GENTLE_PI_AUTONOMOUS_MODE='' does NOT activate autonomous mode", () => {
	const original = process.env.GENTLE_PI_AUTONOMOUS_MODE;
	process.env.GENTLE_PI_AUTONOMOUS_MODE = "";
	const dir = makeTmpDir();
	try {
		const config = __testing.loadRuntimeGuardrailsConfig(dir, {
			gentlePiConfigHome: join(dir, "global-config"),
		});
		assert.equal(config.autonomousMode, false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
		if (original === undefined) delete process.env.GENTLE_PI_AUTONOMOUS_MODE;
		else process.env.GENTLE_PI_AUTONOMOUS_MODE = original;
	}
});

// ---------------------------------------------------------------------------
// Fix 5d: JSON config autonomousMode strict === true check
// ---------------------------------------------------------------------------

test("loadRuntimeGuardrailsConfig: autonomousMode:1 (number) in JSON does NOT activate autonomous mode", () => {
	const dir = makeTmpDir();
	try {
		const globalConfigDir = join(dir, "global-config");
		writeConfig(globalConfigDir, "runtime-guardrails.json", {
			autonomousMode: 1,
			guardedCommands: {},
		});
		const config = __testing.loadRuntimeGuardrailsConfig(join(dir, "project"), {
			gentlePiConfigHome: globalConfigDir,
		});
		assert.equal(config.autonomousMode, false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('loadRuntimeGuardrailsConfig: autonomousMode:"true" (string) in JSON does NOT activate autonomous mode', () => {
	const dir = makeTmpDir();
	try {
		const globalConfigDir = join(dir, "global-config");
		writeConfig(globalConfigDir, "runtime-guardrails.json", {
			autonomousMode: "true",
			guardedCommands: {},
		});
		const config = __testing.loadRuntimeGuardrailsConfig(join(dir, "project"), {
			gentlePiConfigHome: globalConfigDir,
		});
		assert.equal(config.autonomousMode, false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("loadRuntimeGuardrailsConfig: autonomousMode:{} (object) in JSON does NOT activate autonomous mode", () => {
	const dir = makeTmpDir();
	try {
		const globalConfigDir = join(dir, "global-config");
		writeConfig(globalConfigDir, "runtime-guardrails.json", {
			autonomousMode: {},
			guardedCommands: {},
		});
		const config = __testing.loadRuntimeGuardrailsConfig(join(dir, "project"), {
			gentlePiConfigHome: globalConfigDir,
		});
		assert.equal(config.autonomousMode, false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
