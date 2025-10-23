#!/usr/bin/env bash
set -euo pipefail

if ! command -v git >/dev/null 2>&1; then
  echo "git doit être installé pour utiliser ce script." >&2
  exit 1
fi

current_branch="$(git rev-parse --abbrev-ref HEAD)"

if [ "$current_branch" = "HEAD" ]; then
  echo "Impossible de déterminer la branche courante (HEAD détachée)." >&2
  exit 1
fi

if git status --porcelain | grep -q '.'; then
  echo "Le répertoire contient des modifications non committées."
  echo "Merci de les valider avant de pousser (git status pour vérifier)." >&2
  exit 1
fi

echo "Poussée de la branche \"$current_branch\" vers origin..."
git push origin "$current_branch"

echo
cat <<'MSG'
Branche poussée avec succès.
1. Ouvre GitHub sur ton dépôt.
2. Clique sur "Compare & pull request" pour la branche courante.
3. Vérifie le diff, ajoute un résumé et la liste des tests exécutés.
4. Soumets la PR ou fusionne-la si elle est prête.
MSG
