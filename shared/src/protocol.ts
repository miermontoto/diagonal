import type { DiagonalScript, PageContext, PageEvidence, ScriptDiagnostic } from './userscript.js';

// peticiones extensión → host, correladas por id
export type HostRequest =
	| { id: string; type: 'status' }
	// resume encadena el turno con la conversación en curso de la sidebar
	| { id: string; type: 'generate'; prompt: string; context: PageContext; resume?: string }
	// reprompt sobre un script existente: el host reanuda su sesión de claude si la hay
	| {
			id: string;
			type: 'refine';
			script: DiagonalScript;
			prompt: string;
			context: PageContext;
			// por qué falla y qué se ve en la página: solo viajan al diagnosticar
			diagnostics?: ScriptDiagnostic[];
			evidence?: PageEvidence;
	  }
	// el host solo escribe en disco cuando se le pide: las propuestas viven en la extensión
	| { id: string; type: 'save'; script: DiagonalScript }
	// comprobación de sintaxis sin efectos: el host tiene un parser, la extensión no
	| { id: string; type: 'check'; code: string }
	| { id: string; type: 'list' }
	| { id: string; type: 'delete'; scriptId: string };

export type AuthState = 'subscription' | 'missing' | 'unknown';

// eventos host → extensión; una petición puede producir varios (streaming)
export type HostEvent =
	| { id: string; type: 'status'; version: number; auth: AuthState; scriptsDir: string }
	| { id: string; type: 'chunk'; text: string }
	| { id: string; type: 'script'; script: DiagonalScript }
	| { id: string; type: 'list'; scripts: DiagonalScript[] }
	| { id: string; type: 'ok' }
	// resultado de 'check': message solo viene cuando el código no compila
	| { id: string; type: 'check'; ok: boolean; message?: string; line?: number }
	| { id: string; type: 'error'; message: string };
