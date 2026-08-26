import { matchesUrl, type DiagonalScript, type ScriptDiagnostic } from '@diagonal/shared';
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
const detailSection = $('detail');
const detailTitle = $('detail-title');
const detailName = $('detail-name');
const detailCode = $<HTMLTextAreaElement>('detail-code');
const detailIssues = $<HTMLUListElement>('detail-issues');
const approveButton = $<HTMLButtonElement>('approve');
const discardButton = $<HTMLButtonElement>('discard');
const saveButton = $<HTMLButtonElement>('save');
const diagnoseButton = $<HTMLButtonElement>('diagnose');
const closeButton = $<HTMLButtonElement>('close');
const scriptsList = $<HTMLUListElement>('scripts');
const scriptsCount = $('scripts-count');
const scopePage = $<HTMLInputElement>('scope-page');
const empty = $('empty');
const form = $<HTMLFormElement>('prompt-form');
const promptInput = $<HTMLTextAreaElement>('prompt');
const sendButton = $<HTMLButtonElement>('send');

promptInput.placeholder = t('promptPlaceholder');

const port = browser.runtime.connect({ name: 'diagonal-sidebar' });
const send = (message: SidebarToBackground): void => port.postMessage(message);

// el panel de detalle sirve dos modos sobre la misma vista de código: revisar
// lo que acaba de proponer el modelo, o editar a mano un script ya guardado
type Detail = { script: DiagonalScript; mode: 'proposal' | 'edit' };
let detail: Detail | undefined;
// último listado recibido y url de la pestaña activa: juntos deciden qué se pinta
let allScripts: DiagonalScript[] = [];
let allDiagnostics: ScriptDiagnostic[] = [];
let currentUrl = '';

const issuesOf = (scriptId: string): ScriptDiagnostic[] => allDiagnostics.filter((d) => d.scriptId === scriptId);

// el tipo se traduce; el mensaje no, porque es evidencia técnica que además
// viaja tal cual al modelo
const kindLabel = (kind: ScriptDiagnostic['kind']): string => t(`kind${kind.charAt(0).toUpperCase()}${kind.slice(1)}`);
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

// los fallos solo se listan al editar: en una propuesta aún no hay nada observado
const renderIssues = (): void => {
	const issues = detail?.mode === 'edit' ? issuesOf(detail.script.id) : [];
	detailIssues.hidden = issues.length === 0;
	detailIssues.replaceChildren(
		...issues.map((issue) => {
			const item = document.createElement('li');
			const kind = document.createElement('span');
			kind.className = 'kind';
			kind.textContent = `[${kindLabel(issue.kind)}]`;
			const text = document.createElement('span');
			// el mensaje no se traduce: es evidencia técnica, y viaja igual al modelo
			text.textContent = issue.line !== undefined ? `${issue.message} (:${issue.line})` : issue.message;
			item.append(kind, text);
			return item;
		}),
	);
};

const openDetail = (script: DiagonalScript, mode: Detail['mode']): void => {
	detail = { script, mode };
	detailTitle.textContent = t(mode === 'proposal' ? 'proposalTitle' : 'editTitle');
	detailName.textContent = script.name;
	detailCode.value = script.code;
	renderIssues();
	approveButton.hidden = mode !== 'proposal';
	discardButton.hidden = mode !== 'proposal';
	saveButton.hidden = mode !== 'edit';
	diagnoseButton.hidden = mode !== 'edit';
	closeButton.hidden = mode !== 'edit';
	detailSection.hidden = false;
	// con un script abierto, el prompt reformula ese script en vez de crear otro
	promptInput.placeholder = t('refinePlaceholder');
};

const closeDetail = (): void => {
	detail = undefined;
	detailSection.hidden = true;
	promptInput.placeholder = t('promptPlaceholder');
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

			const name = document.createElement('button');
			name.type = 'button';
			name.className = 'name';
			name.textContent = script.name;
			name.title = script.description;
			name.addEventListener('click', () => openDetail(script, 'edit'));

			const issues = issuesOf(script.id);
			const broken = document.createElement('span');
			broken.className = 'broken';
			broken.textContent = issues.length > 0 ? '!' : '';
			broken.title = issues.map((issue) => `[${kindLabel(issue.kind)}] ${issue.message}`).join('\n');

			const remove = document.createElement('button');
			remove.className = 'danger';
			remove.textContent = t('delete');
			remove.addEventListener('click', () => send({ type: 'ui:delete', scriptId: script.id }));

			item.append(toggle, name, broken, remove);
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
scopePage.addEventListener('change', () => renderScripts());
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
	allDiagnostics = state.diagnostics;
	renderScripts();
	// el detalle abierto puede estar mirando un script que acaba de fallar; se
	// repinta solo la lista de fallos para no tocar lo que se esté escribiendo
	renderIssues();
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
			openDetail(message.script, 'proposal');
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
	send(detail ? { type: 'ui:refine', scriptId: detail.script.id, prompt, code: detailCode.value } : { type: 'ui:generate', prompt });
});

approveButton.addEventListener('click', () => {
	if (detail?.mode !== 'proposal') return;
	send({ type: 'ui:approve', scriptId: detail.script.id, code: detailCode.value });
	// aprobar no termina la conversación: el script sigue abierto, así el
	// siguiente mensaje lo reformula en vez de empezar uno nuevo desde cero.
	// descartar y cerrar sí la cierran, porque ahí el usuario ya ha terminado
	openDetail({ ...detail.script, code: detailCode.value }, 'edit');
});

discardButton.addEventListener('click', () => {
	if (detail?.mode !== 'proposal') return;
	send({ type: 'ui:discard', scriptId: detail.script.id });
	closeDetail();
});

// guardar cierra el panel: es el acuse de recibo de que la edición se aplicó
saveButton.addEventListener('click', () => {
	if (detail?.mode !== 'edit') return;
	send({ type: 'ui:save', scriptId: detail.script.id, code: detailCode.value });
	closeDetail();
});

// arreglar: manda los fallos observados y lo que se ve de la página, y el
// resultado vuelve como propuesta a revisar igual que cualquier otra
diagnoseButton.addEventListener('click', () => {
	if (detail?.mode !== 'edit') return;
	addBubble('user', t('diagnose'));
	streamBubble = addBubble('model', '');
	send({ type: 'ui:diagnose', scriptId: detail.script.id });
});

closeButton.addEventListener('click', () => closeDetail());

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
