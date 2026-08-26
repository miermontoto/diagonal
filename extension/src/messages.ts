import type { AuthState, DiagonalScript } from '@diagonal/shared';

// estado agregado que el background empuja a la sidebar tras cada cambio
export interface UiState {
	scripts: DiagonalScript[];
	host: 'connecting' | 'ready' | 'missing';
	auth: AuthState;
	busy: boolean;
}

export type SidebarToBackground =
	| { type: 'ui:init' }
	| { type: 'ui:generate'; prompt: string }
	| { type: 'ui:approve'; scriptId: string }
	| { type: 'ui:discard'; scriptId: string }
	| { type: 'ui:toggle'; scriptId: string; enabled: boolean }
	| { type: 'ui:delete'; scriptId: string }
	| { type: 'ui:permissions-changed' };

export type BackgroundToSidebar =
	| { type: 'ui:state'; state: UiState }
	| { type: 'ui:chunk'; text: string }
	| { type: 'ui:proposal'; script: DiagonalScript }
	| { type: 'ui:error'; message: string };
