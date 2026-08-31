import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = join(import.meta.dirname, "..");
const source = (path: string): string => readFileSync(join(root, path), "utf8");

const canonicalLabels: Record<string, readonly string[]> = {
	"lib/gentle-ai-binary.ts": ["Reinstall shevanio-pi"],
	"runtime/gentle-ai-binary.mjs": ["Reinstall shevanio-pi"],
	"lib/native-review-cli.ts": ["shevanio-pi does not implement"],
	"runtime/native-review-cli.mjs": ["shevanio-pi does not implement"],
	"lib/provider-contract-bundle.ts": ["shevanio-pi provider contract bundle verifier", "roles shevanio-pi supports", "this shevanio-pi build", "shevanio-pi supports major"],
	"scripts/check-provider-contract.mjs": ["shevanio-pi provider contract mirror has drifted", "shevanio-pi provider contract mirror check passed"],
	"scripts/install-gentle-ai.mjs": ["until shevanio-pi is reinstalled", "shevanio-pi could not install"],
	"README.md": ["field shevanio-pi lacks"],
	"docs/native-authority-architecture.md": ["shevanio-pi negotiates `/v2` only"],
	"docs/skill-style-guide.md": ["`shevanio-pi` projects"],
	"openspec/config.yaml": ["shevanio-pi is a Node.js 24/TypeScript ESM Pi extension package"],
	"prompts/skill-creation.md": ["part of `shevanio-pi`"],
	"skills/skill-creator/SKILL.md": ["packaged `shevanio-pi` skill"],
};
const stalePackageLabels = ["Reinstall gentle-pi", "gentle-pi does not implement", "gentle-pi provider contract bundle verifier", "roles gentle-pi supports", "this gentle-pi build", "gentle-pi supports major", "gentle-pi provider contract mirror", "until gentle-pi is reinstalled", "gentle-pi could not install", "field gentle-pi lacks", "gentle-pi negotiates", "`gentle-pi` projects", "gentle-pi is a Node.js", "part of `gentle-pi`", "packaged `gentle-pi` skill"];

test("current package-owned prose uses the canonical shevanio-pi identity", () => {
	for (const [path, expected] of Object.entries(canonicalLabels)) {
		const content = source(path);
		for (const label of expected) assert.ok(content.includes(label), `${path} is missing ${JSON.stringify(label)}`);
		for (const label of stalePackageLabels) assert.equal(content.includes(label), false, `${path} retains ${JSON.stringify(label)}`);
	}
});

test("provider and compatibility identities remain frozen", () => {
	const frozen: Record<string, readonly string[]> = {
		"README.md": ["`GENTLE_PI_*`", "`gentle-pi.*`", "`gentle-pi` is a transitional compatibility package"],
		"lib/gentle-ai-binary.ts": ['Gentle AI v${GENTLE_AI_VERSION}', "GENTLE_PI_SKIP_GENTLE_AI_INSTALL=1", '"gentle-pi.dev-binary/v1"'],
		"lib/native-review-cli.ts": ["gentle-pi#311 P4", '"gentle-ai"'],
		"lib/provider-contract-bundle.ts": ['"gentle-ai.review-provider-contract-bundle/v1"', '"gentle-pi.provider-contract-roles-baseline/v1"'],
		"scripts/gentle-ai-installer.mjs": ['INSTALLER_VERSION = "2.4.0"', '"user-agent": "gentle-pi-installer"'],
	};
	for (const [path, expected] of Object.entries(frozen)) {
		const content = source(path);
		for (const identity of expected) assert.ok(content.includes(identity), `${path} changed frozen identity ${JSON.stringify(identity)}`);
	}
});
