import { MAX_SCREENSHOT_BYTES, SCREENSHOT_MAX_WIDTH, SCREENSHOT_QUALITIES } from '@diagonal/shared';
import type { PageContext, PageEvidence } from '@diagonal/shared';

// se serializa y ejecuta dentro de la página, por lo que no puede referenciar
// nada del módulo: constantes y helpers deben vivir dentro de la función
const capturePage = (): { digest: string } => {
	const MAX_DIGEST_CHARS = 4000;
	const MAX_CLASSES = 3;
	const describe = (el: Element): string => {
		const id = el.id ? `#${el.id}` : '';
		const classes = [...el.classList].slice(0, MAX_CLASSES).map((c) => `.${c}`).join('');
		return `${el.tagName.toLowerCase()}${id}${classes}`;
	};
	const seen = new Set<string>();
	const lines: string[] = [];
	let length = 0;
	for (const el of document.querySelectorAll('header, nav, main, footer, aside, form, table, [id], [class]')) {
		const line = describe(el);
		if (seen.has(line)) continue;
		length += line.length + 1;
		if (length > MAX_DIGEST_CHARS) break;
		seen.add(line);
		lines.push(line);
	}
	return { digest: lines.join('\n') };
};

// captura url, título y un resumen estructural de la pestaña activa; el digest
// es opcional porque requiere permiso de host sobre el sitio
export const captureContext = async (): Promise<PageContext | undefined> => {
	const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
	if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) return undefined;

	const context: PageContext = { url: tab.url, title: tab.title ?? '' };
	try {
		// los tipos publicados declaran func como () => void; la api real devuelve el resultado
		const [result] = await browser.scripting.executeScript({
			target: { tabId: tab.id },
			func: capturePage as unknown as () => void,
		});
		const digest = (result?.result as { digest?: string } | undefined)?.digest;
		if (digest) context.digest = digest;
	} catch (error) {
		// sin permiso de host no hay digest; la generación sigue con url y título
		console.warn('[diagonal] captura de dom no disponible', error);
	}
	return context;
};

// instantánea de dom para diagnosticar: más completa que el digest de generación,
// sin scripts, estilos ni vectores, que solo gastarían tokens. también se
// serializa, así que sus constantes viven dentro
const capturePageDom = (): { dom: string } => {
	const MAX_DOM_CHARS = 12000;
	const NOISE = 'script, style, noscript, svg, iframe, link, meta';
	const clone = document.body.cloneNode(true) as HTMLElement;
	clone.querySelectorAll(NOISE).forEach((el) => el.remove());
	const html = clone.outerHTML.replace(/\s+/g, ' ').trim();
	return { dom: html.length > MAX_DOM_CHARS ? `${html.slice(0, MAX_DOM_CHARS)}…[truncado]` : html };
};

const toBase64 = async (blob: Blob): Promise<string> => {
	const bytes = new Uint8Array(await blob.arrayBuffer());
	const CHUNK = 8192;
	let binary = '';
	for (let i = 0; i < bytes.length; i += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
	}
	return btoa(binary);
};

// reescala y recomprime hasta que la imagen quepa en una trama de native
// messaging; el reescalado además abarata la imagen en tokens
const shrink = async (dataUrl: string): Promise<string | undefined> => {
	const source = await createImageBitmap(await (await fetch(dataUrl)).blob());
	const scale = Math.min(1, SCREENSHOT_MAX_WIDTH / source.width);
	const canvas = new OffscreenCanvas(Math.round(source.width * scale), Math.round(source.height * scale));
	const context = canvas.getContext('2d');
	if (!context) return undefined;
	context.drawImage(source, 0, 0, canvas.width, canvas.height);

	for (const quality of SCREENSHOT_QUALITIES) {
		const encoded = await canvas.convertToBlob({ type: 'image/jpeg', quality });
		if (encoded.size <= MAX_SCREENSHOT_BYTES) return toBase64(encoded);
	}
	console.warn('[diagonal] captura descartada: no baja del presupuesto de trama');
	return undefined;
};

// evidencia de la pestaña activa para que el modelo juzgue si el script cumple
// lo que se le pidió; cada pieza es opcional y depende de permisos concedidos
export const captureEvidence = async (): Promise<PageEvidence | undefined> => {
	const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
	if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) return undefined;

	const evidence: PageEvidence = { url: tab.url, title: tab.title ?? '' };
	try {
		const [result] = await browser.scripting.executeScript({
			target: { tabId: tab.id },
			func: capturePageDom as unknown as () => void,
		});
		evidence.dom = (result?.result as { dom?: string } | undefined)?.dom;
	} catch (error) {
		console.warn('[diagonal] instantánea de dom no disponible', error);
	}

	try {
		evidence.screenshot = await shrink(await browser.tabs.captureVisibleTab());
	} catch (error) {
		// captureVisibleTab exige permiso de host sobre el sitio
		console.warn('[diagonal] captura de pantalla no disponible', error);
	}
	return evidence;
};
