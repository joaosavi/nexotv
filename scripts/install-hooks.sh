#!/bin/sh
# install-hooks.sh
# Instala os git hooks do projeto no repositório local.
# Rodar após clonar em um novo computador: sh scripts/install-hooks.sh

set -e

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOKS_DIR="$REPO_ROOT/.git/hooks"

echo "==> Instalando git hooks em $HOOKS_DIR..."

# pre-commit: bloqueia arquivos dev-only fora da branch 'dev'
cat > "$HOOKS_DIR/pre-commit" << 'HOOK'
#!/bin/sh
# pre-commit hook: blocks dev-only files from being committed outside 'dev' branch

CURRENT_BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null)

if [ "$CURRENT_BRANCH" = "dev" ]; then
  exit 0
fi

DEV_ONLY_PATTERNS="CLAUDE.md .claude/ beamup.json tmp/beamup-config tmp/plans"

FOUND=""
for pattern in $DEV_ONLY_PATTERNS; do
  if git diff --cached --name-only | grep -q "^$pattern"; then
    FOUND="$FOUND\n  $pattern"
  fi
done

if [ -n "$FOUND" ]; then
  echo ""
  echo "ERROR: Dev-only files staged on branch '$CURRENT_BRANCH':"
  printf "$FOUND\n"
  echo ""
  echo "These files must only exist on the 'dev' branch."
  echo "Unstage them with: git restore --staged <file>"
  echo ""
  exit 1
fi

exit 0
HOOK

chmod +x "$HOOKS_DIR/pre-commit"
echo "    pre-commit hook instalado."
echo ""
echo "==> Hooks instalados com sucesso!"
