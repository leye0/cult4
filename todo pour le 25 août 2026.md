# TODO pour le 25 août 2026

## Objectif

Terminer le système d’apprentissage de Cult4 afin que les employés deviennent
réellement meilleurs avec l’expérience, acquièrent rapidement les Skills et les
outils qui leur manquent, réutilisent leur savoir-faire dans plusieurs
Businesses et cessent d’agir comme des personas interchangeables autour d’un
agent de coding généraliste.

Le système doit fermer la boucle complète :

> besoin réel → acquisition immédiate → pratique → résultat mesuré →
> amélioration locale → validation → réutilisation → promotion
> organisationnelle → comparaison continue → rollback si régression

Il doit également fonctionner selon un principe de **parallélisme maximal par
défaut** : tout travail indépendant doit démarrer en parallèle dès que ses
entrées et ses ressources sont disponibles. La sérialisation doit toujours avoir
une raison explicite et observable.

## Principe directeur : apprendre live, gouverner sans bloquer

L’amélioration d’un employé ne doit pas devenir une bureaucratie qui ralentit
artificiellement son travail.

Lorsqu’un employé découvre pendant une mission qu’il doit, par exemple, savoir
faire une capture d’écran web, inspecter un DOM, utiliser une nouvelle API,
produire un type de document ou appliquer une méthode spécialisée, Cult4 doit
lui permettre d’acquérir ce savoir-faire immédiatement et de reprendre la
mission dans le même cycle.

Il faut donc séparer deux voies :

1. **Apprentissage local immédiat**
   - Autorisé automatiquement lorsqu’il est réversible, peu risqué et dans le
     mandat de l’employé.
   - Disponible dans le WorkItem courant dès qu’un micro-test prouve que la
     pratique ou l’outil fonctionne.
   - Persisté dans la mémoire de l’employé avec sa source, sa version, ses
     limites, son test et son contexte d’utilisation.
   - Ne nécessite pas une revue QA organisationnelle préalable.
   - Ne doit pas interrompre la mission initiale plus longtemps que nécessaire.

2. **Promotion organisationnelle durable**
   - Asynchrone et non bloquante pour le travail courant.
   - Requise avant de présenter le savoir-faire comme une pratique officielle
     réutilisable par tous les employés et tous les Businesses.
   - Évaluée indépendamment, versionnée, mesurée et révocable.
   - Ne doit jamais transformer chaque petite découverte en comité ou en gate.

La gouvernance porte sur le risque et sur la prétention de généraliser un
apprentissage, pas sur le simple droit d’apprendre.

## État déjà livré à préserver

- [x] WorkItems dotés de capacités requises persistées.
- [x] Routage déterministe vers un employé actif possédant les capacités
      demandées et au moins un actif organisationnel.
- [x] Interdiction pour l’Operator de remplacer un spécialiste.
- [x] Builder permanent avec Skill d’ingénierie logicielle.
- [x] Séparation des permissions Operator, Builder, QA, Designer et recherche.
- [x] Tâche de développement de pratique après quatre exécutions mesurées ou
      immédiatement après un échec.
- [x] Postmortems et propositions d’amélioration fondés sur des preuves.
- [x] Interdiction d’auto-approuver une proposition organisationnelle.
- [x] Revue indépendante des propositions d’amélioration.
- [x] Migration de schéma v4 et tests de staffing associés.
- [x] Build actuel compilé et suite complète à 78 tests réussis.
- [x] Dépôt GitHub conservé à un seul commit initial.

## 1. Modèle d’apprentissage à compléter

- [ ] Définir explicitement les concepts suivants et leurs transitions :
  `Capability`, `Practice`, `Skill`, `Tool`, `Playbook`, `Method`,
  `EmployeeLearning`, `OrganizationalAssetVersion`, `Evaluation`, `Rollout` et
  `Rollback`.
- [ ] Distinguer une capacité déclarée d’une compétence démontrée.
- [ ] Distinguer un apprentissage local à un employé d’un actif officiel de
      l’organisation.
- [ ] Permettre à une pratique locale d’exister immédiatement avec les états
      `DISCOVERED`, `TRIAL`, `USABLE`, `FAILED`, `SUPERSEDED`.
- [ ] Donner aux actifs organisationnels versionnés les états `CANDIDATE`,
      `VALIDATING`, `ACTIVE`, `DEGRADED`, `ROLLED_BACK`, `RETIRED`.
- [ ] Conserver l’actif précédent lors de toute activation afin que le rollback
      soit mécanique et non une reconstruction par le modèle.

## 2. Acquisition live d’un Skill ou d’un outil

- [ ] Ajouter un outil Cult4 permettant à un employé de déclarer un besoin de
      pratique pendant son WorkItem, avec : objectif, capacité concernée,
      obstacle actuel, risque, source envisagée et test minimal de réussite.
- [ ] Classer automatiquement l’acquisition :
  - **LOW** : lecture, méthode, Skill textuel, commande déjà installée,
    transformation locale et réversible — acquisition immédiate.
  - **MEDIUM** : nouveau package ou exécutable local, accès réseau accru,
    automatisation navigateur — acquisition immédiate dans un environnement
    isolé avec test, journal et possibilité de désactivation.
  - **HIGH/CRITICAL** : secret, compte personnel, achat, publication, message
    externe, privilège système, action destructive ou données sensibles — gate
    déterministe ou Human Request avant l’action risquée seulement.
- [ ] Autoriser l’employé à créer ou adapter un Skill local dans un espace
      contrôlé sans modifier silencieusement la Foundation.
- [ ] Exécuter un micro-test ciblé immédiatement, par exemple : ouvrir une page,
      capturer une image, vérifier le fichier produit et consigner les limites.
- [ ] Lier la pratique acquise au WorkItem et reprendre automatiquement la
      mission initiale après réussite du micro-test.
- [ ] En cas d’échec, conserver ce qui a été tenté, la cause et une alternative;
      ne pas boucler indéfiniment sur l’installation ou la même méthode.
- [ ] Interdire qu’un simple manque d’outil pousse l’employé à imiter le résultat
      manuellement ou à déclarer la capacité impossible sans tentative sûre.
- [ ] Ajouter un budget borné de temps et de coût pour l’apprentissage live,
      extensible par l’Operator lorsque la compétence est essentielle au mandat.

## 3. Mémoire professionnelle de l’employé

- [ ] Enregistrer chaque utilisation significative d’une pratique ou d’un outil
      avec l’employé, la capacité, le Business, le WorkItem, la version de
      l’actif, la durée, le coût, le résultat et les erreurs.
- [ ] Enregistrer le contexte où la méthode fonctionne et celui où elle échoue.
- [ ] Produire un postmortem calibré après un échec et périodiquement après des
      réussites, sans forcer une longue dissertation à chaque tour.
- [ ] Résumer les expériences répétitives afin d’éviter de gonfler indéfiniment
      le contexte du modèle.
- [ ] Charger au démarrage d’une mission seulement les pratiques pertinentes à
      ses capacités et au WorkItem courant.
- [ ] Préserver les sources, versions, dates de vérification, limites connues et
      conditions d’utilisation de chaque apprentissage.
- [ ] Faire expirer ou revalider les méthodes dépendantes d’une API, d’un site,
      d’un package ou d’une interface qui peut changer.

## 4. Mesure de compétence réelle

- [ ] Ajouter des observations de performance par : employé, capacité, pratique
      ou actif versionné, Business et type de WorkItem.
- [ ] Mesurer au minimum : réussite, qualité QA, reprises, durée, coût modèle,
      coût externe, interventions humaines, erreurs et stabilité après livraison.
- [ ] Ne pas confondre quantité de tâches exécutées avec compétence.
- [ ] Donner plus de poids aux résultats indépendamment vérifiés et aux résultats
      réels qu’aux auto-évaluations de l’employé.
- [ ] Calculer une confiance avec taille d’échantillon; ne pas surinterpréter une
      réussite unique.
- [ ] Comparer une nouvelle version de méthode à la version précédente sur des
      tâches comparables.
- [ ] Exposer les raisons du score de compétence; aucun chiffre opaque ne doit
      décider seul du routage.

## 5. Routage fondé sur le savoir-faire démontré

- [ ] Conserver l’exigence structurelle de capacité et d’actif opérationnel.
- [ ] Préférer ensuite l’employé ayant les meilleurs résultats démontrés pour le
      contexte, sans créer un monopole qui empêche les autres d’apprendre.
- [ ] Réserver une fraction contrôlée du travail à l’apprentissage ou au mentorat
      lorsque la capacité organisationnelle est fragile.
- [ ] Permettre un handoff explicite entre spécialistes avec les hypothèses,
      preuves, fichiers, décisions et limites nécessaires.
- [ ] Interdire à l’Operator de combler un trou de capacité par du travail métier;
      il doit créer/acquérir la capacité ou router vers le bon spécialiste.
- [ ] Lorsqu’aucun employé n’est qualifié, créer un WorkItem d’acquisition de
      capacité plutôt qu’un simple blocage permanent.

## 6. Promotion organisationnelle non bloquante

- [ ] À partir d’un apprentissage local réussi et réutilisable, créer
      automatiquement une proposition de promotion sans interrompre le WorkItem
      d’origine.
- [ ] Vérifier que la proposition contient des preuves réelles, ses limites, son
      risque, le test reproductible et le problème qu’elle résout.
- [ ] Router la validation vers un évaluateur indépendant compétent; QA ne doit
      pas devenir l’approbateur universel de tous les métiers.
- [ ] Créer un WorkItem de maintenance organisationnelle versionné à partir
      d’une proposition approuvée.
- [ ] Modifier le Skill, outil, playbook ou méthode dans le dépôt organisationnel
      par le mainteneur approprié.
- [ ] Produire un commit Cult4 exact, poussé et auditable.
- [ ] Faire valider le commit exact par un évaluateur indépendant et approprié au
      domaine.
- [ ] Activer automatiquement la nouvelle version seulement après la validation.
- [ ] Matérialiser la version active pour les employés concernés et la rendre
      disponible aux autres Businesses.
- [ ] Marquer la proposition `IMPLEMENTED` seulement après activation effective,
      jamais immédiatement après une approbation abstraite.

## 7. Rollout, surveillance et rollback

- [ ] Déployer d’abord une nouvelle méthode sur une portée limitée lorsque son
      risque ou son incertitude le justifie.
- [ ] Définir avant activation les métriques attendues et les conditions de
      régression.
- [ ] Comparer les résultats observés à la version précédente.
- [ ] Marquer automatiquement une version `DEGRADED` lorsque ses résultats
      franchissent un seuil de régression avec assez de données.
- [ ] Revenir mécaniquement à la dernière version saine lorsqu’une condition de
      rollback déterministe est satisfaite.
- [ ] Créer une enquête/postmortem après rollback sans bloquer les autres
      employés sur une version dégradée.
- [ ] Conserver toutes les versions, évaluations, activations et restaurations
      dans l’audit append-only.

## 8. Employés et responsabilités à renforcer

- [ ] Définir qui maintient les actifs organisationnels et qui peut évaluer
      chaque famille de capacités.
- [ ] Éviter un « Capability Steward » omniscient qui reproduirait le problème de
      l’Operator généraliste.
- [ ] Permettre aux spécialistes du domaine de maintenir leurs propres méthodes,
      mais jamais d’approuver seuls leur généralisation.
- [ ] Ajouter ou faire évoluer les employés lorsque les capacités nécessaires ne
      correspondent à aucun rôle existant.
- [ ] Donner à chaque employé un kit minimal réellement utile : Skill initial,
      outils autorisés, tests de pratique, sources de référence, limites et
      exemples de handoff.
- [ ] Vérifier que Researcher, Cultural Market Intelligence, Strategist,
      Designer, Builder, QA, Treasurer et IP Reviewer sont réellement sollicités
      selon les besoins plutôt que seulement présents dans la base.

## 9. Orchestration et capacité réservée

- [ ] Conserver la création automatique d’un travail d’apprentissage après
      quatre exécutions ou un échec, mais rendre l’intervalle configurable.
- [ ] Distinguer les micro-apprentissages live des revues périodiques plus
      profondes.
- [ ] Réserver une part explicite du budget de tours, de temps et de coût à
      l’amélioration des employés, même lorsque cela ralentit un Business.
- [ ] Empêcher les tâches d’apprentissage de mourir de faim derrière les tâches
      commerciales à priorité élevée.
- [ ] Faire exécuter automatiquement les maintenances organisationnelles prêtes
      dans un budget borné, plutôt que d’exiger systématiquement une commande
      manuelle `cult organization maintain`.
- [ ] Afficher séparément le temps/coût consacré au Business et celui consacré à
      la construction du savoir-faire organisationnel.

## 9A. Exécution parallèle et collaboration visible

### Lacune actuelle

Le scheduler actuel est réellement linéaire : une seule boucle prend le premier
WorkItem prêt et attend la fin complète de son agent avant d’en choisir un autre.
Le verrou global `tick` empêche un second scheduler, tandis que le verrou du
dépôt protège correctement Git mais sérialise toutes les écritures du même
Business. Le graphe exprime des dépendances, mais n’exploite pas encore le
parallélisme entre ses branches indépendantes.

### Modèle de concurrence attendu

- [ ] Établir comme invariant du scheduler : « lancer tout WorkItem indépendant
      admissible maintenant », plutôt que « choisir le prochain WorkItem ».
- [ ] Faire du parallélisme maximal sûr la valeur par défaut, sans exiger que
      l’humain ou l’Operator demande manuellement plusieurs workers.
- [ ] Calculer continuellement le front d’exécution complet du DAG et remplir
      toute la capacité disponible jusqu’aux limites réelles de ressources,
      risque, budget et fournisseur de modèle.
- [ ] Exiger une justification durable lorsqu’un WorkItem prêt est sérialisé :
      dépendance de données, ressource exclusive, conflit Git, gate, budget,
      rate limit ou décision humaine.
- [ ] Remplacer la boucle mono-WorkItem par un scheduler à concurrence bornée,
      configurable par nombre d’employés actifs, coût, durée et ressources.
- [ ] Sélectionner un ensemble de WorkItems `READY` dont toutes les dépendances
      sont satisfaites et qui ne revendiquent pas de ressources incompatibles.
- [ ] Permettre immédiatement le parallélisme entre :
  - Businesses ou dépôts différents;
  - recherches, analyses et collectes indépendantes en lecture seule;
  - spécialistes travaillant sur des sujets distincts;
  - QA d’un commit immuable et préparation d’un autre WorkItem indépendant;
  - apprentissage organisationnel et travail commercial sans dépendance.
- [ ] Faire décomposer activement les gros WorkItems en branches indépendantes;
      un objectif monolithique ne doit pas masquer du parallélisme disponible.
- [ ] Utiliser des schémas fan-out/fan-in explicites : plusieurs spécialistes
      explorent en parallèle, puis un WorkItem de synthèse consomme leurs sorties
      structurées sans refaire leurs recherches.
- [ ] Pour la recherche, lancer simultanément les sources, angles, marchés,
      communautés, fournisseurs et hypothèses indépendants.
- [ ] Pour une étude de marché, paralléliser collecte culturelle, demande,
      concurrence, saturation, prix, langage client, risques et validation des
      sources avant une synthèse par le spécialiste responsable.
- [ ] Pour le code, paralléliser architecture ciblée, exploration de librairies,
      prototypes isolés, implémentations découplées, tests et documentation dans
      des branches/worktrees compatibles.
- [ ] Pour l’exploration technique, permettre plusieurs essais concurrents avec
      critères communs, puis comparer leurs résultats mesurés plutôt que laisser
      le premier agent choisir intuitivement une librairie.
- [ ] Pour QA, paralléliser les familles de tests indépendantes sur le même commit
      immuable, puis agréger les résultats dans une décision unique traçable.
- [ ] Commencer en parallèle tout travail aval qui ne dépend que d’une sortie
      partielle explicitement stable, sans attendre artificiellement la fin de
      l’ensemble du projet parent.
- [ ] Empêcher par défaut qu’un même employé exécute deux missions simultanées :
      la concurrence doit provenir de plusieurs employés spécialisés, pas de
      clones invisibles d’une même identité.
- [ ] Permettre éventuellement plusieurs employés du même métier avec identités,
      pratiques, performances et responsabilités distinctes.
- [ ] Ajouter des déclarations de ressources sur les WorkItems : dépôt en
      lecture/écriture, compte externe, secret, budget, sujet métier, appareil ou
      intervention humaine.
- [ ] Remplacer le verrou global d’exécution par un verrou de coordination du
      scheduler et des leases atomiques par WorkItem/ressource.
- [ ] Garder SQLite sous un seul hôte coordinateur avec transactions courtes;
      les agents parallèles ne doivent jamais écrire directement dans la base.

### Écritures parallèles dans un même dépôt

- [ ] Ne jamais laisser deux agents modifier le même working tree.
- [ ] Créer un worktree et une branche technique isolés par WorkItem
      d’implémentation, fondés sur un SHA exact et nommés de façon traçable.
- [ ] Faire produire les modifications sans laisser l’agent committer ou pousser.
- [ ] Faire finaliser chaque résultat par l’hôte Cult4 avec provenance exacte :
      commit, push de la branche et métadonnées Employee/WorkItem/capacités.
- [ ] Permettre à l’hôte Cult4 d’ouvrir automatiquement une PR par branche de
      travail lorsque le résultat doit être intégré ou revu séparément.
- [ ] Mettre dans la PR : objectif, demandes officielles couvertes, dépendances,
      employé producteur, Skills/outils utilisés, tests, risques, preuves et coût.
- [ ] Laisser les agents commenter leur progression et répondre aux observations
      via des événements Cult4 attribués, sans leur donner directement les
      credentials ou l’autorité GitHub.
- [ ] Éviter le bruit inutile : une tâche courte et non conflictuelle peut passer
      par une branche/worktree interne et une merge queue Cult4 sans PR publique;
      les PRs servent aux unités réellement indépendantes, révisables ou à risque.
- [ ] Ajouter un WorkItem d’intégration explicite lorsque deux branches modifient
      le même dépôt.
- [ ] Rebaser, mettre en merge queue ou fusionner par le trusted host seulement
      après vérification des bases, dépendances, gates, QA et conflits.
- [ ] En cas de conflit sémantique, router vers Builder/Integrator avec les deux
      handoffs; ne jamais choisir silencieusement la dernière écriture.
- [ ] Faire exécuter une QA de branche sur le head exact de la PR lorsque utile,
      puis obligatoirement la QA finale sur le commit intégré exact.
- [ ] Fermer automatiquement la PR et nettoyer branche/worktree après intégration
      ou abandon, tout en conservant l’audit et les artefacts de preuve.

### Collaboration et handoffs

- [ ] Permettre à deux spécialistes de se partager un objectif via des WorkItems
      enfants aux sorties contractuelles explicites.
- [ ] Exiger que chaque agent expose progressivement : état, résultat partiel,
      hypothèses, preuves, fichiers produits, blocages et prochaine étape.
- [ ] Persister ces événements afin qu’un autre employé puisse consommer le
      handoff sans relire une conversation OpenCode complète.
- [ ] Permettre à un employé de déclarer qu’il attend la sortie exacte d’un autre
      plutôt que de dupliquer son travail.
- [ ] Débloquer automatiquement les consommateurs lorsque les artefacts requis
      sont prêts et validés.
- [ ] Faire de l’Operator le coordinateur du graphe et des conflits de priorité,
      sans le transformer en relais manuel de tous les messages.

### Budget, arrêt et robustesse

- [ ] Réserver le budget de chaque nouveau tour atomiquement avant son lancement
      afin que plusieurs agents ne dépassent pas ensemble la limite globale.
- [ ] Afficher le coût individuel et agrégé en temps réel.
- [ ] Avec ESC, cesser de programmer de nouveaux tours et arrêter proprement les
      workers aux frontières sûres avant le retour dans l’Operator.
- [ ] Avec Ctrl+C, annuler tous les enfants, checkpoint-er les worktrees
      récupérables et libérer tous les leases sans processus orphelin.
- [ ] Après crash du coordinateur, tuer les enfants par `parent-death`, récupérer
      les WorkItems et worktrees, puis reprendre sans double exécution.
- [ ] Éviter qu’un worker en panne arrête les autres branches indépendantes;
      propager l’échec uniquement aux WorkItems qui en dépendent.
- [ ] Adapter dynamiquement la concurrence aux rate limits, latences et coûts des
      modèles sans revenir silencieusement à une exécution mono-agent.
- [ ] Prioriser le chemin critique tout en remplissant les ressources libres avec
      les autres branches prêtes afin de minimiser le temps total de livraison.
- [ ] Éviter le parallélisme factice : deux agents ne doivent pas dupliquer la
      même recherche faute de partitions ou de contrats de sortie précis.

### Vue terminal multi-employés

- [ ] Afficher une lane stable et colorée par employé/WorkItem avec : temps,
      statut, outil courant, dernier progrès et coût.
- [ ] Multiplexer les événements sans mélanger les cartes de deux agents.
- [ ] Offrir une vue synthétique de toutes les lanes et une vue détaillée d’une
      lane sélectionnée.
- [ ] Montrer clairement les relations `produit pour`, `attend`, `bloque` et
      `prêt pour intégration`.
- [ ] Permettre d’intervenir sur une lane précise sans arrêter les autres.
- [ ] Conserver les sorties complètes dans un journal durable même lorsque la vue
      terminal n’affiche qu’un résumé.

### Tests de parallélisme obligatoires

- [ ] Deux recherches indépendantes s’exécutent réellement en chevauchement et
      exposent chacune leur progression.
- [ ] Deux Businesses distincts peuvent écrire parallèlement dans leurs dépôts.
- [ ] Deux tâches en lecture seule d’un même Business peuvent progresser en
      parallèle.
- [ ] Deux écritures du même dépôt utilisent des worktrees distincts puis un
      commit d’intégration exact.
- [ ] Deux branches parallèles peuvent produire deux PRs attribuées aux bons
      WorkItems; la merge queue respecte dépendances et QA exactes.
- [ ] Une PR en conflit crée un travail d’intégration explicite plutôt qu’une
      fusion automatique ou une écrasement silencieux.
- [ ] Deux tâches revendiquant le même compte externe ou la même ressource
      exclusive ne s’exécutent jamais simultanément.
- [ ] Une dépendance ne démarre qu’après le résultat durable de son producteur.
- [ ] Le budget agrégé n’est jamais dépassé malgré plusieurs lancements
      concurrents.
- [ ] ESC, Ctrl+C et la mort du parent nettoient tous les workers et verrous.
- [ ] Un échec isolé ne tue pas une branche indépendante; ses dépendants sont
      bloqués avec une raison explicite.
- [ ] La progression affichée reste attribuable au bon employé et au bon
      WorkItem sous forte concurrence.
- [ ] Un DAG comportant dix feuilles indépendantes lance toutes les feuilles
      admissibles sans les parcourir séquentiellement.
- [ ] Une étude de marché fan-out collecte plusieurs dimensions simultanément et
      sa synthèse ne démarre qu’après les sorties requises, sans refaire le travail.
- [ ] Deux explorations de librairies concurrentes sont comparées sur les mêmes
      critères et la décision conserve leurs preuves respectives.
- [ ] Le scheduler démontre qu’il maintient occupée la capacité disponible et
      expose toute sous-utilisation avec sa raison exacte.

## 10. Outils Cult4 à prévoir

- [ ] `cult4_identify_capability_gap`
- [ ] `cult4_acquire_local_practice`
- [ ] `cult4_validate_local_practice`
- [ ] `cult4_record_practice_outcome`
- [ ] `cult4_propose_improvement` enrichi avec la pratique/version source
- [ ] `cult4_review_improvement` routé vers le bon évaluateur
- [ ] `cult4_promote_organizational_asset`
- [ ] `cult4_activate_asset_version`
- [ ] `cult4_rollback_asset_version`
- [ ] `cult4_get_employee_practice` pour charger un contexte ciblé
- [ ] Vues terminal lisibles pour chaque outil, sans JSON brut massif.

Les noms finaux peuvent changer, mais les responsabilités doivent demeurer
séparées et testables.

## 11. Schéma et migrations

- [ ] Ajouter une migration v5 sans réécrire les migrations déjà appliquées.
- [ ] Ajouter des tables versionnées pour les pratiques locales, les versions
      d’actifs, les évaluations, les activations, les mesures de performance et
      les rollbacks.
- [ ] Lier explicitement chaque `employee_run` aux capacités exercées et aux
      versions d’actifs utilisées.
- [ ] Lier une proposition à sa pratique locale source et son WorkItem de
      maintenance organisationnelle.
- [ ] Prévoir des contraintes SQL contre : deux versions actives simultanées,
      auto-évaluation interdite, activation sans QA, rollback vers une version
      inconnue et mesure sans provenance.
- [ ] Migrer les Skills seedés actuels en premières versions actives sans perdre
      leurs liens aux employés.

## 12. Expérience terminal et observabilité

- [ ] Montrer quand un employé détecte un manque de capacité.
- [ ] Montrer l’acquisition live, le micro-test et la reprise du WorkItem initial.
- [ ] Afficher Skill/outil/version utilisé sur un tour sans noyer l’utilisateur.
- [ ] Montrer les gains ou régressions mesurés d’une nouvelle pratique.
- [ ] Afficher les promotions, activations et rollbacks organisationnels.
- [ ] Ajouter à `cult status` une vue concise : compétences en développement,
      pratiques locales, propositions en revue, versions actives et régressions.
- [ ] Garder `D` pour les détails complets et des cartes lisibles pour les outils.

## 13. Tests obligatoires

- [ ] Un Builder découvre qu’il lui manque la capture d’écran web, acquiert la
      pratique live, réussit un micro-test et reprend le même WorkItem.
- [ ] Une acquisition LOW ne demande aucune approbation humaine.
- [ ] Une acquisition nécessitant un compte, un secret, une dépense ou une action
      externe sensible crée le gate exact sans bloquer les apprentissages sûrs.
- [ ] Un apprentissage local utile est utilisable avant sa promotion globale.
- [ ] Une proposition rejetée n’efface pas la pratique locale qui fonctionne
      dans son contexte; elle empêche seulement sa généralisation officielle.
- [ ] Une proposition approuvée produit un commit organisationnel exact, une QA
      indépendante, une version active et une matérialisation réutilisable.
- [ ] L’auteur ne peut ni évaluer ni activer seul sa propre généralisation.
- [ ] Une régression mesurée provoque un rollback vers la dernière version saine.
- [ ] Le routage préfère une expertise démontrée, tout en permettant un parcours
      d’apprentissage contrôlé à un autre employé.
- [ ] Une interruption et une reprise ne perdent ni l’apprentissage local ni
      l’état de promotion.
- [ ] Les anciens WorkItems et la base v4 migrent correctement.
- [ ] La suite complète, le lint, le typecheck, le build et les tests Git/QA
      continuent de passer.

## 14. Documentation et critères de fin

- [ ] Mettre à jour Foundation, Architecture, Domain Model, Security Model,
      README et Runbook.
- [ ] Documenter clairement la frontière entre apprentissage immédiat et
      généralisation organisationnelle.
- [ ] Documenter les risques qui nécessitent réellement une approbation.
- [ ] Fournir un exemple complet et auditable de Skill acquis live puis promu et
      réutilisé par un autre Business.
- [ ] Vérifier qu’aucun prompt ne transforme l’apprentissage en une suite de
      questions A/B/C adressées à l’humain.
- [ ] Vérifier que le système ne prétend jamais qu’un employé « sait » seulement
      parce qu’un slug de capacité existe dans la base.
- [ ] Considérer le chantier terminé seulement lorsque la boucle fonctionne de
      bout en bout dans un test d’intégration, y compris activation et rollback.

## 15. Reprise pratique demain

- [ ] Relire ce document avant de modifier le code.
- [ ] Vérifier qu’aucun processus Cult4/OpenCode n’est encore actif.
- [ ] Décider explicitement d’archiver ou supprimer l’ancien Mercator avant de
      recommencer; un simple `cult` reprendrait autrement son état existant.
- [ ] Implémenter par tranches verticales testables, en commençant par
      l’acquisition live et la persistance d’une pratique locale.
- [ ] Terminer ensuite la promotion versionnée, l’activation mesurée et le
      rollback.
- [ ] Exécuter toute la suite de validation.
- [ ] Utiliser désormais un historique Git normal : commits petits, cohérents et
      descriptifs; branches/worktrees par tranche indépendante; PR et QA lorsque
      pertinent; aucune réécriture systématique de `main`.
- [ ] Réserver `--force-with-lease` aux cas exceptionnels explicitement décidés,
      jamais au workflow quotidien de Cult4.
