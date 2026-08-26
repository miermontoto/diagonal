import type { HostRequest } from '@diagonal/shared';
import { readFrames, writeFrame } from './framing.js';
import { handleRequest } from './router.js';
import { ensureDir } from './store.js';

// stdout es el canal del protocolo con firefox; los logs van por stderr,
// visibles en la consola del navegador al depurar el host
ensureDir();
readFrames(process.stdin, (message) => {
	void handleRequest(message as HostRequest, (event) => writeFrame(process.stdout, event));
});
