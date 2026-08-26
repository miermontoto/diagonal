import { cpSync, rmSync } from 'node:fs';
import { build } from 'esbuild';

// dist/ es la extensión cargable: estáticos copiados + bundles de ts
rmSync('dist', { recursive: true, force: true });
cpSync('static', 'dist', { recursive: true });

await build({
	entryPoints: {
		background: 'src/background/index.ts',
		'sidebar/sidebar': 'src/sidebar/sidebar.ts',
	},
	bundle: true,
	format: 'iife',
	target: 'firefox136',
	outdir: 'dist',
	logLevel: 'info',
});
