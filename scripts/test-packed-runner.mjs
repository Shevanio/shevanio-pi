#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "shevanio-pi-packed-runner-"));
const packDirectory = join(temporary, "pack");
const installDirectory = join(temporary, "install");

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
	const capabilities = JSON.parse(readFileSync(join(packageRoot, "contracts", "review-integration", "v2", "fixtures", "capabilities.fixture.json"), "utf8"));
	// Import the PACKED consumer's own decoder and exercise it against the bundled,
	// byte-pinned capabilities fixture. This proves canonical package discovery and
	// validates the whole compatibility envelope without installing or launching a
	// provider binary; provider/runtime E2E belongs to the separate contract lanes.
	const { decodeReviewCapabilitiesV2 } = await import(pathToFileURL(join(packageRoot, "runtime", "review-integration-v2.mjs")).href);
	const decoded = decodeReviewCapabilitiesV2(capabilities, capabilities.executable.sha256);
	if (decoded.contract !== "gentle-ai.review-integration/v2" || decoded.packageVersion !== capabilities.package.version) throw new Error("packed shevanio-pi contract fixture is incompatible");
	const packageManifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
	process.stdout.write(`packed package E2E passed (shevanio-pi ${packageManifest.version ?? "unknown"}; bundled Gentle AI contract fixture ${decoded.packageVersion ?? "unknown"}; provider install skipped)\n`);
} finally {
	rmSync(temporary, { recursive: true, force: true });
}
