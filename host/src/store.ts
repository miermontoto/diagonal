import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { DiagonalScript } from '@diagonal/shared';

// los scripts viven en disco como fuente de verdad: claude code puede editarlos
// directamente y el usuario puede versionarlos con git
export const scriptsDir = join(
	process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'),
	'diagonal',
	'scripts',
);

const codePath = (id: string): string => join(scriptsDir, `${id}.user.js`);
const metaPath = (id: string): string => join(scriptsDir, `${id}.meta.json`);

const META_SUFFIX = '.meta.json';

export const ensureDir = (): void => {
	mkdirSync(scriptsDir, { recursive: true });
};

export const saveScript = (script: DiagonalScript): void => {
	ensureDir();
	const { code, ...meta } = script;
	writeFileSync(codePath(script.id), code, 'utf8');
	writeFileSync(metaPath(script.id), JSON.stringify(meta, null, '\t'), 'utf8');
};

export const listScripts = (): DiagonalScript[] => {
	ensureDir();
	return readdirSync(scriptsDir)
		.filter((entry) => entry.endsWith(META_SUFFIX))
		.map((entry) => {
			const meta = JSON.parse(readFileSync(join(scriptsDir, entry), 'utf8')) as Omit<DiagonalScript, 'code'>;
			return { ...meta, code: readFileSync(codePath(meta.id), 'utf8') };
		})
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};

export const deleteScript = (id: string): void => {
	[codePath(id), metaPath(id)].filter(existsSync).forEach((path) => rmSync(path));
};
