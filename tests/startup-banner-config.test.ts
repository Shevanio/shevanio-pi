import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after, type TestContext } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import startupBanner, { __testing } from "../extensions/startup-banner.ts";

const roots: string[] = [];
const DEFAULTS = { showRose: true, showTextLogo: true, color: "pink" };
const encoded = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

function fixture(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  const canonical = join(root, "canonical");
  const legacy = join(root, "legacy");
  const home = join(root, "home");
  const cwd = join(root, "cwd");
  for (const path of [canonical, legacy, home, cwd]) mkdirSync(path, { recursive: true });
  return { root, canonical, legacy, home, cwd, env: { SHEVANIO_PI_CONFIG_HOME: canonical, GENTLE_PI_CONFIG_HOME: legacy } };
}

function put(path: string, value: string | object): string {
  mkdirSync(dirname(path), { recursive: true });
  const bytes = typeof value === "string" ? value : encoded(value);
  writeFileSync(path, bytes);
  return bytes;
}

after(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

test("global resolution covers defaults, legacy fallback, canonical precedence, and normalized collisions", async () => {
  const f = fixture("shevanio-banner-resolution-");
  const canonicalPath = join(f.canonical, "banner.json");
  const legacyPath = join(f.legacy, "banner.json");
  assert.deepEqual(await __testing.resolveBannerConfig({ env: f.env, home: f.home }), { config: DEFAULTS, source: "default" });
  assert.equal(existsSync(canonicalPath) || existsSync(legacyPath), false, "reads never create either file");
  put(legacyPath, { showRose: false, showTextLogo: false, color: "green", ignored: true });
  let result = await __testing.resolveBannerConfig({ env: f.env, home: f.home });
  assert.deepEqual([result.source, result.config, result.decidingPath], ["legacy", { showRose: false, showTextLogo: false, color: "green" }, legacyPath]);
  put(canonicalPath, { showRose: false, showTextLogo: false, color: "green", other: 1 });
  result = await __testing.resolveBannerConfig({ env: f.env, home: f.home });
  assert.equal(result.source, "canonical");
  assert.equal(result.shadowedLegacy?.path, legacyPath);
  assert.equal(__testing.renderBannerConfigReport(result).type, "info");
  put(canonicalPath, { showRose: true, showTextLogo: false, color: "green" });
  result = await __testing.resolveBannerConfig({ env: f.env, home: f.home });
  const report = __testing.renderBannerConfigReport(result);
  assert.equal(report.type, "warning");
  assert.match(report.message, new RegExp(legacyPath));
});

test("canonical malformed and partial values normalize authoritatively without falling through", async () => {
  const f = fixture("shevanio-banner-normalize-");
  const canonicalPath = join(f.canonical, "banner.json");
  put(join(f.legacy, "banner.json"), { showRose: false, showTextLogo: false, color: "green" });
  for (const raw of ["{bad", "[]", "null"]) {
    put(canonicalPath, raw);
    const result = await __testing.resolveBannerConfig({ env: f.env, home: f.home });
    assert.deepEqual([result.source, result.config], ["canonical", DEFAULTS], raw);
  }
  put(canonicalPath, { showRose: false, showTextLogo: "bad", color: "cyan", unknown: 1 });
  assert.deepEqual((await __testing.resolveBannerConfig({ env: f.env, home: f.home })).config, { showRose: false, showTextLogo: true, color: "cyan" });
  const unreadable = await __testing.resolveBannerConfig({
    env: f.env,
    home: f.home,
    read: async (path: string) => path === canonicalPath ? Promise.reject(Object.assign(new Error("denied"), { code: "EACCES" })) : readFileSync(path, "utf8"),
  });
  assert.deepEqual([unreadable.source, unreadable.config], ["canonical", DEFAULTS]);
});

test("one normalized path is read once and never reported as a collision", async () => {
  const f = fixture("shevanio-banner-shared-");
  let reads = 0;
  const result = await __testing.resolveBannerConfig({
    env: { SHEVANIO_PI_CONFIG_HOME: join(f.root, "shared", "..", "shared"), GENTLE_PI_CONFIG_HOME: join(f.root, "shared") },
    read: async () => { reads += 1; return '{"showRose":false}'; },
  });
  assert.equal(reads, 1);
  assert.deepEqual([result.source, result.shadowedLegacy, result.config], ["canonical", undefined, { showRose: false, showTextLogo: true, color: "pink" }]);
});

test("write selection is canonical-first and normalized writes preserve legacy bytes idempotently", async () => {
  const f = fixture("shevanio-banner-write-");
  assert.equal(__testing.bannerWriteTarget({ env: f.env, home: f.home }), join(f.canonical, "banner.json"));
  assert.equal(__testing.bannerWriteTarget({ env: { GENTLE_PI_CONFIG_HOME: f.legacy }, home: f.home }), join(f.legacy, "banner.json"));
  assert.equal(__testing.bannerWriteTarget({ env: {}, home: f.home }), join(f.home, ".pi", "shevanio-pi", "banner.json"));
  const legacyPath = join(f.legacy, "banner.json");
  const legacyBytes = put(legacyPath, '{"showRose":false,"private":"keep"}\n');
  const config = { showRose: false, showTextLogo: true, color: "cyan" } as const;
  const target = await __testing.writeBannerConfig(config, { env: f.env, home: f.home });
  const first = readFileSync(target, "utf8");
  await __testing.writeBannerConfig(config, { env: f.env, home: f.home });
  assert.equal(first, encoded(config));
  assert.equal(readFileSync(target, "utf8"), first);
  assert.equal(readFileSync(legacyPath, "utf8"), legacyBytes);
});

function harness() {
  const commands = new Map<string, { handler: (args: string, ctx: ExtensionContext) => Promise<void> }>();
  const hooks = new Map<string, (event: unknown, ctx: ExtensionContext) => Promise<void>>();
  startupBanner({
    registerCommand(name: string, command: { handler: (args: string, ctx: ExtensionContext) => Promise<void> }) { commands.set(name, command); },
    on(name: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<void>) { hooks.set(name, handler); },
  } as unknown as ExtensionAPI);
  return { commands, hooks };
}

function scopedEnv(t: TestContext, values: Record<string, string | undefined>) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) value === undefined ? delete process.env[key] : process.env[key] = value;
  t.after(() => { for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value; });
}

test("commands preserve legacy bytes, cancellation is silent, session start does not write, and ineffective writes warn", async (t) => {
  const f = fixture("shevanio-banner-command-");
  scopedEnv(t, { ...f.env, HOME: f.home, USERPROFILE: f.home });
  const legacyPath = join(f.legacy, "banner.json");
  const legacyBytes = put(legacyPath, { showRose: false, showTextLogo: false, color: "green" });
  const { commands, hooks } = harness();
  const notices: Array<{ message: string; type: string }> = [];
  const ctx = { cwd: f.cwd, hasUI: true, ui: { notify: (message: string, type: string) => notices.push({ message, type }), select: async () => undefined } } as unknown as ExtensionContext;
  await commands.get("shevanio-pi:toggle-rose")!.handler("", ctx);
  const canonicalPath = join(f.canonical, "banner.json");
  const canonicalBytes = encoded({ showRose: true, showTextLogo: false, color: "green" });
  assert.equal(readFileSync(canonicalPath, "utf8"), canonicalBytes);
  assert.equal(readFileSync(legacyPath, "utf8"), legacyBytes);
  assert.match(notices[0]!.message, new RegExp(`Source: canonical global file ${canonicalPath}`));
  notices.length = 0;
  await commands.get("shevanio-pi:banner-color")!.handler("", ctx);
  assert.equal(readFileSync(canonicalPath, "utf8"), canonicalBytes);
  assert.equal(notices.length, 0);
  await hooks.get("session_start")!({}, { ...ctx, hasUI: false } as ExtensionContext);
  assert.equal(readFileSync(canonicalPath, "utf8"), canonicalBytes);
  assert.equal(readFileSync(legacyPath, "utf8"), legacyBytes);

  const f2 = fixture("shevanio-banner-outranked-");
  scopedEnv(t, { SHEVANIO_PI_CONFIG_HOME: undefined, GENTLE_PI_CONFIG_HOME: f2.legacy, HOME: f2.home, USERPROFILE: f2.home });
  const defaultCanonical = join(f2.home, ".pi", "shevanio-pi", "banner.json");
  put(defaultCanonical, { showRose: true, showTextLogo: false, color: "yellow" });
  notices.length = 0;
  await commands.get("shevanio-pi:toggle-rose")!.handler("", ctx);
  assert.equal(readFileSync(join(f2.legacy, "banner.json"), "utf8"), encoded({ showRose: false, showTextLogo: false, color: "yellow" }));
  assert.equal(notices[0]!.type, "warning");
  assert.match(notices[0]!.message, /is ineffective/);
  assert.doesNotMatch(notices[0]!.message, /Saved normalized/);
});

const script = ["/usr/bin/script", "/bin/script"].find(existsSync);
const quote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;

test("installed Pi toggles inherited legacy banner config through a real Linux PTY", {
  skip: process.platform !== "linux" ? "Linux PTY proof" : script === undefined ? "script is unavailable" : false,
}, () => {
  const f = fixture("shevanio-banner-pty-");
  const legacyPath = join(f.legacy, "banner.json");
  const legacyBytes = put(legacyPath, { showRose: false, showTextLogo: false, color: "green" });
  const cli = join(import.meta.dirname, "..", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
  const extension = join(import.meta.dirname, "..", "extensions", "startup-banner.ts");
  assert.equal(existsSync(cli), true, "installed Pi CLI is required");
  const command = `stty rows 24 cols 80; exec ${quote(process.execPath)} ${quote(cli)} --no-session --no-extensions --extension ${quote(extension)} --no-skills --no-prompt-templates --no-themes --no-context-files --no-tools ${quote("/shevanio-pi:toggle-rose")}`;
  const driver = `(sleep 2; printf '%s\\r' '/quit') | ${quote(script!)} -q -e -c ${quote(command)} /dev/null`;
  const result = spawnSync("/bin/sh", ["-c", driver], {
    cwd: f.cwd,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: f.home, USERPROFILE: f.home, SHELL: "/bin/sh", TERM: "xterm-256color", LANG: "C.UTF-8", COLUMNS: "80", LINES: "24", PI_OFFLINE: "1", ...f.env },
    encoding: "utf8",
    timeout: 15_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(result.error, undefined, `${result.error}\n${result.stdout}\n${result.stderr}`);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(readFileSync(join(f.canonical, "banner.json"), "utf8"), encoded({ showRose: true, showTextLogo: false, color: "green" }));
  assert.equal(readFileSync(legacyPath, "utf8"), legacyBytes);
});
