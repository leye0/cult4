# Cult4 — Git Integrity & QA Pipeline Completion Plan

## 0. Objectif

Compléter la couche Git de Cult4 pour obtenir les garanties suivantes :

```text
Business work
    ↓
modifications versionnées
    ↓
commit Git propre et unique
    ↓
push vers remote privé
    ↓
SHA exact enregistré
    ↓
QA travaille exactement sur ce SHA
    ↓
QA PASS/FAIL lié exactement à ce SHA
    ↓
worktree QA détruit
    ↓
release possible uniquement pour ce SHA approuvé
```

Et pour l’organisation :

```text
Organization Maintenance
    ↓
repo Organization propre et synchronisé
    ↓
session autorisée à modifier le savoir-faire
    ↓
tests
    ↓
commit propre
    ↓
aucune modification résiduelle
    ↓
push remote privé
    ↓
nouveau SHA enregistré dans SQLite
```

Git doit devenir une **source d’identité/version des artefacts**, pas simplement un historique pratique.

Une approbation QA de `SHA abc123` signifie uniquement :

```text
repo X
commit abc123
responsibility release_quality
PASS
```

Elle ne signifie jamais « la business est approuvée » ni « main est approuvé ».

Si le code devient `def456`, **l’approbation de `abc123` n’est pas transférable**.

---

## 1. Invariants Git fondamentaux

### GIT-001 — Tous les repos persistants ont un remote privé

Deux catégories :

```text
ORGANIZATION
BUSINESS
```

Chaque repo doit posséder :

```text
remote = origin
remote_url != null
remote_verified_private = true
default_branch = main
```

Un repo `LOCAL_ONLY` peut exister pendant son provisioning, mais il ne doit jamais être considéré `READY`.

### GIT-002 — Aucun secret GitHub dans SQLite

SQLite peut conserver :

```text
git@github.com:owner/repo.git
```

ou :

```text
https://github.com/owner/repo.git
```

mais jamais une URL avec token embarqué.

L’authentification passe par SSH, Git credential helper ou `gh auth`. Cult4 ne gère pas de PAT lui-même.

### GIT-003 — `main` est la branche persistante

Pour Cult4 v1 :

```text
default branch = main
```

Pas de GitFlow, pas de branche `develop`, pas de système de PR interne obligatoire.

Les worktrees QA sont **detached HEAD**.

### GIT-004 — Un seul writer simultané par repo

Cult4 doit posséder un verrou logique :

```text
repo_write_lock
```

Un seul Builder ou une seule session de maintenance peut modifier un repo simultanément.

QA peut examiner un SHA dans un worktree parallèle parce qu’il ne modifie pas l’historique.

Cela évite les races de commits, merges, rebases et approbations ambiguës.

### GIT-005 — Cult4 possède la finalisation des commits

Le LLM produit le travail. Cult4 produit le commit officiel.

```text
agent modifies files
        ↓
Cult4 inspects diff
        ↓
Cult4 validates allowed files
        ↓
tests/checks
        ↓
Cult4 stages
        ↓
Cult4 commits
        ↓
Cult4 verifies clean repository
        ↓
Cult4 pushes
```

### GIT-006 — Un WorkItem versionné produit un commit logique

Une itération de travail versionnée doit produire un seul commit logique.

Si QA échoue :

```text
abc123   implementation
    ↓
QA FAIL
    ↓
def456   corrections
```

`def456` est un nouveau commit et nécessite une nouvelle QA.

### GIT-007 — Aucun force push

Interdit :

```bash
git push --force
git push --force-with-lease
```

L’historique Git fait partie de l’audit trail.

### GIT-008 — Une session versionnée commence propre

Avant toute session writer :

```bash
git status --porcelain
```

doit retourner vide.

Sinon :

```text
SESSION_REFUSED
REPOSITORY_DIRTY
```

Cult4 ne tente pas de deviner à qui appartiennent les modifications.

### GIT-009 — Une session commence depuis l’état distant attendu

Avant modification :

```bash
git fetch origin main
```

Puis Cult4 vérifie :

```text
HEAD == origin/main == SQLite.current_sha
```

Sinon aucun agent writer n’est lancé.

### GIT-010 — Une session versionnée se termine propre

Après commit :

```bash
git status --porcelain
```

doit être vide.

Sinon le WorkItem ne peut pas être `DONE`.

---

## 2. Modèle SQLite

Créer une table générique `repository`.

```sql
CREATE TABLE repository (
  id TEXT PRIMARY KEY,

  owner_type TEXT NOT NULL,
  -- organization | business

  owner_id TEXT,
  -- null pour organization
  -- business_id pour business

  local_path TEXT NOT NULL,

  remote_name TEXT NOT NULL DEFAULT 'origin',
  remote_url TEXT NOT NULL,

  default_branch TEXT NOT NULL DEFAULT 'main',

  current_sha TEXT,
  remote_sha TEXT,

  privacy_verified INTEGER NOT NULL DEFAULT 0,
  privacy_verified_at TEXT,

  sync_status TEXT NOT NULL,
  -- local_only | synced | ahead | behind | diverged
  -- dirty | missing | unreachable

  last_fetch_at TEXT,
  last_push_at TEXT,
  last_verified_at TEXT,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Ajouter aussi une table `git_commit`.

```sql
CREATE TABLE git_commit (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,

  sha TEXT NOT NULL UNIQUE,
  parent_sha TEXT,

  branch TEXT NOT NULL,

  work_item_id TEXT,
  employee_id TEXT,

  purpose TEXT,
  message TEXT,

  pushed_at TEXT,
  remote_verified_at TEXT,

  created_at TEXT NOT NULL
);
```

`repository.current_sha` représente l’état courant.

`git_commit` permet de reconstruire quel commit a été produit par quel WorkItem et quel employé.

---

## 3. Les approvals doivent référencer le repo ET le SHA

Une approval QA doit identifier sans ambiguïté le sujet validé :

```text
approval
    responsibility = release_quality
    repository_id = plant-goblin-repo
    subject_type = git_commit
    subject_version = abc123...
    approver = qa
    result = PASS
```

Ne pas stocker seulement un SHA sans repository.

---

## 4. Provisioning du repo Organization

Lors de :

```bash
cult init
```

ou :

```bash
cult git provision organization
```

Cult4 doit :

```text
create local repo if necessary
        ↓
ensure branch main
        ↓
produce initial commit
        ↓
create GitHub repository PRIVATE
        ↓
configure origin
        ↓
push main
        ↓
verify remote visibility == PRIVATE
        ↓
verify origin/main SHA == local HEAD
        ↓
save repository row in SQLite
```

Pour v1, GitHub peut être supporté explicitement plutôt qu’introduire une abstraction multi-provider prématurée.

Utiliser au besoin :

```bash
gh repo create ... --private
```

ou connecter un repo privé existant.

---

## 5. Provisioning d’une Business

`cult business create plant-goblin` doit devenir transactionnel conceptuellement.

```text
create business record
      ↓
create directory
      ↓
git init
      ↓
git checkout -b main
      ↓
create initial business files
      ↓
initial commit
      ↓
create PRIVATE GitHub repo
      ↓
configure origin
      ↓
push main
      ↓
verify private
      ↓
verify SHA
      ↓
record repository
      ↓
Business status = READY
```

Si la création du remote échoue :

```text
Business status != READY
```

Retourner une erreur claire :

```text
BUSINESS_PROVISIONING_INCOMPLETE
REMOTE_NOT_CONFIGURED
```

Ne jamais annoncer un succès complet si le repo existe uniquement localement.

---

## 6. Validation de la confidentialité

`git remote` ne permet pas de vérifier la visibilité GitHub.

Cult4 doit vérifier explicitement que le repo est privé, par exemple via :

```bash
gh repo view owner/repo
```

et vérifier :

```text
visibility == PRIVATE
```

Puis enregistrer :

```text
privacy_verified = true
privacy_verified_at = timestamp
```

`cult doctor` doit refaire périodiquement cette vérification.

Si un repo devient public :

```text
CRITICAL
REPOSITORY_VISIBILITY_PUBLIC
```

Cult4 autonome ne doit plus écrire de nouvelle information potentiellement sensible dans ce repo avant correction.

---

## 7. Synchronisation avant travail

Créer une fonction centrale :

```text
prepareWritableRepository(repoId)
```

Algorithme :

```text
acquire repo write lock

assert path exists
assert git repository
assert working tree clean
assert current branch == main
assert origin exists
assert origin URL == SQLite.remote_url

git fetch origin main

localSha = git rev-parse HEAD
remoteSha = git rev-parse origin/main

assert localSha == remoteSha
assert localSha == SQLite.current_sha

return {
    baseSha: localSha
}
```

Aucun Builder ne peut travailler sans passer par cette fonction.

---

## 8. Pourquoi ne pas faire `git pull` automatiquement

Ne pas utiliser automatiquement :

```bash
git pull
```

Cult4 doit d’abord observer via `git fetch`.

Classifier ensuite :

```text
local == remote         SYNCED
local ancestor remote   BEHIND
remote ancestor local   AHEAD
neither                 DIVERGED
```

`BEHIND`, `AHEAD` et `DIVERGED` sont des anomalies à résoudre explicitement, pas des invitations à merger automatiquement.

---

## 9. Finalisation automatique d’un WorkItem Builder

Créer :

```text
finalizeVersionedWork(workItemId)
```

Elle reçoit le `baseSha` enregistré avant la session.

### Étape A — vérifier l’historique

Après la session :

```text
HEAD doit encore être baseSha
```

Si le Builder a créé un commit lui-même :

```text
UNEXPECTED_GIT_HISTORY_CHANGE
```

Les permissions OpenCode devraient idéalement lui interdire `git commit` et `git push`.

### Étape B — inspecter les changements

Utiliser :

```bash
git status --porcelain
git diff
```

Déterminer les fichiers modifiés, ajoutés, supprimés, renommés et non suivis.

### Étape C — vérifier les chemins interdits

Refuser notamment :

```text
.env
secrets/
credentials
~/.cult4/
state.db
node_modules/
runtime/
```

et tout pattern de secrets configuré.

### Étape D — aucun changement

Si aucun changement :

```text
NO_VERSIONED_CHANGE
```

Aucun commit vide.

### Étape E — tests

Exécuter les checks applicables :

```text
lint
tests
typecheck
employee-specific checks
```

### Étape F — commit

Cult4 stage et commit :

```bash
git add ...
git commit ...
```

Format :

```text
cult4(#821): implement botanical listing generator
```

Avec trailers :

```text
Cult4-Work-Item: 821
Cult4-Employee: builder
Cult4-Base-SHA: abc123
```

### Étape G — propreté

Après commit :

```bash
git status --porcelain
```

doit être vide.

Sinon :

```text
FINALIZATION_FAILED
REPOSITORY_DIRTY_AFTER_COMMIT
```

Le WorkItem n’est pas `DONE`.

---

## 10. Push obligatoire

Après commit :

```text
commitSha = HEAD
```

Puis :

```bash
git push origin main
```

Cult4 ne considère pas le commit durable avant confirmation distante.

Vérifier ensuite :

```bash
git ls-remote origin refs/heads/main
```

Le SHA distant doit être exactement `commitSha`.

Seulement ensuite :

```text
git_commit.pushed_at = now
repository.current_sha = commitSha
repository.remote_sha = commitSha
repository.sync_status = synced
```

---

## 11. Que faire si le push échoue

Ne jamais rebase automatiquement, force-push ou ignorer silencieusement.

Le commit local reste intact.

```text
repository.sync_status = ahead
WorkItem = BLOCKED_GIT_SYNC
```

Cult4 peut continuer sur d’autres repos.

`cult doctor` doit exposer l’anomalie.

---

## 12. Ordre de mise à jour SQLite

Ordre impératif :

```text
1. commit local
2. push
3. verify remote SHA
4. transaction SQLite:
     insert git_commit
     update repository current_sha
     update repository remote_sha
5. mark versioned work completed
```

SQLite ne doit jamais annoncer comme durable un commit qui n’a pas été confirmé sur le remote.

---

## 13. Circuit Builder → QA exact

Supposons :

```text
Builder WorkItem #821
```

Produit :

```text
SHA = 6ca984...
```

Le WorkItem QA doit contenir :

```text
review_repository_id = plant-goblin
review_sha = 6ca984...
```

Pas :

```text
review_branch = main
```

---

## 14. Création du QA worktree

Créer :

```text
createQaWorktree(repoId, sha, qaWorkItemId)
```

Chemin :

```text
~/.cult4/runtime/worktrees/
  plant-goblin/
    qa-944/
      6ca984f/
```

Commande :

```bash
git worktree add --detach PATH SHA
```

Assertions :

```text
HEAD == SHA
detached HEAD == true
working tree clean
```

Optionnellement enregistrer :

```text
qa_worktree
-----------
work_item_id
repository_id
sha
path
created_at
```

---

## 15. Le QA ne peut pas changer la version examinée

QA examine exactement le SHA demandé.

Il ne doit pas :

```text
checkout main
pull
merge
rebase
commit fixes
```

Il peut lancer l’application, exécuter les tests, utiliser le navigateur, inspecter et produire des rapports.

Mais il n’est pas Builder.

---

## 16. Rapport QA

Le résultat doit contenir :

```text
repository_id
reviewed_sha
qa_employee_id

result:
PASS | FAIL | CONDITIONAL_PASS

tests_run
failures
evidence
notes

started_at
completed_at
```

Si FAIL, le Builder reçoit un nouveau WorkItem ou une réouverture explicite.

---

## 17. Approval QA liée au SHA

PASS produit :

```text
Approval
responsibility = RELEASE_QUALITY
subject_type = GIT_COMMIT
repository_id = ...
subject_version = 6ca984...
result = PASS
```

---

## 18. Suppression systématique du worktree QA

Dans un `finally`, PASS ou FAIL :

```bash
git worktree remove --force PATH
git worktree prune
```

Puis vérifier que le chemin et la référence worktree ont disparu.

Si le cleanup échoue :

```text
QA_RESULT_RECORDED
CLEANUP_REQUIRED
```

`cult doctor` doit le détecter.

---

## 19. QA échouée → nouveau SHA

```text
abc111 Builder
       ↓
QA FAIL

def222 Builder fix
       ↓
QA PASS
```

Une approval ne s’applique jamais à un autre SHA.

---

## 20. Vérifier qu’un commit approuvé n’a pas été remplacé

Avant `deploy`, `publish` ou `release`, Cult4 ne demande jamais :

> Existe-t-il une approval QA récente?

Il demande :

> Existe-t-il une approval QA PASS sur **ce SHA exact**?

Exemple :

```text
approved_sha = abc123
current_head = def456
```

Résultat :

```text
RELEASE DENIED
RELEASE_QUALITY missing for def456
```

Même si `def456` descend directement de `abc123`.

---

## 21. Ne jamais utiliser implicitement `HEAD` pour une release

Créer un objet `ReleaseCandidate` :

```text
repository_id
sha
```

Toute la chaîne de release utilise ce SHA.

Exemple :

```text
release candidate RC-44
→ plant-goblin
→ 6ca984
```

Pas « release whatever is currently on main ».

---

## 22. Organization Maintenance

Le repo Organization contient employees, skills, tools, playbooks, evals et Fondation.

Sa maintenance doit donc avoir un flow distinct et plus strict.

---

## 23. Préconditions Organization Maintenance

Avant la session :

```text
Organization repo exists
branch == main
working tree clean
origin configured
origin private
fetch succeeds
HEAD == origin/main
HEAD == SQLite.current_sha
```

Enregistrer ensuite :

```text
baseOrganizationSha
```

---

## 24. Permissions Organization Maintenance

Une session Business normale :

```text
organization repo = READ ONLY
```

Une session :

```text
ORGANIZATION_MAINTENANCE
```

peut recevoir write access.

Elle ne reçoit pas automatiquement le droit de modifier :

```text
foundation/*
```

Une modification de Fondation exige un WorkItem spécialisé :

```text
FOUNDATION_CHANGE
```

avec l’approbation humaine prévue.

---

## 25. Organization Maintenance doit produire un commit propre

Même règle que Builder :

```text
agent modifies
Cult4 reviews
tests
Cult4 commits
```

Puis :

```bash
git status --porcelain
```

doit être vide.

Sinon :

```text
ORGANIZATION_MAINTENANCE_FAILED
DIRTY_WORKTREE_AFTER_FINALIZATION
```

---

## 26. Pourquoi cette règle est importante

Un état dirty après maintenance implique que la prochaine session pourrait utiliser des changements :

- absents du remote;
- non identifiés par SHA;
- non restaurables;
- potentiellement non vérifiés.

La maintenance n’est donc réussie que si le repo est totalement propre après finalisation.

---

## 27. Après Organization Maintenance

```text
base SHA = orgAAA
        ↓
maintenance
        ↓
tests/evals
        ↓
commit orgBBB
        ↓
working tree clean
        ↓
push
        ↓
verify origin/main == orgBBB
        ↓
SQLite repository.current_sha = orgBBB
        ↓
insert git_commit(orgBBB)
```

Enregistrer également :

```text
OrganizationMaintenance
base_sha = orgAAA
result_sha = orgBBB
```

---

## 28. Les agents doivent connaître leur Organization SHA

Le bootstrap Employee doit inclure :

```text
organization_version = orgBBB
```

Ainsi un audit peut reconstruire la version exacte des procédures et outils utilisés par un employé lors d’un travail.

---

## 29. Restauration des working copies

Créer :

```bash
cult restore
```

ou :

```bash
cult git restore
```

SQLite sert de registre des repos attendus :

```text
expected path
remote URL
branch
expected SHA
```

---

## 30. Repo local absent

Si le chemin n’existe pas :

```bash
git clone REMOTE LOCAL_PATH
git checkout main
git fetch origin
```

Puis vérifier :

```text
HEAD == origin/main
HEAD == SQLite.current_sha
```

---

## 31. Repo local présent et propre

Vérifier repo, remote et fetch.

S’il est simplement derrière et que la situation est un fast-forward non ambigu correspondant au SHA attendu par SQLite, la commande de restauration peut le remettre en état.

`cult doctor`, lui, reste diagnostique et ne modifie pas automatiquement l’historique.

---

## 32. Repo local dirty

Ne jamais faire automatiquement :

```bash
git reset --hard
```

Retourner :

```text
RESTORE_REFUSED
DIRTY_WORKTREE
```

---

## 33. Repo divergé

Si local et remote divergent :

```text
RESTORE_REFUSED
REPOSITORY_DIVERGED
```

Pas de merge automatique.

---

## 34. Les remotes ne remplacent pas la sauvegarde SQLite

Git permet de reconstruire Organization et les working copies Business.

Les approvals, transactions, HumanRequests, Evidence et autres états opérationnels résident dans SQLite.

La sauvegarde de `state.db` doit être traitée séparément.

---

## 35. Restauration des worktrees QA

Les worktrees QA sont éphémères et ne sont jamais sauvegardés.

Si une QA active perd son worktree, Cult4 peut le recréer depuis le SHA.

Si une QA terminée possède encore un worktree, `doctor` doit le considérer stale et le nettoyer via une réparation sûre.

---

## 36. `cult doctor` devient l’autorité Git diagnostique

Exemple :

```text
Git integrity

Organization
✓ repository exists
✓ branch main
✓ working tree clean
✓ origin configured
✓ remote matches SQLite
✓ GitHub repository PRIVATE
✓ origin reachable
✓ local HEAD = 912fac
✓ origin/main = 912fac
✓ SQLite SHA = 912fac
✓ no stale worktrees

Plant Goblin
✓ repository exists
✓ clean
✗ local HEAD differs from SQLite
```

---

## 37. Checks exacts de `cult doctor`

```text
GIT001 local path exists
GIT002 valid Git repository
GIT003 current branch main
GIT004 working tree clean
GIT005 origin exists
GIT006 origin URL matches SQLite
GIT007 remote has no embedded credentials
GIT008 remote reachable
GIT009 GitHub visibility PRIVATE
GIT010 origin/main exists
GIT011 local SHA obtained
GIT012 remote SHA obtained
GIT013 SQLite SHA obtained
GIT014 local == remote
GIT015 local == SQLite
GIT016 repository not diverged
GIT017 no unexpected worktrees
GIT018 active QA worktrees use expected SHA
GIT019 completed QA worktrees removed
GIT020 approvals reference existing commits
GIT021 Organization FOUNDATION path correct
```

---

## 38. `doctor` doit distinguer WARNING, ERROR et CRITICAL

Exemple :

```text
WARNING
last privacy verification > 7 days
```

```text
ERROR
working tree dirty
```

```text
CRITICAL
remote is PUBLIC
```

Les conditions critiques empêchent `cult tick` d’utiliser le repo concerné.

---

## 39. Safe repair

Support possible :

```bash
cult doctor --repair
```

Réparations automatiques acceptables :

```text
git worktree prune
remove stale runtime directories
refresh remote SHA cache
re-run privacy verification
clone a completely missing repo
```

Interdit automatiquement :

```text
reset --hard
force push
merge
rebase
discard dirty changes
```

---

## 40. Classification des états de repo

Créer une fonction unique qui produit :

```text
RepositoryHealth
```

Valeurs :

```text
HEALTHY
DIRTY
LOCAL_ONLY
MISSING
REMOTE_UNREACHABLE
REMOTE_NOT_PRIVATE
AHEAD
BEHIND
DIVERGED
SHA_MISMATCH
STALE_WORKTREE
```

Le reste de Cult4 consomme cette classification au lieu de dupliquer les checks.

---

## 41. Déplacement de `FOUNDATION.md`

Faire :

```text
cult4-organization/
    foundation/
        FOUNDATION.md
```

Utiliser :

```bash
git mv FOUNDATION.md foundation/FOUNDATION.md
```

Puis rechercher toutes les références à l’ancien chemin et les mettre à jour.

---

## 42. Bootstraps Employee et nouveau chemin

Les prompts Employee qui disent `Read FOUNDATION.md` doivent utiliser le nouveau chemin officiel.

Idéalement, le bootstrap Cult4 retourne :

```text
foundation_path
```

afin d’éviter de hardcoder ce chemin dans tous les agents.

---

## 43. `doctor` vérifie FOUNDATION

Ajouter :

```text
✓ foundation/FOUNDATION.md exists
✓ root FOUNDATION.md does not exist
```

Deux copies simultanées sont une anomalie.

---

## 44. Module Git unique

Centraliser l’intégration Git dans :

```text
src/git/
    repo.ts
    commit.ts
    worktree.ts
    github.ts
```

ou un module unique si le code reste très petit.

API interne :

```text
inspectRepository()
prepareWritableRepository()
finalizeVersionedWork()
pushAndVerify()
createDetachedWorktree()
removeWorktree()
restoreRepository()
verifyPrivateRemote()
```

Pas de commandes Git dispersées dans toute l’application.

---

## 45. Wrapper Git minimal

Créer :

```text
git(args, cwd)
```

Le wrapper doit :

- capturer stdout;
- capturer stderr;
- vérifier l’exit code;
- journaliser sans secrets;
- retourner une structure typée;
- appliquer un timeout raisonnable.

Pas besoin d’une grosse bibliothèque Git si la CLI Git suffit.

---

## 46. SHA complets en DB

L’UI peut afficher un SHA court.

SQLite doit toujours stocker le SHA complet renvoyé par :

```bash
git rev-parse HEAD
```

---

## 47. Repository lock

Créer une table ou un lock fichier simple :

```text
repo_id
holder_work_item_id
pid/session_id
acquired_at
expires_at
```

Cult4 étant local, pas besoin d’un distributed locking sophistiqué.

Un lock stale peut être récupéré après vérification du process.

---

## 48. QA n’a pas besoin du lock writer

QA travaille sur un detached worktree pointant vers un commit immutable.

Pour v1, garder malgré tout un seul pipeline versionné actif par Business afin de réduire la complexité.

---

## 49. Protection contre les manipulations Git du LLM

Les agents Business ordinaires ne doivent idéalement pas pouvoir exécuter :

```text
git commit
git push
git reset
git rebase
git checkout
git merge
git worktree
```

Ils peuvent lire :

```text
git diff
git status
git log
```

Cult4 garde le contrôle de l’historique.

---

## 50. Organization Maintenance idem

Même un agent autorisé à modifier les fichiers Organization n’a pas besoin du contrôle direct de `push`, `reset`, `rebase`, etc.

Cult4 finalise et pousse.

---

## 51. Audit events

Enregistrer les événements Git significatifs :

```text
REPO_PROVISIONED
REMOTE_CONNECTED
PRIVACY_VERIFIED
WORK_STARTED_AT_SHA
COMMIT_CREATED
COMMIT_PUSHED
QA_WORKTREE_CREATED
QA_STARTED
QA_PASSED
QA_FAILED
QA_WORKTREE_REMOVED
ORGANIZATION_UPDATED
RESTORE_PERFORMED
```

Avec :

```text
repo_id
sha
work_item_id
employee_id
timestamp
```

Ne pas journaliser chaque `git status`.

---

## 52. Commit messages Organization

Exemple :

```text
cult4(org #402): improve physical-product QA skill
```

Trailers :

```text
Cult4-Work-Item: 402
Cult4-Employee: qa
Cult4-Maintenance-Type: skill-improvement
Cult4-Base-SHA: orgAAA...
```

Pour Fondation :

```text
Cult4-Foundation-Change: true
Cult4-Human-Approval: APPROVAL_ID
```

---

## 53. Commit messages Business

Exemple :

```text
cult4(#821): add botanical sticker listing assets
```

Éviter les messages vagues comme `updates`, `fix stuff` ou `agent changes`.

Le message doit être dérivé du WorkItem.

---

## 54. Git ne contient pas la mémoire opérationnelle

Conserver la séparation :

```text
Git
=
versioned durable artifacts

SQLite
=
operational organizational state
```

Les HumanRequests, transactions et mémoires brutes ne deviennent pas des fichiers Git par défaut.

---

## 55. Ordre d’implémentation recommandé

### Phase Git-A — Schéma

Ajouter :

```text
repository
git_commit
optional qa_worktree
repository_lock
```

Migrer les repos locaux existants dans `repository`.

Ne rien recréer.

### Phase Git-B — Inspection centralisée

Implémenter :

```text
inspectRepository()
```

et les états `HEALTHY`, `DIRTY`, `MISSING`, `AHEAD`, `BEHIND`, `DIVERGED`, etc.

### Phase Git-C — Remotes GitHub privés

Implémenter :

```text
connectRemote()
createPrivateRemote()
verifyPrivateRemote()
```

Configurer Organization et chaque Business.

Pousser les commits initiaux existants.

Enregistrer remotes et SHA.

### Phase Git-D — Finalizer de commit

Implémenter :

```text
prepareWritableRepository()
finalizeVersionedWork()
pushAndVerify()
```

Interdire qu’un WorkItem versionné devienne `DONE` autrement.

### Phase Git-E — QA pipeline

Brancher :

```text
Builder
→ SHA
→ detached worktree
→ QA
→ SHA-specific approval
→ cleanup
```

### Phase Git-F — Organization Maintenance

Faire passer toutes les maintenances Organization par :

```text
clean precondition
exact base SHA
maintenance
tests
commit
clean postcondition
push
SQLite update
```

### Phase Git-G — Restore

Implémenter :

```bash
cult restore organization
cult restore business <slug>
cult restore --all
```

### Phase Git-H — Doctor

Étendre `cult doctor` avec tous les checks Git.

### Phase Git-I — FOUNDATION path

Faire le `git mv`, mettre à jour références/tests, committer et pousser.

---

## 56. Tests unitaires obligatoires

Écrire au minimum des tests pour :

```text
remote missing
remote URL mismatch
remote public
dirty repo
wrong branch
local ahead
local behind
diverged
SQLite SHA mismatch
push failure
commit produces clean worktree
commit leaves dirty worktree
QA worktree uses exact SHA
QA PASS tied exact SHA
different SHA cannot reuse approval
QA FAIL causes no PASS
worktree removed on PASS
worktree removed on FAIL
organization maintenance records new SHA
organization maintenance dirty = fail
restore missing repo
restore dirty repo refuses
restore divergent repo refuses
FOUNDATION wrong location
```

---

## 57. Test d’intégration Builder → QA

Créer un vrai repo temporaire et un bare remote.

État initial :

```text
main = AAA
```

Builder modifie.

Cult4 finalise :

```text
BBB
```

Assertions :

```text
local HEAD = BBB
remote main = BBB
SQLite = BBB
working tree clean
```

Créer QA worktree :

```text
HEAD = BBB
detached = true
```

QA PASS.

Assert :

```text
Approval.subject_version = BBB
```

Puis Builder produit :

```text
CCC
```

Tentative de release avec approval BBB :

```text
DENIED
```

Nouvelle QA CCC :

```text
PASS
```

Release CCC :

```text
ALLOWED
```

C’est **le test central**.

---

## 58. Test Organization Maintenance

Initial :

```text
Organization = ORG1
```

Maintenance modifie un élément organisationnel.

Finalisation :

```text
ORG2
```

Assertions :

```text
HEAD = ORG2
origin/main = ORG2
SQLite = ORG2
clean = true
git_commit row exists
```

Puis provoquer volontairement un changement résiduel après commit.

Résultat obligatoire :

```text
FAILED
ORGANIZATION_REPOSITORY_DIRTY
```

---

## 59. Test de restauration

Supprimer complètement une working copy Business.

Garder SQLite et remote.

```bash
cult restore business plant-goblin
```

Doit reconstruire :

```text
directory
.git
origin
main
correct SHA
clean state
```

Puis :

```text
cult doctor
→ HEALTHY
```

---

## 60. Test d’un remote public

Dans les mocks ou tests d’intégration :

```text
visibility = PUBLIC
```

Cult4 doit retourner :

```text
CRITICAL
REMOTE_NOT_PRIVATE
```

et refuser de considérer le repo sain.

---

## 61. Définition de DONE pour ce chantier

Aucun point n’est terminé tant que ceci n’est pas vrai :

```text
$ cult doctor

Organization
  ✓ Private remote
  ✓ main
  ✓ clean
  ✓ local SHA == origin/main
  ✓ SQLite SHA coherent
  ✓ no stale worktrees
  ✓ FOUNDATION.md location valid

Businesses
  Plant Goblin
    ✓ Private remote
    ✓ main
    ✓ clean
    ✓ local SHA == origin/main
    ✓ SQLite SHA coherent

QA integrity
  ✓ all approvals reference existing exact SHAs
  ✓ no approvals inherited by newer commits
  ✓ no stale QA worktrees
```

Et le test automatique :

```text
Builder → commit → push → detached QA → PASS
→ exact SHA approval → cleanup → release
```

doit fonctionner de bout en bout.

---

## 62. Règle conceptuelle finale

> **Aucune modification persistante de Cult4 ne doit exister uniquement dans un working directory, et aucune validation ne doit porter sur une notion mouvante telle que “main”, “la version actuelle” ou “le dernier travail du Builder”.**

Tout ce qui est versionné devient :

```text
repo + SHA
```

Tout ce qui est approuvé devient :

```text
repo + SHA + responsabilité + approver
```

Tout ce qui est durable devient :

```text
commit
+ push confirmé
+ SQLite cohérent
```

Tout ce qui est temporaire — notamment les worktrees QA — doit pouvoir disparaître complètement sans perte d’information.

Git devient ainsi **le mécanisme qui donne une identité immutable au travail que les employés produisent et que les autres employés approuvent**.
