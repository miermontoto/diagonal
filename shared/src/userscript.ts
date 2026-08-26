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

// deriva un patrón de coincidencia razonable a partir de la url de la pestaña
export const matchPatternFromUrl = (url: string): string => {
	try {
		const { protocol, host } = new URL(url);
		return protocol === 'http:' || protocol === 'https:' ? `*://${host}/*` : url;
	} catch {
		return '<all_urls>';
	}
};
