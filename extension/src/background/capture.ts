import type { PageContext } from '@diagonal/shared';

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
