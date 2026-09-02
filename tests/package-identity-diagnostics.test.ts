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
const managedAssetLabels: Record<string, readonly (readonly [canonical: string, stale: string])[]> = {
	"assets/agents/gentle-ai-worker.md": [["You are the package-owned implementation writer for Shevanio AI.", "You are the package-owned implementation writer for Gentle AI."]],
	"assets/agents/jd-fix-agent.md": [["You are the Judgment Day fix agent for Shevanio AI.", "You are the Judgment Day fix agent for Gentle AI."]],
	"assets/agents/jd-judge-a.md": [["You are Judgment Day judge A for Shevanio AI.", "You are Judgment Day judge A for Gentle AI."]],
	"assets/agents/jd-judge-b.md": [["You are Judgment Day judge B for Shevanio AI.", "You are Judgment Day judge B for Gentle AI."]],
	...Object.fromEntries(["apply", "archive", "design", "explore", "init", "onboard", "proposal", "research", "spec", "status", "sync", "tasks", "verify"].map((phase) => [`assets/agents/sdd-${phase}.md`, [[`You are the SDD ${phase} executor for Shevanio AI.`, `You are the SDD ${phase} executor for Gentle AI.`]]] as const)),
	...Object.fromEntries(["readability", "reliability", "resilience", "risk"].map((lens) => [`assets/agents/review-${lens}.md`, [["through the Shevanio Pi host relay", "through the gentle-pi host relay"]]] as const)),
	"assets/agents/sdd-apply.md": [["You are the SDD apply executor for Shevanio AI.", "You are the SDD apply executor for Gentle AI."], ["global Shevanio Pi strict-TDD support guidance", "global Gentle AI strict-TDD support guidance"]],
	"assets/agents/sdd-verify.md": [["You are the SDD verify executor for Shevanio AI.", "You are the SDD verify executor for Gentle AI."], ["global Shevanio Pi strict-TDD verification support guidance", "global Gentle AI strict-TDD verification support guidance"]],
	"assets/agents/sdd-spec.md": [["You are the SDD spec executor for Shevanio AI.", "You are the SDD spec executor for Gentle AI."], ["unsupported in Shevanio Pi until", "unsupported in gentle-pi until"]],
	"assets/support/sdd-status-contract.md": [["contract for Shevanio Pi SDD phases", "contract for Gentle Pi SDD phases"], ["use Shevanio Pi's local SDD status engine", "use Gentle Pi's local SDD status engine"]],
};

test("current package-owned prose uses the canonical shevanio-pi identity", () => {
	for (const [path, expected] of Object.entries(canonicalLabels)) {
		const content = source(path);
		for (const label of expected) assert.ok(content.includes(label), `${path} is missing ${JSON.stringify(label)}`);
		for (const label of stalePackageLabels) assert.equal(content.includes(label), false, `${path} retains ${JSON.stringify(label)}`);
	}
});

test("package-managed agent and support guidance uses ownership-safe identities", () => {
	for (const [path, replacements] of Object.entries(managedAssetLabels)) {
		const content = source(path);
		for (const [canonical, stale] of replacements) {
			assert.ok(content.includes(canonical), `${path} is missing ${JSON.stringify(canonical)}`);
			assert.equal(content.includes(stale), false, `${path} retains ${JSON.stringify(stale)}`);
		}
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
