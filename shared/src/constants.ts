// nombre del host nativo, debe coincidir con el manifest de native messaging
export const NATIVE_HOST_NAME = 'info.mier.diagonal';

// id de la extensión declarado en browser_specific_settings.gecko
export const EXTENSION_ID = 'diagonal@mier.info';

// versión del protocolo extensión ↔ host, para detectar desajustes tras updates
export const PROTOCOL_VERSION = 1;

// firefox limita las tramas host → extensión a 1 MiB; margen para overhead json
export const MAX_FRAME_BYTES = 1024 * 1024;
export const SAFE_FRAME_BYTES = MAX_FRAME_BYTES - 16 * 1024;

// modelo por defecto: sonnet consume la ventana de la suscripción más despacio
export const DEFAULT_MODEL = 'sonnet';

// variables de entorno que desviarían el gasto a facturación por api;
// el host las purga antes de lanzar claude code para garantizar uso por suscripción
export const BILLING_ENV_BLOCKLIST: readonly string[] = [
	'ANTHROPIC_API_KEY',
	'ANTHROPIC_AUTH_TOKEN',
	'ANTHROPIC_BASE_URL',
	'CLAUDE_CODE_USE_BEDROCK',
	'CLAUDE_CODE_USE_VERTEX',
];

// tope del resumen de dom que se envía como contexto al modelo
export const MAX_DOM_DIGEST_CHARS = 4000;

// historial de fallos por script: suficiente para ver un patrón, no tanto como
// para inflar el prompt de diagnóstico
export const MAX_DIAGNOSTICS_PER_SCRIPT = 5;

// instantánea de dom que acompaña al diagnóstico, más rica que el digest
export const MAX_DOM_SNAPSHOT_CHARS = 12000;

// la captura se reescala y recomprime hasta caber: base64 infla un 33%, así que
// el presupuesto en bytes se fija bien por debajo del límite de trama
export const SCREENSHOT_MAX_WIDTH = 1024;
export const SCREENSHOT_QUALITIES: readonly number[] = [0.6, 0.45, 0.3];
export const MAX_SCREENSHOT_BYTES = 512 * 1024;

// segunda pasada del autochequeo: los efectos que dependen de MutationObserver
// no están aplicados todavía en document_idle
export const VERIFY_RECHECK_MS = 1500;
