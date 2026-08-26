import { applyCode, matchesUrl } from '@diagonal/shared';
import type { DiagonalScript, HostRequest, PageContext, ScriptDiagnostic } from '@diagonal/shared';
import type { BackgroundToSidebar, SidebarToBackground, UiState } from '../messages';
import { captureContext, captureEvidence } from './capture';
import { listenForScriptReports } from './diagnostics';
import { onDisconnect, request, requestOne } from './native';
import {
	applyToOpenTabs,
	clearDiagnostics,
	loadDiagnostics,
	loadRuns,
	loadScripts,
	recordDiagnostic,
	saveScripts,
	syncRegistrations,
} from './registry';

let hostState: UiState['host'] = 'connecting';
let auth: UiState['auth'] = 'unknown';
let busy = false;
// propuesta pendiente de revisión: no toca storage ni registro hasta aprobarse
let pending: DiagonalScript | undefined;
// sesión de claude del hilo abierto en la sidebar: sin esto cada mensaje
// arrancaría de cero y la conversación no recordaría nada de lo anterior
let conversation: string | undefined;

const buildState = async (): Promise<UiState> => ({
	scripts: await loadScripts(),
	diagnostics: await loadDiagnostics(),
	host: hostState,
	auth,
	busy,
});

// las sidebars abiertas, para empujarles estado cuando el cambio no nace de ellas:
// un script que falla en una pestaña cualquiera, por ejemplo
const subscribers = new Set<() => Promise<void>>();
const notify = (): void => subscribers.forEach((push) => void push());

// no todo fallo deja rastro almacenado: que el script no aplique a la página que
// se está mirando, o que nunca se le haya visto correr, se deduce aquí
const collectDiagnostics = async (script: DiagonalScript, url: string): Promise<ScriptDiagnostic[]> => {
	const stored = (await loadDiagnostics()).filter((d) => d.scriptId === script.id);
	const at = new Date().toISOString();
	const derived: ScriptDiagnostic[] = [];

	if (!script.enabled) {
		derived.push({ scriptId: script.id, kind: 'registration', message: 'the script is disabled, so it is not registered', at });
	} else if (url && !matchesUrl(script, url)) {
		derived.push({
			scriptId: script.id,
			kind: 'mismatch',
			message: `the current page matches none of the script's @match patterns (${script.matches.join(', ') || 'none declared'})`,
			at,
			url,
		});
	} else if (url && !(await loadRuns())[script.id]) {
		derived.push({
			scriptId: script.id,
			kind: 'mismatch',
			message: 'the script matches this page but has never been observed running on it',
			at,
			url,
		});
	}
	return [...derived, ...stored];
};

const refreshHostStatus = async (): Promise<void> => {
	const event = await requestOne({ id: crypto.randomUUID(), type: 'status' });
	hostState = event.type === 'status' ? 'ready' : 'missing';
	auth = event.type === 'status' ? event.auth : 'unknown';
};

onDisconnect(() => {
	hostState = 'missing';
	busy = false;
});

// registro perdido tras instalar, actualizar o reiniciar: reconstruir siempre
browser.runtime.onInstalled.addListener(() => void syncRegistrations());
browser.runtime.onStartup.addListener(() => void syncRegistrations());
// y en cuanto se concede el permiso, registrar lo que hubiera pendiente
browser.permissions.onAdded.addListener(() => void syncRegistrations());

// el botón de la barra abre y cierra el panel. toggle() exige un gesto de usuario:
// hay que llamarlo síncronamente dentro del handler, sin await previo, o firefox lo rechaza
browser.action.onClicked.addListener(() => void browser.sidebarAction.toggle());

// los scripts instrumentados reportan desde su mundo aislado en cualquier momento
listenForScriptReports(notify);

browser.runtime.onConnect.addListener((sidebar) => {
	const post = (message: BackgroundToSidebar): void => sidebar.postMessage(message);
	const pushState = async (): Promise<void> => post({ type: 'ui:state', state: await buildState() });
	subscribers.add(pushState);
	sidebar.onDisconnect.addListener(() => subscribers.delete(pushState));

	// generar y reprompt comparten ciclo: streaming al chat y propuesta al cerrar
	const runGeneration = async (build: (context: PageContext) => HostRequest): Promise<void> => {
		busy = true;
		await pushState();
		const context = (await captureContext()) ?? { url: '', title: '' };
		request(build(context), (event) => {
			if (event.type === 'chunk') {
				post({ type: 'ui:chunk', text: event.text });
				return false;
			}
			busy = false;
			if (event.type === 'script') {
				pending = event.script;
				conversation = event.script.sessionId ?? conversation;
				post({ type: 'ui:proposal', script: event.script });
			} else if (event.type === 'error') {
				post({ type: 'ui:error', message: event.message });
			}
			void pushState();
			return true;
		});
	};

	// persiste en el espejo y en disco, y reajusta el registro a los nuevos @match
	const commit = async (script: DiagonalScript, scripts: DiagonalScript[]): Promise<void> => {
		await saveScripts(scripts);

		// el host tiene el único parser del proyecto: se le pregunta antes de
		// registrar, porque un script que no compila fallaría en silencio
		const checked = await requestOne({ id: crypto.randomUUID(), type: 'check', code: script.code });
		// si el host no contesta no se sabe nada nuevo: el diagnóstico previo sigue
		// siendo la mejor información, así que solo se toca con una respuesta real
		if (checked.type !== 'check') {
			console.warn('[diagonal] sin comprobación de sintaxis: host no disponible');
		} else if (!checked.ok) {
			await recordDiagnostic({
				scriptId: script.id,
				kind: 'syntax',
				message: checked.message ?? 'the script does not parse',
				at: new Date().toISOString(),
				line: checked.line,
			});
		} else {
			await clearDiagnostics(script.id, 'syntax');
		}

		await requestOne({ id: crypto.randomUUID(), type: 'save', script });
		await syncRegistrations();
		// el registro solo alcanza a la próxima navegación: las pestañas abiertas
		// se atienden aparte para que activar o desactivar se note al momento
		await applyToOpenTabs(script);
		await pushState();
	};

	const handlers: { [T in SidebarToBackground['type']]: (msg: Extract<SidebarToBackground, { type: T }>) => Promise<void> } = {
		'ui:init': async () => {
			await refreshHostStatus();
			await pushState();
		},

		'ui:generate': async ({ prompt }) =>
			runGeneration((context) => ({ id: crypto.randomUUID(), type: 'generate', prompt, context, resume: conversation })),

		'ui:refine': async ({ scriptId, prompt, code }) => {
			// una propuesta encadena reprompts antes de aprobarse, así que también cuenta
			const base = (await loadScripts()).find((s) => s.id === scriptId) ?? (pending?.id === scriptId ? pending : undefined);
			if (!base) return;
			await runGeneration((context) => ({
				id: crypto.randomUUID(),
				type: 'refine',
				script: { ...base, code },
				prompt,
				context,
			}));
		},

		'ui:diagnose': async ({ scriptId }) => {
			const script = (await loadScripts()).find((s) => s.id === scriptId);
			if (!script) return;
			// se recoge antes de arrancar la generación: la pestaña puede cambiar
			const evidence = await captureEvidence();
			const diagnostics = await collectDiagnostics(script, evidence?.url ?? '');
			// prompt vacío: la instrucción de arreglo la pone el host, que es donde
			// vive todo el texto dirigido al modelo
			await runGeneration((context) => ({
				id: crypto.randomUUID(),
				type: 'refine',
				script,
				prompt: '',
				context,
				diagnostics,
				evidence,
			}));
		},

		'ui:save': async ({ scriptId, code }) => {
			const scripts = await loadScripts();
			const current = scripts.find((s) => s.id === scriptId);
			if (!current) return;
			const updated = applyCode(current, code);
			await commit(updated, scripts.map((s) => (s.id === scriptId ? updated : s)));
		},

		'ui:approve': async ({ scriptId, code }) => {
			if (pending?.id !== scriptId) return;
			// se aprueba lo que el usuario tiene delante, retoques del panel incluidos
			const approved = { ...applyCode(pending, code), enabled: true };
			pending = undefined;
			// upsert por id: un reprompt aprobado reemplaza al script, no lo duplica
			const scripts = await loadScripts();
			await commit(
				approved,
				scripts.some((s) => s.id === approved.id)
					? scripts.map((s) => (s.id === approved.id ? approved : s))
					: [approved, ...scripts],
			);
		},

		'ui:discard': async ({ scriptId }) => {
			if (pending?.id !== scriptId) return;
			// nada que deshacer en disco: el host solo escribe cuando se aprueba
			pending = undefined;
			await pushState();
		},

		'ui:toggle': async ({ scriptId, enabled }) => {
			const scripts = await loadScripts();
			const updated = scripts.find((s) => s.id === scriptId);
			if (!updated) return;
			await commit({ ...updated, enabled }, scripts.map((s) => (s.id === scriptId ? { ...s, enabled } : s)));
		},

		'ui:delete': async ({ scriptId }) => {
			await saveScripts((await loadScripts()).filter((s) => s.id !== scriptId));
			await syncRegistrations();
			await requestOne({ id: crypto.randomUUID(), type: 'delete', scriptId });
			await pushState();
		},

		'ui:permissions-changed': async () => {
			await syncRegistrations();
			await pushState();
		},
	};

	sidebar.onMessage.addListener((raw) => {
		const message = raw as SidebarToBackground;
		void handlers[message.type](message as never);
	});
});
