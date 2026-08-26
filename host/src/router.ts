import { PROTOCOL_VERSION } from '@diagonal/shared';
import type { HostEvent, HostRequest } from '@diagonal/shared';
import { authState, generateScript } from './claude.js';
import { deleteScript, listScripts, scriptsDir } from './store.js';

// despacha cada petición y emite sus eventos; el error handling vive aquí para
// que ninguna petición pueda tumbar el proceso del host
export const handleRequest = async (request: HostRequest, emit: (event: HostEvent) => void): Promise<void> => {
	const { id } = request;
	try {
		switch (request.type) {
			case 'status':
				emit({ id, type: 'status', version: PROTOCOL_VERSION, auth: authState(), scriptsDir });
				return;
			case 'list':
				emit({ id, type: 'list', scripts: listScripts() });
				return;
			case 'delete':
				deleteScript(request.scriptId);
				emit({ id, type: 'ok' });
				return;
			case 'generate': {
				const script = await generateScript(request.prompt, request.context, (text) =>
					emit({ id, type: 'chunk', text }),
				);
				emit({ id, type: 'script', script });
				return;
			}
		}
	} catch (error) {
		console.error('[diagonal] petición fallida', request.type, error);
		emit({ id, type: 'error', message: error instanceof Error ? error.message : String(error) });
	}
};
