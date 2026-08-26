import type { DiagonalScript, PageContext, PageEvidence, ScriptDiagnostic } from '@diagonal/shared';

// el prompt de sistema fija el contrato de salida: un único bloque de código
// con metadatos ==UserScript==, sin herramientas ni pasos intermedios
export const SYSTEM_PROMPT = `You are diagonal, a userscript generator for Firefox.

Given a user request and page context, reply with EXACTLY ONE javascript code block containing a complete, self-contained userscript. No prose before or after beyond one short sentence describing what the script does.

Rules for the script:
- Start with a ==UserScript== metadata block including @name, @description, @version and one or more @match lines scoped as narrowly as possible to the target site. Never put a port number in an @match pattern: Firefox does not support them, and a pattern like *://localhost:3000/* matches nothing. Write *://localhost/* instead.
- Vanilla JavaScript only, no external libraries, no imports.
- It runs in the isolated USER_SCRIPT world at document_idle: the DOM is available, page JS globals are not.
- Make DOM manipulation idempotent (guard against double-application) and resilient to dynamic pages: use a MutationObserver when the target elements may render late.
- Never make network requests (fetch/XMLHttpRequest/WebSocket/beacons) unless the user explicitly asked for them.
- Never use eval or injected <script> tags.
- Prefer CSS injection via a <style> element for purely visual changes.
- When an existing script is provided, return the complete modified script, never a diff, patch or fragment. Keep its @name unless the change makes it inaccurate.
- Include exactly one `// @diagonal-verify <expression>` line in the metadata block. It must be a single JavaScript expression (no statements, no semicolon) that evaluates truthy only when the script's intended effect is actually present in the page, for example `document.querySelector('.my-injected-banner') !== null`. It is compiled into the page separately from your script body, so it must inspect the DOM only and must never reference variables you declared.`;

// instrucción de arreglo: sustituye al prompt del usuario cuando se pide un
// diagnóstico en vez de un cambio concreto
const DIAGNOSE_INSTRUCTION = `This script is not working. Using the failures and page evidence above, work out the root cause and return a corrected complete script. If the evidence shows the intended effect is already present and correct, return the script unchanged and say so in one sentence.`;

const describeDiagnostic = (diagnostic: ScriptDiagnostic): string =>
	[
		`- [${diagnostic.kind}] ${diagnostic.message}`,
		diagnostic.line !== undefined ? `  line ${diagnostic.line}${diagnostic.column !== undefined ? `:${diagnostic.column}` : ''}` : '',
		diagnostic.url ? `  seen on ${diagnostic.url}` : '',
		// solo la cabeza de la traza: el resto es ruido del propio envoltorio
		diagnostic.stack ? `  ${diagnostic.stack.split('\n').slice(0, 3).join('\n  ')}` : '',
	]
		.filter(Boolean)
		.join('\n');

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
// usuario puede haberlo editado a mano entre una generación y la siguiente.
// con diagnósticos y evidencia, el mismo turno sirve para arreglarlo
export const buildRefinePrompt = (
	prompt: string,
	script: DiagonalScript,
	context: PageContext,
	diagnostics?: ScriptDiagnostic[],
	evidence?: PageEvidence,
): string =>
	[
		`Page URL: ${evidence?.url ?? context.url}`,
		`Page title: ${evidence?.title ?? context.title}`,
		`Current script "${script.name}":\n\`\`\`javascript\n${script.code}\n\`\`\``,
		diagnostics?.length ? `Observed failures:\n${diagnostics.map(describeDiagnostic).join('\n')}` : '',
		evidence?.dom ? `Current page DOM (trimmed):\n\`\`\`html\n${evidence.dom}\n\`\`\`` : '',
		evidence?.screenshot ? 'A screenshot of the page as the user currently sees it is attached.' : '',
		prompt ? `Requested change: ${prompt}` : DIAGNOSE_INSTRUCTION,
	]
		.filter(Boolean)
		.join('\n\n');

const CODE_FENCE = /```(?:javascript|js)?\n([\s\S]*?)```/g;

// extrae el último bloque de código de la respuesta del modelo
export const extractScriptCode = (text: string): string | undefined =>
	[...text.matchAll(CODE_FENCE)].at(-1)?.[1]?.trim();
