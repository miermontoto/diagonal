import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import {
	BILLING_ENV_BLOCKLIST,
	DEFAULT_MODEL,
	matchPatternFromUrl,
	parseMetadata,
} from '@diagonal/shared';
import type { AuthState, DiagonalScript, PageContext } from '@diagonal/shared';
import { SYSTEM_PROMPT, buildPrompt, extractScriptCode } from './prompt.js';
import { saveScript } from './store.js';

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

export const generateScript = async (
	prompt: string,
	context: PageContext,
	onChunk: (text: string) => void,
): Promise<DiagonalScript> => {
	let sessionId: string | undefined;
	let finalText = '';

	const conversation = query({
		prompt: buildPrompt(prompt, context),
		options: {
			model: DEFAULT_MODEL,
			systemPrompt: SYSTEM_PROMPT,
			// generación pura en un turno: sin herramientas no hay prompts de permisos
			allowedTools: [],
			maxTurns: 1,
			includePartialMessages: true,
			env: subscriptionEnv(),
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

	const meta = parseMetadata(code);
	const now = new Date().toISOString();
	const script: DiagonalScript = {
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
	saveScript(script);
	return script;
};
