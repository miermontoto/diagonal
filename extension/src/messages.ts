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
	// reprompt: code es lo que se ve en el panel, que puede ser una propuesta sin
	// aprobar o una edición a mano, y por tanto adelantar a lo guardado
	| { type: 'ui:refine'; scriptId: string; prompt: string; code: string }
	// edición a mano del código desde el panel de detalle
	| { type: 'ui:save'; scriptId: string; code: string }
	// approve lleva code porque la propuesta también es editable antes de aceptarla
	| { type: 'ui:approve'; scriptId: string; code: string }
	| { type: 'ui:discard'; scriptId: string }
	| { type: 'ui:toggle'; scriptId: string; enabled: boolean }
	| { type: 'ui:delete'; scriptId: string }
	| { type: 'ui:permissions-changed' };

export type BackgroundToSidebar =
	| { type: 'ui:state'; state: UiState }
	| { type: 'ui:chunk'; text: string }
	| { type: 'ui:proposal'; script: DiagonalScript }
	| { type: 'ui:error'; message: string };
