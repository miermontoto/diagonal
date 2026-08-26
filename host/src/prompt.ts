import type { DiagonalScript, PageContext } from '@diagonal/shared';

// el prompt de sistema fija el contrato de salida: un único bloque de código
// con metadatos ==UserScript==, sin herramientas ni pasos intermedios
export const SYSTEM_PROMPT = `You are diagonal, a userscript generator for Firefox.

Given a user request and page context, reply with EXACTLY ONE javascript code block containing a complete, self-contained userscript. No prose before or after beyond one short sentence describing what the script does.

Rules for the script:
- Start with a ==UserScript== metadata block including @name, @description, @version and one or more @match lines scoped as narrowly as possible to the target site.
- Vanilla JavaScript only, no external libraries, no imports.
- It runs in the isolated USER_SCRIPT world at document_idle: the DOM is available, page JS globals are not.
- Make DOM manipulation idempotent (guard against double-application) and resilient to dynamic pages: use a MutationObserver when the target elements may render late.
- Never make network requests (fetch/XMLHttpRequest/WebSocket/beacons) unless the user explicitly asked for them.
- Never use eval or injected <script> tags.
- Prefer CSS injection via a <style> element for purely visual changes.
- When an existing script is provided, return the complete modified script, never a diff, patch or fragment. Keep its @name unless the change makes it inaccurate.`;

export const buildPrompt = (prompt: string, context: PageContext): string =>
	[
		`Page URL: ${context.url}`,
		`Page title: ${context.title}`,
		context.digest ? `Page structure digest:\n${context.digest}` : '',
		`User request: ${prompt}`,
	]
		.filter(Boolean)
		.join('\n\n');

// reprompt: el código actual manda sobre la memoria de la sesión, porque el
// usuario puede haberlo editado a mano entre una generación y la siguiente
export const buildRefinePrompt = (prompt: string, script: DiagonalScript, context: PageContext): string =>
	[
		`Page URL: ${context.url}`,
		`Page title: ${context.title}`,
		`Current script "${script.name}":\n\`\`\`javascript\n${script.code}\n\`\`\``,
		`Requested change: ${prompt}`,
	].join('\n\n');

const CODE_FENCE = /```(?:javascript|js)?\n([\s\S]*?)```/g;

// extrae el último bloque de código de la respuesta del modelo
export const extractScriptCode = (text: string): string | undefined =>
	[...text.matchAll(CODE_FENCE)].at(-1)?.[1]?.trim();
