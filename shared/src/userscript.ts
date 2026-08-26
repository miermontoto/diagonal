import { VERIFY_RECHECK_MS } from './constants.js';

// marcador que el preámbulo sustituye por su propia altura una vez conocida
const OFFSET_PLACEHOLDER = '__DIAGONAL_OFFSET__';

// contexto de página capturado por la extensión para orientar la generación
export interface PageContext {
	url: string;
	title: string;
	digest?: string;
}

// lo que el modelo llega a ver de la página al diagnosticar un script
export interface PageEvidence {
	url: string;
	title: string;
	dom?: string;
	// jpeg en base64, ya reescalado para caber en una trama de native messaging
	screenshot?: string;
}

// un userscript gestionado por diagonal; el código incluye su bloque ==UserScript==
export interface DiagonalScript {
	id: string;
	name: string;
	description: string;
	matches: string[];
	code: string;
	// expresión js que el propio script evalúa para confirmar que su efecto está
	// aplicado; es lo único que distingue "no hizo nada" de "funcionó en silencio"
	verify?: string;
	enabled: boolean;
	createdAt: string;
	updatedAt: string;
	// sesión de claude code asociada, permite refinamientos con memoria
	sessionId?: string;
}

export interface ScriptMetadata {
	name?: string;
	description?: string;
	matches: string[];
	verify?: string;
	version?: string;
}

// por qué un script no está funcionando, en el vocabulario en el que se detecta
export type DiagnosticKind = 'syntax' | 'registration' | 'runtime' | 'mismatch' | 'verify';

export interface ScriptDiagnostic {
	scriptId: string;
	kind: DiagnosticKind;
	message: string;
	at: string;
	url?: string;
	stack?: string;
	line?: number;
	column?: number;
}

const META_BLOCK = /\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/;
const META_LINE = /^\/\/\s*@([\w-]+)\s+(.+)$/;

// extrae los metadatos del bloque ==UserScript== del código generado
export const parseMetadata = (code: string): ScriptMetadata => {
	const block = META_BLOCK.exec(code)?.[1] ?? '';
	const entries = block
		.split('\n')
		.map((line) => META_LINE.exec(line.trim()))
		.filter((m): m is RegExpExecArray => m !== null)
		.map((m) => [m[1]!, m[2]!.trim()] as const);

	return {
		name: entries.find(([k]) => k === 'name')?.[1],
		description: entries.find(([k]) => k === 'description')?.[1],
		matches: entries.filter(([k]) => k === 'match').map(([, v]) => v),
		verify: entries.find(([k]) => k === 'diagonal-verify')?.[1],
		version: entries.find(([k]) => k === 'version')?.[1],
	};
};

// aplica código nuevo sobre un script releyendo sus metadatos: si un reprompt o
// una edición a mano tocaron los @match, el registro en firefox debe seguirlos
export const applyCode = (script: DiagonalScript, code: string): DiagonalScript => {
	const meta = parseMetadata(code);
	return {
		...script,
		name: meta.name ?? script.name,
		description: meta.description ?? script.description,
		matches: meta.matches.length > 0 ? meta.matches : script.matches,
		verify: meta.verify ?? script.verify,
		code,
		updatedAt: new Date().toISOString(),
	};
};

// deriva un patrón de coincidencia razonable a partir de la url de la pestaña
export const matchPatternFromUrl = (url: string): string => {
	try {
		// hostname y no host: el puerto no cabe en un match pattern
		const { protocol, hostname } = new URL(url);
		return protocol === 'http:' || protocol === 'https:' ? `*://${hostname}/*` : url;
	} catch {
		return '<all_urls>';
	}
};

// firefox no expone su matcher de patrones a las extensiones, así que se replica:
// esquema, host y ruta tienen reglas propias y no son un glob único
const ALL_URLS = '<all_urls>';

// firefox no admite puertos en los match patterns, así que un patrón con puerto
// ni registra ni encaja con nada. se le quita en vez de rechazarlo: los scripts
// ya generados llevan el puerto escrito en sus @match
const stripPort = (host: string): string => {
	// una ip v6 va entre corchetes y lleva sus propios dos puntos dentro
	const afterBrackets = host.startsWith('[') ? host.indexOf(']') + 1 : 0;
	const colon = host.indexOf(':', afterBrackets);
	return colon === -1 ? host : host.slice(0, colon);
};

// deja el patrón como firefox puede aceptarlo
export const normalizeMatchPattern = (pattern: string): string => {
	const parts = PATTERN.exec(pattern);
	if (!parts) return pattern;
	const [, scheme = '', host = '', path = ''] = parts;
	return `${scheme}://${stripPort(host)}${path}`;
};
const PATTERN = /^(\*|[a-z][a-z0-9+.-]*):\/\/(\*|(?:\*\.)?[^/*]*)(\/.*)$/i;
const ALL_URLS_SCHEMES = /^(https?|wss?|ftp|file|data):$/;

// traduce un glob a regexp escapando todo salvo el comodín
const globToRegExp = (glob: string): RegExp =>
	new RegExp(`^${glob.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);

// evalúa un match pattern de webextensions contra una url concreta
export const matchesPattern = (pattern: string, url: string): boolean => {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	if (pattern === ALL_URLS) return ALL_URLS_SCHEMES.test(parsed.protocol);

	const parts = PATTERN.exec(pattern);
	if (!parts) return false;
	const [, scheme = '', host = '', path = ''] = parts;

	// el comodín de esquema cubre solo http y https
	if (scheme === '*') {
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
	} else if (parsed.protocol !== `${scheme.toLowerCase()}:`) return false;

	// '*.' admite tanto el dominio base como cualquier subdominio
	const hostname = parsed.hostname.toLowerCase();
	const expected = stripPort(host.toLowerCase());
	if (expected !== '*') {
		if (expected.startsWith('*.')) {
			const base = expected.slice(2);
			if (hostname !== base && !hostname.endsWith(`.${base}`)) return false;
		} else if (hostname !== expected) return false;
	}

	// la ruta del patrón se compara contra pathname + query
	return globToRegExp(path).test(`${parsed.pathname}${parsed.search}`);
};

// el preámbulo que envuelve al código del usuario. se construye por líneas
// porque su altura exacta es lo que desplaza los números de error del usuario
const preambleOf = (script: DiagonalScript): string[] => {
	// la expresión de autochequeo se concatena como fuente, no se evalúa: en el
	// mundo USER_SCRIPT el csp por defecto prohíbe eval
	const check = script.verify ? `(${script.verify})` : 'undefined';
	return [
		'(() => {',
		`	const __id = ${JSON.stringify(script.id)};`,
		`	const __offset = ${OFFSET_PLACEHOLDER};`,
		'	const __send = (payload) => {',
		'		try { browser.runtime.sendMessage({ __diagonal: true, scriptId: __id, ...payload }); } catch (e) {}',
		'	};',
		'	// las líneas se devuelven al sistema de referencia del usuario, no del envoltorio',
		'	const __fail = (message, stack, line, column) =>',
		'		__send({ kind: "runtime", message, stack, line: typeof line === "number" ? line - __offset : undefined, column });',
		'	// los fallos asíncronos (MutationObserver, timeouts) nunca pasan por el try',
		'	addEventListener("error", (event) => __fail(String(event.message), event.error && event.error.stack, event.lineno, event.colno));',
		'	addEventListener("unhandledrejection", (event) => __fail(String(event.reason), event.reason && event.reason.stack));',
		`	const __verify = () => { try { return ${check}; } catch (e) { return undefined; } };`,
		'	try {',
	];
};

// cuántas líneas de envoltorio preceden al código del usuario
export const instrumentedOffset = (script: DiagonalScript): number => preambleOf(script).length;

// el código que se registra no es el del usuario tal cual: va envuelto para que
// el mundo aislado pueda contar qué le pasó. sin esto, un fallo es invisible.
// vive en shared porque el host valida exactamente la misma fuente que se registra
export const instrument = (script: DiagonalScript): string => {
	const preamble = preambleOf(script);
	return [
		...preamble.map((line) => line.replace(OFFSET_PLACEHOLDER, String(preamble.length))),
		script.code,
		'		__send({ kind: "ran" });',
		'		// el efecto puede depender de nodos que aún no existen en document_idle',
		`		setTimeout(() => __send({ kind: "verified", verified: __verify() }), ${VERIFY_RECHECK_MS});`,
		'	} catch (error) {',
		'		__fail(String(error), error && error.stack);',
		'	}',
		'})();',
	].join('\n');
};

// firefox rechaza el registro completo si un solo patrón es inválido, así que
// hay que poder descartarlos antes de mandarlos
export const isValidMatchPattern = (pattern: string): boolean =>
	pattern === ALL_URLS || PATTERN.test(pattern);

// un script aplica a la página si alguno de sus patrones coincide
export const matchesUrl = (script: DiagonalScript, url: string): boolean =>
	script.matches.some((pattern) => matchesPattern(pattern, url));
