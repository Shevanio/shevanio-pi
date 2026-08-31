import assert from "node:assert/strict";
import test from "node:test";
import { __testing } from "../extensions/gentle-ai.ts";

const SELF_DESCRIPTION = "I am Shevanio AI, the parent coding-agent identity in Shevanio Pi, a Pi package/runtime harness for controlled development. I work with SDD/OpenSpec when the task justifies it, coordinate subagents, use phase artifacts, run commands, and edit files. I am not a generic chatbot.";

// These tests assert that the composed main-agent prompt (built by buildGentlePrompt)
// does not encourage Rioplatense voseo in neutral mode, and does include the expected
// voseo/Rioplatense markers in shevanio-ai mode.

test("neutral mode composed prompt does not instruct to use voseo", () => {
	const prompt = __testing.buildGentlePrompt("neutral");
	// The neutral prompt must never tell the model to USE voseo
	assert.doesNotMatch(
		prompt,
		/answer in natural Rioplatense Spanish with voseo/i,
		"neutral prompt must not instruct to use Rioplatense voseo",
	);
	assert.doesNotMatch(
		prompt,
		/uses natural Rioplatense voseo/i,
		"neutral prompt must not describe voseo as the language mode to use",
	);
});

test("neutral mode composed prompt has no positive voseo/Rioplatense instruction and includes explicit prohibition", () => {
	const prompt = __testing.buildGentlePrompt("neutral");
	// Any sentence that affirmatively tells the model to use voseo or natural Rioplatense
	// must be absent. The prohibition line ("Do NOT use voseo") is the only allowed voseo
	// mention. We match patterns that indicate a positive directive by requiring the word
	// "use" (or its inflections) in proximity to "voseo" or "Rioplatense" WITHOUT a
	// preceding negation — concretely, lines that start/contain "use", "uses", or "with voseo".
	assert.doesNotMatch(
		prompt,
		/\bwith voseo\b/i,
		"neutral prompt must not contain 'with voseo' (positive directive)",
	);
	assert.doesNotMatch(
		prompt,
		/\buse(?:s)? (?:natural )?Rioplatense\b/i,
		"neutral prompt must not instruct to use Rioplatense",
	);
	// The prohibition line must remain present so the model knows NOT to use voseo
	assert.match(
		prompt,
		/Do NOT use voseo/i,
		"neutral prompt must explicitly prohibit voseo",
	);
});

test("shevanio-ai mode composed prompt contains voseo reference", () => {
	const prompt = __testing.buildGentlePrompt("shevanio-ai");
	assert.match(
		prompt,
		/voseo/i,
		"shevanio-ai prompt must reference voseo",
	);
});

test("shevanio-ai mode composed prompt contains Rioplatense reference", () => {
	const prompt = __testing.buildGentlePrompt("shevanio-ai");
	assert.match(
		prompt,
		/Rioplatense/i,
		"shevanio-ai prompt must reference Rioplatense",
	);
});

test("neutral mode composed prompt explicitly states active mode is neutral", () => {
	const prompt = __testing.buildGentlePrompt("neutral");
	assert.match(
		prompt,
		/Current persona mode: neutral/i,
		"neutral prompt must state active mode is neutral",
	);
	assert.equal(prompt.split(SELF_DESCRIPTION).length - 1, 1);
	assert.match(prompt, /## Shevanio AI Identity and Shevanio Pi Harness/);
	assert.match(prompt, /## Work Routing Ladder/);
});

test("shevanio-ai mode composed prompt explicitly states its canonical active mode", () => {
	const prompt = __testing.buildGentlePrompt("shevanio-ai");
	assert.match(
		prompt,
		/Current persona mode: shevanio-ai/i,
		"canonical prompt must state active mode is shevanio-ai",
	);
	assert.equal(prompt.split(SELF_DESCRIPTION).length - 1, 1);
});

test("neutral mode composed prompt explicitly forbids voseo conjugations", () => {
	const prompt = __testing.buildGentlePrompt("neutral");
	// The neutral persona prompt must explicitly forbid voseo conjugation forms
	assert.match(
		prompt,
		/Do NOT use voseo/i,
		"neutral prompt must explicitly forbid voseo",
	);
});

test("neutral and shevanio-ai modes produce different language-boundary text", () => {
	const neutralPrompt = __testing.buildGentlePrompt("neutral");
	const canonicalPrompt = __testing.buildGentlePrompt("shevanio-ai");

	// The language-boundary section must differ between modes
	assert.notEqual(
		neutralPrompt,
		canonicalPrompt,
		"neutral and shevanio-ai prompts must differ",
	);

	// Neutral must not include a positive instruction to use Rioplatense
	assert.doesNotMatch(
		neutralPrompt,
		/Language: natural Rioplatense/i,
		"neutral prompt must not contain positive 'natural Rioplatense' language instruction",
	);

	// Canonical mode must contain the Rioplatense instruction
	assert.match(
		canonicalPrompt,
		/Language: natural Rioplatense/i,
		"shevanio-ai prompt must contain 'Language: natural Rioplatense' instruction",
	);
});
