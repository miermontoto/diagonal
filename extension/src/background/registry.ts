import type { DiagonalScript } from '@diagonal/shared';
import { userScriptsApi } from './userscripts-api';
import type { RegisteredUserScript } from './userscripts-api';

// storage.local es el espejo de registro; el disco (gestionado por el host)
// guarda el código fuente y las sesiones de claude asociadas
const STORAGE_KEY = 'scripts';

export const loadScripts = async (): Promise<DiagonalScript[]> => {
	const stored = await browser.storage.local.get(STORAGE_KEY);
	return (stored[STORAGE_KEY] as DiagonalScript[] | undefined) ?? [];
};

export const saveScripts = async (scripts: DiagonalScript[]): Promise<void> =>
	browser.storage.local.set({ [STORAGE_KEY]: scripts });

const toRegistered = (script: DiagonalScript): RegisteredUserScript => ({
	id: script.id,
	matches: script.matches,
	js: [{ code: script.code }],
	runAt: 'document_idle',
	world: 'USER_SCRIPT',
});

// resincronización completa e idempotente: firefox borra los registros al
// actualizar la extensión, así que se reconstruyen desde el espejo
export const syncRegistrations = async (): Promise<void> => {
	const api = userScriptsApi();
	if (!api) return;
	const enabled = (await loadScripts()).filter((script) => script.enabled);
	await api.unregister();
	if (enabled.length > 0) await api.register(enabled.map(toRegistered));
};
