// api userScripts de mv3 (firefox 136+): aún sin tipos publicados en
// @types/firefox-webext-browser, de ahí este acceso tipado a mano
export interface RegisteredUserScript {
	id: string;
	matches: string[];
	js: Array<{ code: string } | { file: string }>;
	runAt?: 'document_start' | 'document_end' | 'document_idle';
	world?: 'USER_SCRIPT' | 'MAIN';
	// un mundo por script: aísla sus listeners y atribuye sus mensajes
	worldId?: string;
	allFrames?: boolean;
}

export interface WorldProperties {
	worldId?: string;
	csp?: string;
	// expone runtime.sendMessage dentro del mundo; sin esto un fallo es mudo
	messaging?: boolean;
}

export interface UserScriptInjection {
	js: Array<{ code: string } | { file: string }>;
	target: { tabId: number; frameIds?: number[]; allFrames?: boolean };
	world?: 'USER_SCRIPT' | 'MAIN';
	worldId?: string;
	injectImmediately?: boolean;
}

interface UserScriptsNamespace {
	register(scripts: RegisteredUserScript[]): Promise<void>;
	update(scripts: RegisteredUserScript[]): Promise<void>;
	unregister(filter?: { ids?: string[] }): Promise<void>;
	getScripts(filter?: { ids?: string[] }): Promise<RegisteredUserScript[]>;
	execute(injection: UserScriptInjection): Promise<Array<{ error?: string }>>;
	configureWorld(properties: WorldProperties): Promise<void>;
	resetWorldConfiguration(worldId?: string): Promise<void>;
}

// el namespace solo existe cuando el permiso opcional está concedido
export const userScriptsApi = (): UserScriptsNamespace | undefined =>
	(browser as unknown as { userScripts?: UserScriptsNamespace }).userScripts;
