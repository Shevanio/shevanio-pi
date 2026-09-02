import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SddArtifactStore } from "./sdd-status.ts";

export type { SddArtifactStore };

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ASSETS_DIR = join(PACKAGE_ROOT, "assets");
const MANAGED_ASSETS_MANIFEST = "managed-assets.json";
const MANAGED_ASSETS_SCHEMA_VERSION = 1;
const LEGACY_MANAGED_ASSET_MANIFESTS = Object.freeze([
	{ path: join(ASSETS_DIR, "migrations", "managed-assets-v0.10.7.json"), version: "0.10.7" },
	{ path: join(ASSETS_DIR, "migrations", "managed-assets-v0.13.json"), version: "0.13.0" },
	{ path: join(ASSETS_DIR, "migrations", "managed-assets-v0.14.json"), version: "0.14.0" },
]);

function gentlePiAgentHome(): string {
	return process.env.GENTLE_PI_AGENT_HOME ?? join(homedir(), ".pi", "agent");
}

export type SddExecutionMode = "interactive" | "auto";
export type SddDeliveryStrategy =
	| "ask-on-risk"
	| "auto-chain"
	| "single-pr"
	| "exception-ok";
/** @deprecated Use SddDeliveryStrategy; legacy values normalize at persistence boundaries. */
export type SddChainedPrStrategy =
	| SddDeliveryStrategy
	| "auto-forecast"
	| "ask-always"
	| "single-pr-default"
	| "force-chained";
export type SddPreflightField = "executionMode" | "artifactStore" | "chainedPrStrategy" | "reviewBudgetLines";
export const SDD_PREFLIGHT_FIELDS = ["executionMode", "artifactStore", "chainedPrStrategy", "reviewBudgetLines"] as const;

export interface SddPreflightPreferences {
	executionMode: SddExecutionMode;
	artifactStore: SddArtifactStore;
	/** Runtime values are canonical; legacy assignments normalize at persistence/render boundaries. */
	chainedPrStrategy: SddChainedPrStrategy;
	reviewBudgetLines: number;
	engramAvailable: boolean;
	prompted: boolean;
	sizeExceptionAccepted?: true;
	preferenceSource?: "canonical-project" | "legacy-project" | "built-in-defaults";
	preferencePath?: string;
	diagnostics?: readonly { level: "info" | "warning"; message: string }[];
}

export interface SddPreflightResolutionOptions {
	persisted?: Partial<SddPreflightPreferences>;
	promptFields?: readonly SddPreflightField[];
	acceptSizeException?: true;
	explicitWrite?: true;
}

interface SddPreflightCallbacks {
	pi: ExtensionAPI;
	installAssets?: (cwd: string) =>
		| {
				agents: number;
				chains: number;
				support: number;
				skipped: number;
		  }
		| Promise<{
				agents: number;
				chains: number;
				support: number;
				skipped: number;
		  }>;
	applyModelConfig?: (
		cwd: string,
	) =>
		| { updated: number; skipped: number; invalidPath?: string }
		| Promise<{ updated: number; skipped: number; invalidPath?: string }>;
}

interface ManagedAssetsManifest {
	schemaVersion: number;
	assets: Record<string, string>;
}

interface LegacyManagedAssetsManifest extends ManagedAssetsManifest {
	packageVersion: string;
}

export const DEFAULT_SDD_PREFLIGHT: SddPreflightPreferences = Object.freeze({
	executionMode: "auto",
	artifactStore: "openspec",
	chainedPrStrategy: "ask-on-risk",
	reviewBudgetLines: 400,
	engramAvailable: false,
	prompted: false,
});

const sddPreflightBySession = new Map<string, SddPreflightPreferences>();
const sddPreflightInFlight = new Map<string, Promise<SddPreflightPreferences>>();
const sddPreflightFallbackSessions = new WeakMap<object, string>();
let sddPreflightFallbackSequence = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSddExecutionMode(value: unknown): value is SddExecutionMode {
	return value === "interactive" || value === "auto";
}

function isSddArtifactStore(value: unknown): value is SddArtifactStore {
	return value === "openspec" || value === "engram" || value === "hybrid" || value === "none";
}

// normalizeSddArtifactStore accepts the canonical names and the legacy "both"
// spelling of the dual-store mode. Operator preflight files written before the
// rename carry "both" on disk; rejecting it would silently drop the operator's
// choice back to the default, so it maps forward instead.
export function normalizeSddArtifactStore(value: unknown): SddArtifactStore | undefined {
	if (value === "both") return "hybrid";
	return isSddArtifactStore(value) ? value : undefined;
}

function normalizeReviewBudgetValue(value: unknown): number | undefined {
	const parsed = typeof value === "number"
		? value
		: typeof value === "string"
			? Number.parseInt(value.trim(), 10)
			: Number.NaN;
	return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

function normalizeSddStrategySelection(
	value: unknown,
	allowExceptionOk: boolean,
): SddDeliveryStrategy | undefined {
	if (value === "exception-ok") return allowExceptionOk ? value : undefined;
	if (value === "auto-forecast" || value === "ask-always") return "ask-on-risk";
	if (value === "single-pr-default") return "single-pr";
	if (value === "force-chained") return "auto-chain";
	return value === "ask-on-risk" || value === "auto-chain" || value === "single-pr"
		? value
		: undefined;
}

export function normalizeSddChainedPrStrategy(
	value: unknown,
	allowExceptionOk = false,
): SddDeliveryStrategy {
	return normalizeSddStrategySelection(value, allowExceptionOk) ?? "ask-on-risk";
}

function normalizedSelections(
	value: Partial<Record<SddPreflightField, unknown>> | undefined,
	engramAvailable: boolean,
	allowExceptionOk: boolean,
): Partial<Record<SddPreflightField, unknown>> {
	if (!value) return {};
	const result: Partial<Record<SddPreflightField, unknown>> = {};
	if (isSddExecutionMode(value.executionMode)) result.executionMode = value.executionMode;
	const artifactStore = normalizeSddArtifactStore(value.artifactStore);
	if (artifactStore !== undefined && (engramAvailable || artifactStore === "openspec" || artifactStore === "none")) result.artifactStore = artifactStore;
	const strategy = normalizeSddStrategySelection(value.chainedPrStrategy, allowExceptionOk);
	if (strategy) result.chainedPrStrategy = strategy;
	const reviewBudgetLines = normalizeReviewBudgetValue(value.reviewBudgetLines);
	if (reviewBudgetLines !== undefined) result.reviewBudgetLines = reviewBudgetLines;
	return result;
}

function emptyManagedAssetsManifest(): ManagedAssetsManifest {
	return {
		schemaVersion: MANAGED_ASSETS_SCHEMA_VERSION,
		assets: {},
	};
}

function readManagedAssetsManifest(path: string): ManagedAssetsManifest {
	if (!existsSync(path)) return emptyManagedAssetsManifest();
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (
			!isRecord(parsed) ||
			parsed.schemaVersion !== MANAGED_ASSETS_SCHEMA_VERSION ||
			!isRecord(parsed.assets)
		) {
			return emptyManagedAssetsManifest();
		}
		const assets = Object.fromEntries(
			Object.entries(parsed.assets).filter(
				(entry): entry is [string, string] => typeof entry[1] === "string",
			),
		);
		return { schemaVersion: MANAGED_ASSETS_SCHEMA_VERSION, assets };
	} catch {
		return emptyManagedAssetsManifest();
	}
}

function managedAssetHash(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

function readLegacyManagedAssets(
	path: string,
	version: string,
): LegacyManagedAssetsManifest | undefined {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (
			!isRecord(parsed) ||
			parsed.schemaVersion !== MANAGED_ASSETS_SCHEMA_VERSION ||
			parsed.packageVersion !== version ||
			!isRecord(parsed.assets)
		) {
			return undefined;
		}
		const assets = Object.fromEntries(
			Object.entries(parsed.assets).filter(
				(entry): entry is [string, string] => typeof entry[1] === "string",
			),
		);
		return {
			schemaVersion: MANAGED_ASSETS_SCHEMA_VERSION,
			packageVersion: version,
			assets,
		};
	} catch {
		return undefined;
	}
}

function readLegacyManagedAssetHashes(): Record<string, readonly string[]> {
	const hashes: Record<string, string[]> = {};
	for (const manifest of LEGACY_MANAGED_ASSET_MANIFESTS) {
		const assets = readLegacyManagedAssets(manifest.path, manifest.version)?.assets;
		if (!assets) continue;
		for (const [ownershipKey, hash] of Object.entries(assets)) {
			const known = hashes[ownershipKey] ?? [];
			if (!known.includes(hash)) known.push(hash);
			hashes[ownershipKey] = known;
		}
	}
	return hashes;
}

function updateAgentFrontmatterRouting(
	content: string,
	routingLines: readonly string[],
): string {
	if (!content.startsWith("---\n")) return content;
	const endIndex = content.indexOf("\n---", 4);
	if (endIndex === -1) return content;
	const frontmatter = content.slice(4, endIndex);
	const body = content.slice(endIndex);
	const lines = frontmatter
		.split("\n")
		.filter((line) => !/^(?:model|thinking):/.test(line));
	if (routingLines.length > 0) {
		const descriptionIndex = lines.findIndex((line) =>
			line.startsWith("description:"),
		);
		const insertIndex =
			descriptionIndex >= 0 ? descriptionIndex + 1 : Math.min(1, lines.length);
		lines.splice(insertIndex, 0, ...routingLines);
	}
	return `---\n${lines.join("\n")}${body}`;
}

function legacyComparableAssetContent(
	ownershipKey: string,
	content: string,
): string {
	return ownershipKey.startsWith("agents/")
		? updateAgentFrontmatterRouting(content, [])
		: content;
}

function migrateLegacyAssetContent(
	ownershipKey: string,
	installedContent: string,
	packagedContent: string,
): string {
	if (!ownershipKey.startsWith("agents/")) return packagedContent;
	if (!installedContent.startsWith("---\n")) return packagedContent;
	const endIndex = installedContent.indexOf("\n---", 4);
	if (endIndex === -1) return packagedContent;
	const routingLines = installedContent
		.slice(4, endIndex)
		.split("\n")
		.filter((line) => /^(?:model|thinking):/.test(line));
	return updateAgentFrontmatterRouting(packagedContent, routingLines);
}

export function updatePackageManagedSddAgentOwnership(
	installedPath: string,
	previousContent: string,
	nextContent: string,
): boolean {
	const agentHome = gentlePiAgentHome();
	const relativePath = relative(join(agentHome, "agents"), installedPath);
	if (
		relativePath.length === 0 ||
		relativePath === ".." ||
		relativePath.startsWith(`..${sep}`) ||
		isAbsolute(relativePath)
	) {
		return false;
	}
	const ownershipKey = `agents/${relativePath.split(sep).join("/")}`;
	const manifestPath = join(agentHome, "gentle-ai", MANAGED_ASSETS_MANIFEST);
	const manifest = readManagedAssetsManifest(manifestPath);
	if (manifest.assets[ownershipKey] !== managedAssetHash(previousContent)) {
		return false;
	}
	try {
		if (readFileSync(installedPath, "utf8") !== nextContent) return false;
		manifest.assets[ownershipKey] = managedAssetHash(nextContent);
		writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
		return true;
	} catch {
		return false;
	}
}

export function isPackageManagedSddAsset(
	installedPath: string,
	ownershipKey: string,
): boolean {
	const manifest = readManagedAssetsManifest(
		join(gentlePiAgentHome(), "gentle-ai", MANAGED_ASSETS_MANIFEST),
	);
	const expectedHash = manifest.assets[ownershipKey];
	if (expectedHash === undefined || !existsSync(installedPath)) return false;
	try {
		return (
			managedAssetHash(readFileSync(installedPath, "utf8")) ===
			expectedHash
		);
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------
// Project preference authority — isolated from managed assets and global config
// ---------------------------------------------------------------------------

export function sddPreflightDiskPath(cwd: string): string {
	return resolve(cwd, ".pi", "shevanio-pi", "sdd-preflight.json");
}

export function legacySddPreflightDiskPath(cwd: string): string {
	return resolve(cwd, ".pi", "gentle-ai", "sdd-preflight.json");
}

function durablePreferences(value: Record<string, unknown>, legacy: boolean): SddPreflightPreferences | undefined {
	const artifactStore = legacy ? normalizeSddArtifactStore(value.artifactStore) : isSddArtifactStore(value.artifactStore) ? value.artifactStore : undefined;
	const strategy = legacy ? normalizeSddStrategySelection(value.chainedPrStrategy, false) : value.chainedPrStrategy === "ask-on-risk" || value.chainedPrStrategy === "auto-chain" || value.chainedPrStrategy === "single-pr" ? value.chainedPrStrategy : undefined;
	if (!isSddExecutionMode(value.executionMode) || artifactStore === undefined || strategy === undefined || !Number.isSafeInteger(value.reviewBudgetLines) || (value.reviewBudgetLines as number) <= 0) return undefined;
	return { executionMode: value.executionMode, artifactStore, chainedPrStrategy: strategy, reviewBudgetLines: value.reviewBudgetLines as number, engramAvailable: false, prompted: false };
}

function decodeSddPreflight(value: unknown, legacy: boolean): SddPreflightPreferences | undefined {
	if (!isRecord(value)) return undefined;
	if (value.schema !== undefined || !legacy) {
		if (value.schema !== "shevanio-pi.sdd-preflight/v1" || Object.keys(value).sort().join("|") !== "artifactStore|chainedPrStrategy|executionMode|reviewBudgetLines|schema") return undefined;
		return durablePreferences(value, false);
	}
	if (!["executionMode", "artifactStore", "chainedPrStrategy", "reviewBudgetLines", "engramAvailable", "prompted"].every((key) => key in value) || typeof value.engramAvailable !== "boolean" || typeof value.prompted !== "boolean") return undefined;
	return durablePreferences(value, true);
}

function preferencePathIdentity(path: string): string {
	let identity: string;
	try { identity = realpathSync(path); } catch { identity = resolve(path); }
	return process.platform === "win32" ? identity.toLowerCase() : identity;
}

function withPreferenceSource(prefs: SddPreflightPreferences, preferenceSource: NonNullable<SddPreflightPreferences["preferenceSource"]>, preferencePath?: string, diagnostics: NonNullable<SddPreflightPreferences["diagnostics"]> = []): SddPreflightPreferences {
	return { ...prefs, preferenceSource, ...(preferencePath === undefined ? {} : { preferencePath }), ...(diagnostics.length === 0 ? {} : { diagnostics }) };
}

function readPreference(path: string, legacy: boolean): SddPreflightPreferences | undefined {
	try { return decodeSddPreflight(JSON.parse(readFileSync(path, "utf8")), legacy); } catch { return undefined; }
}

export function readSddPreflightFromDisk(cwd: string): SddPreflightPreferences | undefined {
	const canonicalPath = sddPreflightDiskPath(cwd), legacyPath = legacySddPreflightDiskPath(cwd);
	if (existsSync(canonicalPath)) {
		const canonical = readPreference(canonicalPath, false);
		if (!canonical) return withPreferenceSource(DEFAULT_SDD_PREFLIGHT, "canonical-project", canonicalPath, [{ level: "warning", message: `Canonical project preference at ${canonicalPath} is unreadable or invalid; using built-in durable defaults without legacy fallback.` }]);
		const diagnostics: NonNullable<SddPreflightPreferences["diagnostics"]> = [];
		if (existsSync(legacyPath)) {
			if (preferencePathIdentity(canonicalPath) === preferencePathIdentity(legacyPath)) diagnostics.push({ level: "info", message: `Canonical project preference ${canonicalPath} and legacy project preference ${legacyPath} resolve to the same path.` });
			else {
				const legacy = readPreference(legacyPath, true);
				if (legacy) diagnostics.push({ level: JSON.stringify({ ...canonical, engramAvailable: false, prompted: false }) === JSON.stringify({ ...legacy, engramAvailable: false, prompted: false }) ? "info" : "warning", message: `Canonical project preference ${canonicalPath} and legacy project preference ${legacyPath} ${JSON.stringify({ ...canonical, engramAvailable: false, prompted: false }) === JSON.stringify({ ...legacy, engramAvailable: false, prompted: false }) ? "normalize to equal durable choices" : "conflict; canonical wins"}.` });
			}
		}
		return withPreferenceSource(canonical, "canonical-project", canonicalPath, diagnostics);
	}
	if (!existsSync(legacyPath)) return undefined;
	const legacy = readPreference(legacyPath, true);
	return legacy
		? withPreferenceSource(legacy, "legacy-project", legacyPath)
		: withPreferenceSource(DEFAULT_SDD_PREFLIGHT, "legacy-project", legacyPath, [{ level: "warning", message: `Legacy project preference at ${legacyPath} is unreadable or invalid; using built-in durable defaults without rewriting it.` }]);
}

export function writeSddPreflightToDisk(cwd: string, prefs: SddPreflightPreferences): { status: "created" | "updated" | "unchanged" | "failed"; path: string; error?: string } {
	const path = sddPreflightDiskPath(cwd), existed = existsSync(path);
	const document = { schema: "shevanio-pi.sdd-preflight/v1", executionMode: isSddExecutionMode(prefs.executionMode) ? prefs.executionMode : DEFAULT_SDD_PREFLIGHT.executionMode, artifactStore: normalizeSddArtifactStore(prefs.artifactStore) ?? DEFAULT_SDD_PREFLIGHT.artifactStore, chainedPrStrategy: normalizeSddChainedPrStrategy(prefs.chainedPrStrategy), reviewBudgetLines: normalizeReviewBudgetValue(prefs.reviewBudgetLines) ?? DEFAULT_SDD_PREFLIGHT.reviewBudgetLines };
	const bytes = `${JSON.stringify(document, null, 2)}\n`;
	try {
		if (existed && readFileSync(path, "utf8") === bytes) return { status: "unchanged", path };
		mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes);
		return { status: existed ? "updated" : "created", path };
	} catch (error) { return { status: "failed", path, error: error instanceof Error ? error.message : String(error) }; }
}

function copyDirectoryFiles(
	sourceDir: string,
	targetDir: string,
	ownershipPrefix: string,
	force: boolean,
	manifest: ManagedAssetsManifest,
	legacyAssetHashes: (() => Readonly<Record<string, readonly string[]>>) | undefined,
): { copied: number; skipped: number } {
	if (!existsSync(sourceDir)) return { copied: 0, skipped: 0 };
	mkdirSync(targetDir, { recursive: true });
	let copied = 0;
	let skipped = 0;
	for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
		const sourcePath = join(sourceDir, entry.name);
		const targetPath = join(targetDir, entry.name);
		const ownershipKey = `${ownershipPrefix}/${entry.name}`;
		if (entry.isDirectory()) {
			const child = copyDirectoryFiles(
				sourcePath,
				targetPath,
				ownershipKey,
				force,
				manifest,
				legacyAssetHashes,
			);
			copied += child.copied;
			skipped += child.skipped;
			continue;
		}
		if (!entry.isFile()) continue;
		const source = readFileSync(sourcePath, "utf8");
		let nextSource = source;
		if (existsSync(targetPath)) {
			if (!force) {
				skipped += 1;
				continue;
			}
			const managedHash = manifest.assets[ownershipKey];
			let installedContent: string | undefined;
			try {
				installedContent = readFileSync(targetPath, "utf8");
			} catch {
				installedContent = undefined;
			}
			const installedHash = installedContent === undefined
				? undefined
				: managedAssetHash(installedContent);
			if (managedHash === undefined) {
				const legacyHashes = legacyAssetHashes?.()[ownershipKey];
				const comparableLegacyHash = installedContent === undefined
					? undefined
					: managedAssetHash(
							legacyComparableAssetContent(ownershipKey, installedContent),
						);
				if (
					legacyHashes === undefined ||
					comparableLegacyHash === undefined ||
					!legacyHashes.includes(comparableLegacyHash)
				) {
					delete manifest.assets[ownershipKey];
					skipped += 1;
					continue;
				}
				nextSource = migrateLegacyAssetContent(
					ownershipKey,
					installedContent,
					source,
				);
			} else if (installedHash !== managedHash) {
				delete manifest.assets[ownershipKey];
				skipped += 1;
				continue;
			}
		}
		writeFileSync(targetPath, nextSource);
		manifest.assets[ownershipKey] = managedAssetHash(nextSource);
		copied += 1;
	}
	return { copied, skipped };
}

// Assets retired by gentle-pi#311 P5: the Pi-owned adversarial review actors.
// The refuter and validator verdicts now execute through Go-owned pi
// processes via provider-rendered self-contained vectors, so these agent
// definitions have no runtime consumer. The migration manifests under
// assets/migrations are append-only legacy-hash HISTORY (adoption evidence
// for force-installs) with no removal semantics, so history stays untouched
// and retirement happens here: an installed copy is deleted only when its
// content hash proves package ownership (current manifest or legacy
// history); user-modified copies are left in place and only lose managed
// ownership.
const RETIRED_MANAGED_ASSETS = Object.freeze([
	"agents/review-refuter.md",
	"agents/review-validator.md",
]);

function removeRetiredManagedAssets(
	agentHome: string,
	manifest: ManagedAssetsManifest,
): void {
	let legacyHashes: Record<string, readonly string[]> | undefined;
	for (const ownershipKey of RETIRED_MANAGED_ASSETS) {
		const installedPath = join(agentHome, ...ownershipKey.split("/"));
		if (!existsSync(installedPath)) {
			delete manifest.assets[ownershipKey];
			continue;
		}
		let installedContent: string | undefined;
		try {
			installedContent = readFileSync(installedPath, "utf8");
		} catch {
			installedContent = undefined;
		}
		if (installedContent === undefined) continue;
		const installedHash = managedAssetHash(installedContent);
		const managed = manifest.assets[ownershipKey] === installedHash;
		const legacy = (legacyHashes ??= readLegacyManagedAssetHashes())[ownershipKey]?.includes(
			managedAssetHash(legacyComparableAssetContent(ownershipKey, installedContent)),
		) === true;
		if (managed || legacy) {
			try {
				rmSync(installedPath);
			} catch {
				continue;
			}
		}
		// Managed copies are gone; user-modified copies stay but stop being
		// package-managed either way.
		delete manifest.assets[ownershipKey];
	}
}

export function installSddAssets(
	_cwd: string,
	force: boolean,
): { agents: number; chains: number; support: number; skipped: number } {
	const agentHome = gentlePiAgentHome();
	const manifestPath = join(agentHome, "gentle-ai", MANAGED_ASSETS_MANIFEST);
	let legacyAssetHashes: (() => Readonly<Record<string, readonly string[]>>) | undefined;
	if (force) {
		let cachedLegacyAssetHashes: Record<string, readonly string[]> | undefined;
		legacyAssetHashes = () =>
			(cachedLegacyAssetHashes ??= readLegacyManagedAssetHashes());
	}
	const manifest = readManagedAssetsManifest(manifestPath);
	removeRetiredManagedAssets(agentHome, manifest);
	const agents = copyDirectoryFiles(
		join(ASSETS_DIR, "agents"),
		join(agentHome, "agents"),
		"agents",
		force,
		manifest,
		legacyAssetHashes,
	);
	const chains = copyDirectoryFiles(
		join(ASSETS_DIR, "chains"),
		join(agentHome, "chains"),
		"chains",
		force,
		manifest,
		legacyAssetHashes,
	);
	const support = copyDirectoryFiles(
		join(ASSETS_DIR, "support"),
		join(agentHome, "gentle-ai", "support"),
		"gentle-ai/support",
		force,
		manifest,
		legacyAssetHashes,
	);
	mkdirSync(dirname(manifestPath), { recursive: true });
	writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
	return {
		agents: agents.copied,
		chains: chains.copied,
		support: support.copied,
		skipped: agents.skipped + chains.skipped + support.skipped,
	};
}

export function isSddPreflightTrigger(text: string): boolean {
	const trimmed = text.trim();
	if (/^\/sdd(?:[-:][^\s]*)?(?:\s|$)/i.test(trimmed)) return true;
	if (/[?？]\s*$/.test(trimmed)) return false;
	if (
		/\b(?:don't|do\s+not|not\s+use|never\s+use|without\s+using|sin\s+usar|no\s+(?:quiero|queremos|vamos\s+a)?\s*usar)\s+sdd\b/i.test(
			trimmed,
		)
	) {
		return false;
	}
	return [
		/^(?:please\s+)?(?:use|run|start)\s+(?:the\s+|an?\s+)?sdd(?:\s+(?:flow|process|workflow|plan))?\b/i,
		/^(?:please\s+)?(?:do|handle|implement)\b.+\b(?:with|using)\s+(?:the\s+|an?\s+)?sdd\b/i,
		/^(?:por\s+favor[\s,]+)?(?:vamos|vayamos)\s+con\s+(?:el\s+)?sdd\b/i,
		/^(?:por\s+favor[\s,]+)?(?:usa|usá|usemos|corre|corré|arranca|arrancá|inicia|iniciá|empeza|empezá)\s+(?:el\s+)?sdd\b/i,
		/^(?:por\s+favor[\s,]+)?(?:hacelo|hazlo|hacerlo)\s+(?:con|usando)\s+(?:el\s+)?sdd\b/i,
	].some((pattern) => pattern.test(trimmed));
}

export function sddPreflightSessionKey(ctx: ExtensionContext): string {
	const manager = (ctx as unknown as { sessionManager?: unknown }).sessionManager;
	let sessionIdentity: string | undefined;
	try { if (isRecord(manager)) {
		const getSessionFile = manager.getSessionFile;
		if (typeof getSessionFile === "function") {
			const value = getSessionFile.call(manager);
			if (typeof value === "string" && value.length > 0) sessionIdentity = `file:${preferencePathIdentity(value)}`;
		}
		const getSessionId = manager.getSessionId;
		if (sessionIdentity === undefined && typeof getSessionId === "function") {
			const value = getSessionId.call(manager);
			if (typeof value === "string" && value.length > 0) sessionIdentity = `id:${value}`;
		}
	} } catch { /* Fall through to a registration-local identity. */ }
	if (sessionIdentity === undefined) {
		const owner = isRecord(manager) ? manager : ctx as object;
		sessionIdentity = sddPreflightFallbackSessions.get(owner) ?? `fallback:${++sddPreflightFallbackSequence}`;
		sddPreflightFallbackSessions.set(owner, sessionIdentity);
	}
	return `${preferencePathIdentity(sddPreflightDiskPath(ctx.cwd))}\0${sessionIdentity}`;
}

function hasWritableEngramTool(pi: ExtensionAPI): boolean {
	try {
		const getActiveTools = (pi as unknown as { getActiveTools?: () => unknown[] })
			.getActiveTools;
		if (typeof getActiveTools !== "function") return false;
		const tools = getActiveTools.call(pi);
		return tools.some((tool) => {
			const name =
				typeof tool === "string"
					? tool
					: isRecord(tool) && typeof tool.name === "string"
						? tool.name
						: "";
			return name === "mem_save" || name.endsWith(".mem_save");
		});
	} catch {
		return false;
	}
}

export async function collectSddPreflightPreferences(
	ctx: ExtensionContext,
	engramAvailable: boolean,
	options: SddPreflightResolutionOptions = {},
): Promise<SddPreflightPreferences> {
	const allowExceptionOk = options.acceptSizeException === true;
	const persisted = normalizedSelections(options.persisted, engramAvailable, allowExceptionOk);
	const resolved: Partial<Record<SddPreflightField, unknown>> = { ...persisted };
	let prompted = false;
	let sizeExceptionAccepted = allowExceptionOk && persisted.chainedPrStrategy === "exception-ok";
	const promptFields = new Set(options.promptFields ?? []);

	const usePromptedValue = (
		field: SddPreflightField,
		value: unknown,
	): void => {
		const candidate = normalizedSelections({ [field]: value }, engramAvailable, allowExceptionOk);
		if (candidate[field] !== undefined) {
			resolved[field] = candidate[field];
			if (field === "chainedPrStrategy" && candidate[field] === "exception-ok") sizeExceptionAccepted = true;
			prompted = true;
		}
	};

	const promptField = async (
		field: SddPreflightField,
		read: () => Promise<unknown>,
		enabled = true,
	): Promise<void> => {
		if (ctx.hasUI && enabled && promptFields.has(field)) {
			usePromptedValue(field, await read());
		}
	};
	const artifactOptions = engramAvailable ? ["openspec", "engram", "hybrid"] : ["openspec"];
	await promptField("executionMode", () => ctx.ui.select("SDD execution mode", ["interactive", "auto"]));
	await promptField("artifactStore", () => ctx.ui.select("SDD artifact store", artifactOptions), artifactOptions.length > 1);
	await promptField("chainedPrStrategy", () => ctx.ui.select("SDD delivery strategy", ["ask-on-risk", "auto-chain", "single-pr"]));
	await promptField("reviewBudgetLines", () => ctx.ui.input("SDD review budget lines", String(DEFAULT_SDD_PREFLIGHT.reviewBudgetLines)));

	const resolvedValue = <T>(field: SddPreflightField, fallback: T): T =>
		(resolved[field] as T | undefined) ?? fallback;
	return {
		executionMode: resolvedValue("executionMode", DEFAULT_SDD_PREFLIGHT.executionMode),
		artifactStore: resolvedValue("artifactStore", DEFAULT_SDD_PREFLIGHT.artifactStore),
		chainedPrStrategy: resolvedValue("chainedPrStrategy", DEFAULT_SDD_PREFLIGHT.chainedPrStrategy),
		reviewBudgetLines: resolvedValue("reviewBudgetLines", DEFAULT_SDD_PREFLIGHT.reviewBudgetLines),
		engramAvailable,
		prompted,
		...(sizeExceptionAccepted ? { sizeExceptionAccepted: true as const } : {}),
		...(options.persisted?.preferenceSource === undefined ? {} : { preferenceSource: options.persisted.preferenceSource, ...(options.persisted.preferencePath === undefined ? {} : { preferencePath: options.persisted.preferencePath }), ...(options.persisted.diagnostics === undefined ? {} : { diagnostics: options.persisted.diagnostics }) }),
	};
}

export function renderSddPreflightPrompt(prefs: SddPreflightPreferences): string {
	const deliveryStrategy = normalizeSddChainedPrStrategy(
		prefs.chainedPrStrategy,
		prefs.sizeExceptionAccepted === true,
	);
	const sourceLine = prefs.prompted
		? "These SDD preferences are explicit current-session choices. Reuse them unless the user explicitly changes them."
		: "These SDD preferences are canonical defaults or persisted choices. Treat them as authoritative; do not revisit dependent decisions unless a genuine human-control gate is reached.";
	const interactiveRules =
		prefs.executionMode === "interactive"
			? [
					"- Interactive phase gate: complete only the current SDD phase. Do not start the next SDD phase unless the current user turn explicitly approves that next phase.",
					"- In interactive mode, words like `continue`, `dale`, or `go on` approve only the immediate next phase, not all remaining phases.",
					"- Before writing an SDD proposal in interactive mode, offer the user a proposal question round to improve the PRD/proposal by uncovering business rules, implications, impact, edge cases, product tradeoffs, and decision gaps. Prefer 3–5 concrete product questions per round, then summarize assumptions and ask whether the user wants corrections or a second question round. Do not ask about test commands, PR shape, changed-line budget, or other harness mechanics at proposal time unless the user explicitly asks to discuss delivery.",
				]
			: [
					"- Auto mode: phases may run back-to-back only because the user chose speed and trusts the flow.",
				];
	return [
		"## SDD Session Preflight",
		sourceLine,
		`- Execution mode: ${prefs.executionMode}`,
		`- Artifact store: ${prefs.artifactStore}${prefs.engramAvailable ? "" : " (Engram unavailable in this session)"}`,
		`- Delivery strategy: ${deliveryStrategy}`,
		"- Delivery strategy domain: `ask-on-risk` | `auto-chain` | `single-pr` | `exception-ok`",
		`- Review budget: ${prefs.reviewBudgetLines} changed lines (400 is the canonical threshold unless explicitly changed)`,
		"- Chain strategy: deferred until chaining is selected.",
		"- `exception-ok` is never inferred; it requires explicit acceptance of `size:exception`.",
		...interactiveRules,
		"- Preserve human-controlled consent, authorization, security, destructive/publishing, ambiguous-scope, and `size:exception` gates.",
		"- When review-budget risk requires a delivery decision, use `ask-on-risk` to pause and ask; do not invent a chain strategy or an exception.",
	].join("\n");
}

export async function ensureSddPreflight(
	ctx: ExtensionContext,
	callbacks: SddPreflightCallbacks,
	resolutionOptions: SddPreflightResolutionOptions = {},
): Promise<SddPreflightPreferences> {
	const sessionKey = sddPreflightSessionKey(ctx);
	const bypassCache = resolutionOptions.explicitWrite === true;
	const existing = sddPreflightBySession.get(sessionKey);
	if (existing && !bypassCache) return existing;
	const operationKey = bypassCache ? `${sessionKey}\0explicit` : sessionKey;
	const inFlight = sddPreflightInFlight.get(operationKey);
	if (inFlight) return inFlight;
	const promise = (async () => {
		const engramAvailable = hasWritableEngramTool(callbacks.pi);
		const persisted = resolutionOptions.persisted ?? readSddPreflightFromDisk(ctx.cwd) ?? withPreferenceSource(DEFAULT_SDD_PREFLIGHT, "built-in-defaults");
		let prefs = await collectSddPreflightPreferences(ctx, engramAvailable, {
			...resolutionOptions,
			persisted,
		});
		const authorityPresent = persisted.preferenceSource === "canonical-project" || persisted.preferenceSource === "legacy-project";
		const shouldWrite = bypassCache ? prefs.prompted : !authorityPresent;
		const writeResult = shouldWrite ? writeSddPreflightToDisk(ctx.cwd, prefs) : undefined;
		if (writeResult) {
			const resolved = readSddPreflightFromDisk(ctx.cwd) ?? withPreferenceSource(DEFAULT_SDD_PREFLIGHT, "built-in-defaults");
			const effective = await collectSddPreflightPreferences(ctx, engramAvailable, { persisted: resolved });
			prefs = { ...effective, prompted: writeResult.status === "failed" ? false : prefs.prompted };
		}
		const result =
			(await callbacks.installAssets?.(ctx.cwd)) ??
			installSddAssets(ctx.cwd, false);
		const modelResult = (await callbacks.applyModelConfig?.(ctx.cwd)) ?? {
			updated: 0,
			skipped: 0,
		};
		if (ctx.hasUI) {
			const modelRoutingLine = modelResult.invalidPath
				? `Model routing skipped: ${modelResult.invalidPath} is invalid JSON or not an object.`
				: `Model-routed agents updated: ${modelResult.updated}`;
			ctx.ui.notify(
				[
					"Shevanio Pi SDD preflight complete.",
					`Mode: ${prefs.executionMode}`,
					`Artifacts: ${prefs.artifactStore}`,
					`Delivery strategy: ${prefs.chainedPrStrategy}`,
					`Review budget: ${prefs.reviewBudgetLines} changed lines`,
					`Preference source: ${prefs.preferenceSource ?? "built-in-defaults"}${prefs.preferencePath ? ` (${prefs.preferencePath})` : ""}`,
					...(writeResult ? [`Preference write: ${writeResult.status} (${writeResult.path})${writeResult.error ? `: ${writeResult.error}` : ""}`] : []),
					...(prefs.diagnostics ?? []).map(({ level, message }) => `${level === "warning" ? "Warning" : "Info"}: ${message}`),
					`Global SDD assets ready: ${result.agents} agent(s), ${result.chains} chain(s), ${result.support} support file(s), ${result.skipped} already present.`,
					modelRoutingLine,
				].join("\n"),
				modelResult.invalidPath || writeResult?.status === "failed" || prefs.diagnostics?.some(({ level }) => level === "warning") ? "warning" : "info",
			);
		}
		sddPreflightBySession.set(sessionKey, prefs);
		return prefs;
	})();
	sddPreflightInFlight.set(operationKey, promise);
	try {
		return await promise;
	} finally {
		sddPreflightInFlight.delete(operationKey);
	}
}

export function getSddPreflightPreferences(
	ctx: ExtensionContext,
): SddPreflightPreferences | undefined {
	const sessionKey = sddPreflightSessionKey(ctx);
	const cached = sddPreflightBySession.get(sessionKey);
	return cached;
}
