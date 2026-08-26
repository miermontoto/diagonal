import type { DiagonalScript } from '@diagonal/shared';
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

browser.runtime.onConnect.addListener((sidebar) => {
	const post = (message: BackgroundToSidebar): void => sidebar.postMessage(message);
	const pushState = async (): Promise<void> => post({ type: 'ui:state', state: await buildState() });

	const handlers: { [T in SidebarToBackground['type']]: (msg: Extract<SidebarToBackground, { type: T }>) => Promise<void> } = {
		'ui:init': async () => {
			await refreshHostStatus();
			await pushState();
		},

		'ui:generate': async ({ prompt }) => {
			busy = true;
			await pushState();
			const context = (await captureContext()) ?? { url: '', title: '' };
			request({ id: crypto.randomUUID(), type: 'generate', prompt, context }, (event) => {
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
		},

		'ui:approve': async ({ scriptId }) => {
			if (pending?.id !== scriptId) return;
			const approved = { ...pending, enabled: true };
			pending = undefined;
			await saveScripts([approved, ...(await loadScripts())]);
			await syncRegistrations();
			await pushState();
		},

		'ui:discard': async ({ scriptId }) => {
			pending = undefined;
			// la propuesta ya está en disco: pedir al host que la elimine
			await requestOne({ id: crypto.randomUUID(), type: 'delete', scriptId });
			await pushState();
		},

		'ui:toggle': async ({ scriptId, enabled }) => {
			const scripts = (await loadScripts()).map((s) => (s.id === scriptId ? { ...s, enabled } : s));
			await saveScripts(scripts);
			await syncRegistrations();
			await pushState();
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
