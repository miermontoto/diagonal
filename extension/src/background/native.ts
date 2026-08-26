import { NATIVE_HOST_NAME } from '@diagonal/shared';
import type { HostEvent, HostRequest } from '@diagonal/shared';

// puente con el host nativo: un único puerto persistente y correlación por id.
// el listener devuelve true cuando el evento es terminal para su petición.
type EventListener = (event: HostEvent) => boolean;

let port: browser.runtime.Port | undefined;
const listeners = new Map<string, EventListener>();
let onDisconnected: (() => void) | undefined;

export const onDisconnect = (handler: () => void): void => {
	onDisconnected = handler;
};

const ensurePort = (): browser.runtime.Port => {
	if (port) return port;
	port = browser.runtime.connectNative(NATIVE_HOST_NAME);
	port.onMessage.addListener((raw) => {
		const event = raw as HostEvent;
		const listener = listeners.get(event.id);
		if (listener?.(event)) listeners.delete(event.id);
	});
	port.onDisconnect.addListener(() => {
		port = undefined;
		// las peticiones en vuelo no van a recibir respuesta: resolverlas con error
		const pending = [...listeners.entries()];
		listeners.clear();
		pending.forEach(([id, listener]) => listener({ id, type: 'error', message: 'host disconnected' }));
		onDisconnected?.();
	});
	return port;
};

export const request = (req: HostRequest, onEvent: EventListener): void => {
	listeners.set(req.id, onEvent);
	try {
		ensurePort().postMessage(req);
	} catch (error) {
		listeners.delete(req.id);
		onEvent({ id: req.id, type: 'error', message: String(error) });
	}
};

// atajo para peticiones de un solo evento de respuesta
export const requestOne = (req: HostRequest): Promise<HostEvent> =>
	new Promise((resolve) => {
		request(req, (event) => {
			resolve(event);
			return true;
		});
	});
