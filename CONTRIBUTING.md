# Contribution & Maintenance Guide

Ce dépôt est souvent utilisé pour des démonstrations rapides. Afin de garder l'historique propre avant une présentation ou un rendu universitaire, suivez ces étapes après avoir terminé votre travail local :

## 1. Vérifier l'état local
```bash
npm run lint
npm run test
npm run e2e
```
Assurez-vous que toutes les commandes passent avant de publier.

## 2. Pousser la branche courante
Utilisez le script automatisé fourni :
```bash
./scripts/publish-current-branch.sh
```
Le script bloque si des fichiers ne sont pas commités et rappelle la commande `git push origin HEAD` en cas de succès.

## 3. Nettoyer les Pull Requests sur GitHub
1. Ouvrez l'onglet **Pull requests** du dépôt.
2. Conservez uniquement la PR correspondant à la branche que vous venez de pousser (généralement `work`).
3. Pour chaque ancienne PR, cliquez sur **Close pull request** (ou **Close with comment** si vous souhaitez expliquer la fermeture).
4. Supprimez les branches distantes associées via le bouton **Delete branch**.

> 💡 Astuce : si vous utilisez l'outil `gh` de GitHub, la commande `gh pr close <numéro> --delete-branch` permet de fermer et supprimer la branche en une seule étape.

## 4. Archiver les releases officielles
Pour une soutenance ou un rendu de thèse, créez un tag annoté :
```bash
git tag -a v4-demo -m "Version présentée le $(date +%Y-%m-%d)"
git push origin v4-demo
```
Cela fige exactement l'état présenté.

## 5. Réinitialiser le dépôt local
Après la présentation, vous pouvez repartir d'un dépôt propre :
```bash
git checkout main
git pull origin main
git branch -D work
```
Recréez ensuite une branche de travail (`git checkout -b work`) avant de poursuivre.

En suivant ce rituel, votre dépôt GitHub restera lisible et prêt pour toute démonstration officielle.
