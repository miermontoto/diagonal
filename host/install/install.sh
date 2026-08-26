#!/bin/sh
# instala el manifest de native messaging apuntando al host compilado.
# los navegadores gecko lanzan los hosts con un entorno mínimo, así que el
# lanzador fija la ruta absoluta y persistente de node: se resuelve el symlink
# porque gestores como fnm exponen node vía shims efímeros por sesión.
set -eu

HOST_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="$(readlink -f "$(command -v node)")"
LAUNCHER="$HOST_DIR/bin/diagonal-host"
HOST_NAME="info.mier.diagonal"
EXTENSION_ID="diagonal@mier.info"

[ -f "$HOST_DIR/dist/index.js" ] || { echo "error: compila el host primero (pnpm --filter @diagonal/host build)" >&2; exit 1; }

mkdir -p "$HOST_DIR/bin"

cat > "$LAUNCHER" <<EOF
#!/bin/sh
exec "$NODE_BIN" "$HOST_DIR/dist/index.js"
EOF
chmod +x "$LAUNCHER"

# cada navegador gecko busca el manifest bajo su directorio de usuario:
# firefox y forks con MOZ_USER_DIR=.mozilla (zen del AUR incluido) usan
# ~/.mozilla; zen oficial usa ~/.zen; librewolf usa ~/.librewolf
installed=0
for base in "$HOME/.mozilla" "$HOME/.zen" "$HOME/.librewolf"; do
	[ -d "$base" ] || continue
	mkdir -p "$base/native-messaging-hosts"
	cat > "$base/native-messaging-hosts/$HOST_NAME.json" <<EOF
{
	"name": "$HOST_NAME",
	"description": "diagonal native host",
	"path": "$LAUNCHER",
	"type": "stdio",
	"allowed_extensions": ["$EXTENSION_ID"]
}
EOF
	echo "manifest instalado en $base/native-messaging-hosts/$HOST_NAME.json"
	installed=1
done

[ "$installed" -eq 1 ] || { echo "error: no se encontró ningún directorio de navegador gecko (~/.mozilla, ~/.zen, ~/.librewolf)" >&2; exit 1; }
echo "node: $NODE_BIN"
