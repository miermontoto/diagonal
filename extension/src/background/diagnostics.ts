import { clearDiagnostics, recordDiagnostic, recordRun } from './registry';

// lo que manda el envoltorio de instrument() desde el mundo aislado del script
interface ScriptReport {
	__diagonal: true;
	scriptId: string;
	kind: 'runtime' | 'ran' | 'verified';
	message?: string;
	stack?: string;
	line?: number;
	column?: number;
	verified?: boolean;
}

interface UserScriptSender {
	userScriptWorldId?: string;
	tab?: { url?: string };
}

interface UserScriptMessageEvent {
	addListener(callback: (message: unknown, sender: UserScriptSender) => void): void;
}

// runtime.onUserScriptMessage (firefox 136+): los mensajes del mundo USER_SCRIPT
// llegan por su propio evento, no por onMessage, al ser un contexto menos fiable
const userScriptMessages = (): UserScriptMessageEvent | undefined =>
	(browser.runtime as unknown as { onUserScriptMessage?: UserScriptMessageEvent }).onUserScriptMessage;

const handle = async (report: ScriptReport, url: string): Promise<void> => {
	const at = new Date().toISOString();
	if (report.kind === 'ran') return recordRun(report.scriptId, url);
	if (report.kind === 'runtime') {
		return recordDiagnostic({
			scriptId: report.scriptId,
			kind: 'runtime',
			message: report.message ?? 'script threw with no message',
			at,
			url,
			stack: report.stack,
			line: report.line,
			column: report.column,
		});
	}
	// undefined significa que el script no declara autochequeo: no hay nada que afirmar
	if (report.verified === undefined) return;
	if (report.verified) return clearDiagnostics(report.scriptId, 'verify');
	return recordDiagnostic({
		scriptId: report.scriptId,
		kind: 'verify',
		message: 'the script ran without errors, but its own @diagonal-verify check does not find the intended effect in the page',
		at,
		url,
	});
};

export const listenForScriptReports = (onRecorded: () => void): void => {
	const event = userScriptMessages();
	if (!event) {
		console.warn('[diagonal] runtime.onUserScriptMessage no disponible: sin diagnóstico en vivo');
		return;
	}
	event.addListener((raw, sender) => {
		const report = raw as ScriptReport | undefined;
		if (report?.__diagonal !== true) return;
		void handle(report, sender.tab?.url ?? '').then(onRecorded);
	});
};
