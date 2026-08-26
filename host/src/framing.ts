import type { Readable, Writable } from 'node:stream';
import { SAFE_FRAME_BYTES } from '@diagonal/shared';

// framing de native messaging: prefijo de 4 bytes little-endian con la longitud del json
const LENGTH_PREFIX_BYTES = 4;

export const writeFrame = (out: Writable, message: unknown): void => {
	const payload = Buffer.from(JSON.stringify(message), 'utf8');
	if (payload.length > SAFE_FRAME_BYTES) {
		// firefox corta la conexión al superar 1 MiB; mejor descartar con contexto que morir
		console.error(`[diagonal] trama descartada por tamaño: ${payload.length} bytes`);
		return;
	}
	const header = Buffer.alloc(LENGTH_PREFIX_BYTES);
	header.writeUInt32LE(payload.length, 0);
	out.write(Buffer.concat([header, payload]));
};

export const readFrames = (input: Readable, onMessage: (message: unknown) => void): void => {
	let buffer = Buffer.alloc(0);
	input.on('data', (chunk: Buffer) => {
		buffer = Buffer.concat([buffer, chunk]);
		while (buffer.length >= LENGTH_PREFIX_BYTES) {
			const length = buffer.readUInt32LE(0);
			if (buffer.length < LENGTH_PREFIX_BYTES + length) break;
			const payload = buffer.subarray(LENGTH_PREFIX_BYTES, LENGTH_PREFIX_BYTES + length);
			buffer = buffer.subarray(LENGTH_PREFIX_BYTES + length);
			try {
				onMessage(JSON.parse(payload.toString('utf8')));
			} catch (error) {
				console.error('[diagonal] trama ilegible', error);
			}
		}
	});
	// firefox cierra stdin al desconectar el puerto: terminar limpiamente
	input.on('end', () => process.exit(0));
};
