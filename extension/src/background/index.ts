import { applyCode } from '@diagonal/shared';
import type { DiagonalScript, HostRequest, PageContext } from '@diagonal/shared';
import type { BackgroundToSidebar, SidebarToBackground, UiState } from '../messages';
import { captureContext } from './capture';
import { onDisconnect, request, requestOne } from './native';
import { loadScripts, saveScripts, syncRegistrations } from './registry';

let hostState: UiState['host'] = 'connecting';
let auth: UiState['auth'] = 'unknown';
let busy = false;
// propuesta pendiente de revisión: no toca storage ni registro hasta aprobarse
let pending: DiagonalScript | undefined;

const buildState = async (): Promise<UiState> => ({
	scripts: await loadScripts(),
	host: hostState,
	auth,
	busy,
});

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

browser.runtime.onConnect.addListener((sidebar) => {
	const post = (message: BackgroundToSidebar): void => sidebar.postMessage(message);
	const pushState = async (): Promise<void> => post({ type: 'ui:state', state: await buildState() });

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
		await requestOne({ id: crypto.randomUUID(), type: 'save', script });
		await syncRegistrations();
		await pushState();
	};

	const handlers: { [T in SidebarToBackground['type']]: (msg: Extract<SidebarToBackground, { type: T }>) => Promise<void> } = {
		'ui:init': async () => {
			await refreshHostStatus();
			await pushState();
		},

		'ui:generate': async ({ prompt }) =>
			runGeneration((context) => ({ id: crypto.randomUUID(), type: 'generate', prompt, context })),

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
