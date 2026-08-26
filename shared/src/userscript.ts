// contexto de página capturado por la extensión para orientar la generación
export interface PageContext {
	url: string;
	title: string;
	digest?: string;
}

// un userscript gestionado por diagonal; el código incluye su bloque ==UserScript==
export interface DiagonalScript {
	id: string;
	name: string;
	description: string;
	matches: string[];
	code: string;
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
	version?: string;
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
		code,
		updatedAt: new Date().toISOString(),
	};
};

// deriva un patrón de coincidencia razonable a partir de la url de la pestaña
export const matchPatternFromUrl = (url: string): string => {
	try {
		const { protocol, host } = new URL(url);
		return protocol === 'http:' || protocol === 'https:' ? `*://${host}/*` : url;
	} catch {
		return '<all_urls>';
	}
};

// firefox no expone su matcher de patrones a las extensiones, así que se replica:
// esquema, host y ruta tienen reglas propias y no son un glob único
const ALL_URLS = '<all_urls>';
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
	const expected = host.toLowerCase();
	if (expected !== '*') {
		if (expected.startsWith('*.')) {
			const base = expected.slice(2);
			if (hostname !== base && !hostname.endsWith(`.${base}`)) return false;
		} else if (hostname !== expected) return false;
	}

	// la ruta del patrón se compara contra pathname + query
	return globToRegExp(path).test(`${parsed.pathname}${parsed.search}`);
};

// un script aplica a la página si alguno de sus patrones coincide
export const matchesUrl = (script: DiagonalScript, url: string): boolean =>
	script.matches.some((pattern) => matchesPattern(pattern, url));
