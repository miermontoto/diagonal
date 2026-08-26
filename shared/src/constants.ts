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
