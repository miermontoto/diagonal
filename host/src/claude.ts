import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import {
	BILLING_ENV_BLOCKLIST,
	DEFAULT_MODEL,
	applyCode,
	matchPatternFromUrl,
	parseMetadata,
} from '@diagonal/shared';
import type { AuthState, DiagonalScript, PageContext } from '@diagonal/shared';
import { SYSTEM_PROMPT, buildPrompt, buildRefinePrompt, extractScriptCode } from './prompt.js';

// entorno purgado de credenciales de api: sin ellas, claude code solo puede
// autenticarse contra la suscripción, que es la garantía de coste del proyecto
const subscriptionEnv = (): Record<string, string | undefined> =>
	Object.fromEntries(Object.entries(process.env).filter(([key]) => !BILLING_ENV_BLOCKLIST.includes(key)));

// heurística barata para el estado de auth sin gastar tokens: token explícito
// o credenciales guardadas por `claude login`
export const authState = (): AuthState => {
	if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return 'subscription';
	return existsSync(join(homedir(), '.claude', '.credentials.json')) ? 'subscription' : 'missing';
};

// un turno contra el modelo: emite el streaming y devuelve lo único que ambas
// operaciones necesitan de él, el código y la sesión con la que continuar
const runQuery = async (
	prompt: string,
	onChunk: (text: string) => void,
	resume?: string,
): Promise<{ code: string; sessionId?: string }> => {
	let sessionId: string | undefined;
	let finalText = '';

	const conversation = query({
		prompt,
		options: {
			model: DEFAULT_MODEL,
			systemPrompt: SYSTEM_PROMPT,
			// generación pura en un turno: sin herramientas no hay prompts de permisos
			allowedTools: [],
			maxTurns: 1,
			includePartialMessages: true,
			env: subscriptionEnv(),
			resume,
		},
	});

	for await (const message of conversation) {
		if (message.type === 'stream_event') {
			const { event } = message;
			if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
				onChunk(event.delta.text);
			}
		} else if (message.type === 'result') {
			sessionId = message.session_id;
			if (message.subtype !== 'success') throw new Error(`generación fallida: ${message.subtype}`);
			finalText = message.result;
		}
	}

	const code = extractScriptCode(finalText);
	if (!code) throw new Error('la respuesta del modelo no contiene ningún bloque de código');
	return { code, sessionId };
};

export const generateScript = async (
	prompt: string,
	context: PageContext,
	onChunk: (text: string) => void,
): Promise<DiagonalScript> => {
	const { code, sessionId } = await runQuery(buildPrompt(prompt, context), onChunk);
	const meta = parseMetadata(code);
	const now = new Date().toISOString();

	return {
		id: randomUUID(),
		name: meta.name ?? context.title,
		description: meta.description ?? prompt,
		matches: meta.matches.length > 0 ? meta.matches : [matchPatternFromUrl(context.url)],
		code,
		// los scripts nacen deshabilitados: solo se activan tras la revisión del usuario
		enabled: false,
		createdAt: now,
		updatedAt: now,
		sessionId,
	};
};

// reprompt: conserva id, alta y estado porque sigue siendo el mismo script,
// y los metadatos solo se pisan si el código nuevo los trae
export const refineScript = async (
	script: DiagonalScript,
	prompt: string,
	context: PageContext,
	onChunk: (text: string) => void,
): Promise<DiagonalScript> => {
	const refinePrompt = buildRefinePrompt(prompt, script, context);
	let streamed = false;
	const track = (text: string): void => {
		streamed = true;
		onChunk(text);
	};

	const { code, sessionId } = await runQuery(refinePrompt, track, script.sessionId).catch((error: unknown) => {
		// la sesión pudo caducar o borrarse; el prompt ya lleva el código completo,
		// así que se reintenta sin memoria salvo que el fallo llegara con el stream ya abierto
		if (!script.sessionId || streamed) throw error;
		console.warn('[diagonal] sesión no reanudable, reintento sin memoria', error);
		return runQuery(refinePrompt, track);
	});
	return { ...applyCode(script, code), sessionId: sessionId ?? script.sessionId };
};
