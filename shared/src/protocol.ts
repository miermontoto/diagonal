import type { DiagonalScript, PageContext } from './userscript.js';

// peticiones extensión → host, correladas por id
export type HostRequest =
	| { id: string; type: 'status' }
	| { id: string; type: 'generate'; prompt: string; context: PageContext }
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
	| { id: string; type: 'error'; message: string };
