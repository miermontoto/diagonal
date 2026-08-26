import { matchesUrl, type DiagonalScript } from '@diagonal/shared';
import type { BackgroundToSidebar, SidebarToBackground, UiState } from '../messages';

const t = (key: string): string => browser.i18n.getMessage(key);

// traduce los nodos marcados; el html no lleva texto hardcodeado
document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
	el.textContent = t(el.dataset.i18n ?? '');
});

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const statusDot = $('status-dot');
const statusText = $('status-text');
const onboarding = $('onboarding');
const chat = $('chat');
const proposal = $('proposal');
const proposalName = $('proposal-name');
const proposalCode = $<HTMLPreElement>('proposal-code');
const scriptsList = $<HTMLUListElement>('scripts');
const scriptsCount = $('scripts-count');
const scriptsFilter = $('scripts-filter');
const scopePage = $<HTMLInputElement>('scope-page');
const empty = $('empty');
const form = $<HTMLFormElement>('prompt-form');
const promptInput = $<HTMLTextAreaElement>('prompt');
const sendButton = $<HTMLButtonElement>('send');

promptInput.placeholder = t('promptPlaceholder');

const port = browser.runtime.connect({ name: 'diagonal-sidebar' });
const send = (message: SidebarToBackground): void => port.postMessage(message);

let currentProposal: DiagonalScript | undefined;
// último listado recibido y url de la pestaña activa: juntos deciden qué se pinta
let allScripts: DiagonalScript[] = [];
let currentUrl = '';
// burbuja en curso donde se acumula el streaming de la generación
let streamBubble: HTMLElement | undefined;

const addBubble = (kind: 'user' | 'model' | 'error', text: string): HTMLElement => {
	const bubble = document.createElement('div');
	bubble.className = `msg ${kind}`;
	bubble.textContent = text;
	chat.append(bubble);
	chat.scrollTop = chat.scrollHeight;
	return bubble;
};

// por defecto el listado se acota a los scripts que aplican a la pestaña activa
const renderScripts = (): void => {
	const visible = scopePage.checked ? allScripts.filter((script) => matchesUrl(script, currentUrl)) : allScripts;

	scriptsList.replaceChildren(
		...visible.map((script) => {
			const item = document.createElement('li');

			const toggle = document.createElement('input');
			toggle.type = 'checkbox';
			toggle.checked = script.enabled;
			toggle.addEventListener('change', () => send({ type: 'ui:toggle', scriptId: script.id, enabled: toggle.checked }));

			const name = document.createElement('span');
			name.className = 'name';
			name.textContent = script.name;
			name.title = script.description;

			const remove = document.createElement('button');
			remove.className = 'danger';
			remove.textContent = t('delete');
			remove.addEventListener('click', () => send({ type: 'ui:delete', scriptId: script.id }));

			item.append(toggle, name, remove);
			return item;
		}),
	);
	empty.hidden = visible.length > 0;
	// con scripts guardados pero ninguno aplicable, el vacío es del filtro, no del listado
	empty.textContent = t(allScripts.length === 0 ? 'emptyScripts' : 'emptyScriptsPage');
	scriptsCount.textContent = visible.length === allScripts.length ? `${allScripts.length}` : `${visible.length}/${allScripts.length}`;
};

const refreshCurrentUrl = async (): Promise<void> => {
	const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
	currentUrl = tab?.url ?? '';
	renderScripts();
};

// el filtro depende de la pestaña visible: hay que reaccionar al cambio y a la navegación
scriptsFilter.addEventListener('change', () => renderScripts());
browser.tabs.onActivated.addListener(() => void refreshCurrentUrl());
browser.tabs.onUpdated.addListener((_id, _change, tab) => {
	if (tab.active) void refreshCurrentUrl();
}, { properties: ['url'] });

const renderState = (state: UiState): void => {
	void refreshOnboarding();
	sendButton.disabled = state.busy || state.host !== 'ready';

	const status = state.host === 'connecting' ? 'statusConnecting'
		: state.host === 'missing' ? 'statusHostMissing'
		: state.auth === 'missing' ? 'statusAuthMissing'
		: 'statusReady';
	statusText.textContent = t(status);
	statusDot.className = `dot ${state.host === 'ready' && state.auth !== 'missing' ? 'ready' : 'error'}`;

	allScripts = state.scripts;
	renderScripts();
};

port.onMessage.addListener((raw) => {
	const message = raw as BackgroundToSidebar;
	switch (message.type) {
		case 'ui:state':
			renderState(message.state);
			return;
		case 'ui:chunk':
			streamBubble ??= addBubble('model', '');
			streamBubble.textContent += message.text;
			chat.scrollTop = chat.scrollHeight;
			return;
		case 'ui:proposal':
			streamBubble = undefined;
			currentProposal = message.script;
			proposalName.textContent = message.script.name;
			proposalCode.textContent = message.script.code;
			proposal.hidden = false;
			return;
		case 'ui:error':
			streamBubble = undefined;
			addBubble('error', message.message);
			return;
	}
});

form.addEventListener('submit', (event) => {
	event.preventDefault();
	const prompt = promptInput.value.trim();
	if (!prompt) return;
	addBubble('user', prompt);
	streamBubble = addBubble('model', t('generating'));
	streamBubble.textContent = '';
	promptInput.value = '';
	send({ type: 'ui:generate', prompt });
});

$('approve').addEventListener('click', () => {
	if (!currentProposal) return;
	send({ type: 'ui:approve', scriptId: currentProposal.id });
	proposal.hidden = true;
	currentProposal = undefined;
});

$('discard').addEventListener('click', () => {
	if (!currentProposal) return;
	send({ type: 'ui:discard', scriptId: currentProposal.id });
	proposal.hidden = true;
	currentProposal = undefined;
});

// userScripts es un permiso optional-only: firefox obliga a pedirlo solo, sin
// otros permisos ni origins en la misma llamada, de ahí la concesión en dos pasos.
// 'userScripts' (mv3) aún no figura en el union de permisos de los tipos publicados
const USERSCRIPTS_REQUEST = { permissions: ['userScripts'] } as unknown as browser.permissions.Permissions;
const ORIGINS_REQUEST: browser.permissions.Permissions = { origins: ['<all_urls>'] };

const grantButton = $<HTMLButtonElement>('grant');
// precalculado fuera del handler: un await antes de request() invalida el gesto
let nextGrant = USERSCRIPTS_REQUEST;

const refreshOnboarding = async (): Promise<void> => {
	const hasUserScripts = await browser.permissions.contains(USERSCRIPTS_REQUEST);
	const hasOrigins = await browser.permissions.contains(ORIGINS_REQUEST);
	onboarding.hidden = hasUserScripts && hasOrigins;
	nextGrant = hasUserScripts ? ORIGINS_REQUEST : USERSCRIPTS_REQUEST;
	grantButton.textContent = t(hasUserScripts ? 'grantOrigins' : 'grantUserScripts');
};

grantButton.addEventListener('click', () => {
	browser.permissions
		.request(nextGrant)
		.then((granted) => {
			if (granted) send({ type: 'ui:permissions-changed' });
			return refreshOnboarding();
		})
		.catch((error) => addBubble('error', String(error)));
});

send({ type: 'ui:init' });
void refreshCurrentUrl();
