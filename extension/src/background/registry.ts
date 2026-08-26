import { MAX_DIAGNOSTICS_PER_SCRIPT, instrument, isValidMatchPattern, matchesUrl, normalizeMatchPattern } from '@diagonal/shared';
import type { DiagonalScript, DiagnosticKind, ScriptDiagnostic } from '@diagonal/shared';
import { userScriptsApi } from './userscripts-api';
import type { RegisteredUserScript } from './userscripts-api';

// storage.local es el espejo de registro; el disco (gestionado por el host)
// guarda el código fuente y las sesiones de claude asociadas
const STORAGE_KEY = 'scripts';
// por qué falla cada script y cuándo se le vio ejecutar: estado volátil, aparte
// de la definición del script, que es lo duradero
const DIAGNOSTICS_KEY = 'diagnostics';
const RUNS_KEY = 'runs';

export interface ScriptRun {
	at: string;
	url: string;
}

export const loadScripts = async (): Promise<DiagonalScript[]> => {
	const stored = await browser.storage.local.get(STORAGE_KEY);
	return (stored[STORAGE_KEY] as DiagonalScript[] | undefined) ?? [];
};

export const saveScripts = async (scripts: DiagonalScript[]): Promise<void> =>
	browser.storage.local.set({ [STORAGE_KEY]: scripts });

export const loadDiagnostics = async (): Promise<ScriptDiagnostic[]> => {
	const stored = await browser.storage.local.get(DIAGNOSTICS_KEY);
	return (stored[DIAGNOSTICS_KEY] as ScriptDiagnostic[] | undefined) ?? [];
};

// se guardan los últimos de cada script: el historial sirve para ver un patrón,
// no para archivarlo entero
export const recordDiagnostic = async (diagnostic: ScriptDiagnostic): Promise<void> => {
	const all = await loadDiagnostics();
	const mine = [diagnostic, ...all.filter((d) => d.scriptId === diagnostic.scriptId)].slice(0, MAX_DIAGNOSTICS_PER_SCRIPT);
	await browser.storage.local.set({
		[DIAGNOSTICS_KEY]: [...mine, ...all.filter((d) => d.scriptId !== diagnostic.scriptId)],
	});
};

export const clearDiagnostics = async (scriptId: string, kind?: DiagnosticKind): Promise<void> => {
	const all = await loadDiagnostics();
	await browser.storage.local.set({
		[DIAGNOSTICS_KEY]: all.filter((d) => d.scriptId !== scriptId || (kind !== undefined && d.kind !== kind)),
	});
};

export const loadRuns = async (): Promise<Record<string, ScriptRun>> => {
	const stored = await browser.storage.local.get(RUNS_KEY);
	return (stored[RUNS_KEY] as Record<string, ScriptRun> | undefined) ?? {};
};

// la última ejecución observada distingue "falló" de "no llegó a ejecutarse"
export const recordRun = async (scriptId: string, url: string): Promise<void> =>
	browser.storage.local.set({ [RUNS_KEY]: { ...(await loadRuns()), [scriptId]: { at: new Date().toISOString(), url } } });

const toRegistered = (script: DiagonalScript): RegisteredUserScript => ({
	id: script.id,
	matches: script.matches.map(normalizeMatchPattern),
	js: [{ code: instrument(script) }],
	runAt: 'document_idle',
	world: 'USER_SCRIPT',
	worldId: script.id,
});

const invalidPatterns = (script: DiagonalScript): string[] => script.matches.filter((p) => !isValidMatchPattern(p));

const registrationFailed = (script: DiagonalScript, message: string): Promise<void> =>
	recordDiagnostic({ scriptId: script.id, kind: 'registration', message, at: new Date().toISOString() });

// resincronización completa e idempotente: firefox borra los registros al
// actualizar la extensión, así que se reconstruyen desde el espejo
export const syncRegistrations = async (): Promise<void> => {
	const api = userScriptsApi();
	if (!api) return;
	const failsToParse = new Set((await loadDiagnostics()).filter((d) => d.kind === 'syntax').map((d) => d.scriptId));
	// registrar código que no compila sería mudo: ni el envoltorio llega a correr
	const enabled = (await loadScripts()).filter((script) => script.enabled && !failsToParse.has(script.id));
	await api.unregister().catch(() => undefined);

	// register() es atómico: un solo patrón inválido dejaría sin registrar también
	// a todos los demás, así que los rotos se apartan antes de llamar
	const broken = enabled.filter((script) => script.matches.length === 0 || invalidPatterns(script).length > 0);
	await Promise.all(
		broken.map((script) =>
			registrationFailed(
				script,
				script.matches.length === 0
					? 'the script declares no @match line, so it is never registered on any page'
					: `invalid @match patterns: ${invalidPatterns(script).join(', ')}`,
			),
		),
	);

	const valid = enabled.filter((script) => !broken.includes(script));
	if (valid.length === 0) return;

	// cada script en su propio mundo: los mensajes llegan atribuidos por worldId y
	// los listeners de error de uno no ven los fallos de otro
	await Promise.all(valid.map((script) => api.configureWorld({ worldId: script.id, messaging: true })));

	try {
		await api.register(valid.map(toRegistered));
		await Promise.all(valid.map((script) => clearDiagnostics(script.id, 'registration')));
	} catch (error) {
		// el lote cayó por culpa de alguno: se reintenta uno a uno para que un
		// script roto no arrastre a los sanos y quede identificado
		console.warn('[diagonal] registro en lote fallido, aislando', error);
		await Promise.all(
			valid.map(async (script) => {
				try {
					await api.register([toRegistered(script)]);
					await clearDiagnostics(script.id, 'registration');
				} catch (individual) {
					await registrationFailed(script, individual instanceof Error ? individual.message : String(individual));
				}
			}),
		);
	}
};

// register() solo actúa en la siguiente navegación, así que sin esto activar o
// desactivar un script no se nota hasta recargar la pestaña
export const applyToOpenTabs = async (script: DiagonalScript): Promise<void> => {
	const api = userScriptsApi();
	if (!api) return;
	const tabIds = (await browser.tabs.query({}))
		.filter((tab) => tab.url && matchesUrl(script, tab.url))
		.map((tab) => tab.id)
		.filter((id): id is number => id !== undefined);

	if (!script.enabled) {
		// lo que el script ya tocó del dom no tiene deshacer genérico: recargar es
		// la única forma honesta de dejar la página como si nunca hubiera corrido
		await Promise.all(tabIds.map((tabId) => browser.tabs.reload(tabId)));
		return;
	}

	await Promise.all(
		tabIds.map(async (tabId) => {
			try {
				await api.execute({
					js: [{ code: instrument(script) }],
					target: { tabId },
					world: 'USER_SCRIPT',
					worldId: script.id,
					injectImmediately: true,
				});
			} catch (error) {
				console.warn('[diagonal] inyección inmediata fallida', tabId, error);
			}
		}),
	);
};
