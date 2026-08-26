// api userScripts de mv3 (firefox 136+): aún sin tipos publicados en
// @types/firefox-webext-browser, de ahí este acceso tipado a mano
export interface RegisteredUserScript {
	id: string;
	matches: string[];
	js: Array<{ code: string } | { file: string }>;
	runAt?: 'document_start' | 'document_end' | 'document_idle';
	world?: 'USER_SCRIPT' | 'MAIN';
	allFrames?: boolean;
}

interface UserScriptsNamespace {
	register(scripts: RegisteredUserScript[]): Promise<void>;
	update(scripts: RegisteredUserScript[]): Promise<void>;
	unregister(filter?: { ids?: string[] }): Promise<void>;
	getScripts(filter?: { ids?: string[] }): Promise<RegisteredUserScript[]>;
}

// el namespace solo existe cuando el permiso opcional está concedido
export const userScriptsApi = (): UserScriptsNamespace | undefined =>
	(browser as unknown as { userScripts?: UserScriptsNamespace }).userScripts;
