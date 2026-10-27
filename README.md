# Magasin Image — Catalogue équipement

Site catalogue pédagogique pour le magasin image de l'INSAS.

## Maintenance via Google Sheets

Le Google Sheet est la base de donnees principale du site pour les equipements.
Au chargement, le site remplace les donnees locales par les lignes du Sheet (CSV public).

### Synchroniser les photos Cloudinary vers le Sheet

Un script est disponible pour remplir automatiquement les colonnes `img` et `imgs`
dans les onglets `items.<categorie>` a partir de ton arborescence Cloudinary.

Hypothese de travail :

- chaque produit a son propre dossier Cloudinary
- le nom du dossier produit correspond au nom du produit dans le Sheet
- les photos sont stockees sous un prefixe commun, par defaut `Photos/`

Commande de verification :

```bash
CLOUDINARY_CLOUD_NAME=xxx \
CLOUDINARY_API_KEY=xxx \
CLOUDINARY_API_SECRET=xxx \
GOOGLE_SERVICE_ACCOUNT_JSON=./credentials/magasin-image-sheet-8c2a07b02ddd.json \
npm run sheet:cloudinary-sync -- --dry-run
```

Commande d'ecriture reelle :

```bash
CLOUDINARY_CLOUD_NAME=xxx \
CLOUDINARY_API_KEY=xxx \
CLOUDINARY_API_SECRET=xxx \
GOOGLE_SERVICE_ACCOUNT_JSON=./credentials/magasin-image-sheet-8c2a07b02ddd.json \
npm run sheet:cloudinary-sync -- --write
```

Options utiles :

- `--base-folder=Photos` : prefixe Cloudinary a scanner
- `--spreadsheet-id=<id>` : force un autre Google Sheet
- `--category=<key|nom>` : limite la synchro a une categorie
- `--section=<id|nom>` : limite la synchro a une section
- `--skip-existing` : preserve `img` / `imgs` deja renseignes dans le Sheet

Comportement :

- `img` recoit la premiere image du dossier produit
- `imgs` recoit les images suivantes, separees par `|`
- si plusieurs dossiers Cloudinary correspondent au meme produit, le script ignore la ligne et l'affiche comme ambiguë

### 1) Activer la synchro

Modifier [src/data/sheetConfig.js](src/data/sheetConfig.js):

```js
export const SHEET_SYNC_CONFIG = {
  enabled: true,
  spreadsheetId: 'TON_SPREADSHEET_ID',
  sheetNames: {
    items: 'catalogue.sheet',
    categories: 'categories',
    sections: 'sections',
  },
  csvUrl: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSeeHLaYyrrwboWmYc4-yEC2k5ywC7jGvNRCvlaDVxTpMekOWVP5sZ4Oucjrtwpa5LG6WF-eDwk5kS2/pubhtml',
  timeoutMs: 6000,
};
```

`spreadsheetId` active le mode multi-onglets:

- `categories`: categories editables directement dans le Sheet
- `sections`: sections editables directement dans le Sheet
- `catalogue.sheet`: equipements

Si `spreadsheetId` est vide, le site retombe sur l'ancien mode CSV unique (`csvUrl`).

### 2) Format de la feuille (colonnes)

Le workflow recommande 3 onglets:

- `categories`
- `sections`
- `catalogue.sheet`

#### Onglet `categories`

- `enabled`, `key`, `title`, `desc`
- `home_name`, `home_desc`, `home_img`, `home_letter`, `home_tags`, `order`

#### Onglet `sections`

- `enabled`, `category`, `id`, `num`, `label`, `title`, `sub`, `order`

#### Onglet `catalogue.sheet`

- `enabled`: `true` / `false` (ligne active ou non)
- `category`: cle categorie (`camera`, `objectifs`, `lumiere`, `grip`, `machinerie`, `accessoires`)
- `section`: id section (ou label)
- `name`: nom de l'equipement
- `desc`, `peda`, `img`, `imgs`, `manuel`, `tags`, `specs`
- `lienLabel`, `lienUrl`, `lienLabel2`, `lienUrl2`, `lienLabel3`, `lienUrl3`

Le script `npm run sheet:create` configure aussi les dropdowns:

- `category`: liste des categories autorisees
- `section`: validation geree en temps reel via Apps Script (voir ci-dessous)

Il cree/maintient un onglet technique `_options` pour alimenter ces listes.

### Validation dynamique category -> section (temps reel, onglets items.*)

Pour obtenir exactement le comportement suivant sur les onglets `items.<categorie>`:

- choisir `machinerie` => sections proposees: `dolly`, `supports`, `stabilisation`, `rig`
- changer de categorie => la liste `section` de la ligne s'actualise automatiquement

Utiliser Google Apps Script:

1. Generer le script depuis le catalogue local:

```bash
npm run sheet:apps-script
```

2. Ouvrir ton Google Sheet, puis `Extensions > Apps Script`.
3. Remplacer le contenu de `Code.gs` par [tools/google-sheet/sectionValidation.generated.gs](tools/google-sheet/sectionValidation.generated.gs).
4. Executer une fois `refreshAllSectionValidations()` (autoriser le script), puis sauvegarder.

Ensuite, chaque modification de `category` mettra a jour les options de `section` de la meme ligne.

Formats pratiques:

- `imgs`: plusieurs URLs separees par `|`
- `tags`: separes par virgules
- `specs`: `Cle=Valeur|Cle2=Valeur2`

### 3) Publier la feuille

Dans Google Sheets:

1. `Fichier > Partager > Publier sur le Web`
2. Choisir l'onglet `catalogue`
3. Format `CSV`
4. Copier l'URL publique CSV dans `csvUrl`

### 4) Creer le Google Sheet depuis catalogue.js

Commande unique:

```bash
npm run sheet:create
```

Ce script:

- exporte toutes les lignes dans [tools/google-sheet/catalogue.sheet.csv](tools/google-sheet/catalogue.sheet.csv)
- cree ou met a jour un Google Sheet via API si des credentials sont fournis
- cree/met a jour aussi les onglets `categories` et `sections`

Variables d'environnement API:

- `GOOGLE_SERVICE_ACCOUNT_JSON`: chemin vers le JSON de service account
- `GOOGLE_SHEET_ID` (optionnel): si present, met a jour ce Sheet; sinon, en cree un nouveau

Exemple:

```bash
GOOGLE_SERVICE_ACCOUNT_JSON=./credentials/google-service-account.json npm run sheet:create
```

Puis:

1. Partager le fichier Google Sheet avec ton compte Google (edition)
2. Renseigner `spreadsheetId` dans [src/data/sheetConfig.js](src/data/sheetConfig.js)
3. Partager le Sheet publiquement en lecture si le site doit le consommer cote client

### Comportement

- Si la feuille est indisponible, le site continue avec les donnees locales de [src/data/catalogue.js](src/data/catalogue.js).
- La synchro est appliquee au chargement de la page et remplace categories, sections et equipements.

### Accès en local

```bash
npm run dev -- --host 127.0.0.1
```

## Structure du projet

```
magasin-image/
├── index.html                  ← Page HTML principale (point d'entrée Vite)
├── package.json
├── vite.config.js
└── src/
    ├── main.js                 ← Point d'entrée JavaScript
    ├── styles/
    │   ├── base.css            ← Variables CSS, reset, body
    │   ├── header.css          ← Barre de navigation
    │   ├── home.css            ← Page d'accueil (hero + grille catégories)
    │   ├── category.css        ← Page catégorie, nav sous-cats, sections
    │   ├── card.css            ← Fiches équipement
    │   ├── modal.css           ← Fenêtre modale de détail
    │   └── responsive.css      ← Media queries (mobile/tablette)
    ├── components/
    │   ├── home.js             ← Rendu grille d'accueil
    │   ├── category.js         ← Rendu page catégorie + filtres
    │   └── modal.js            ← Logique modale (ouverture/fermeture)
    └── data/
        ├── catalogue.js        ← Toutes les données équipement (CATS + HOME_CARDS)
```

## Démarrage rapide

```bash
# 1. Installer les dépendances
npm install

# 2. Lancer le serveur de développement
npm run dev
# → http://localhost:5173

# Outil catalogue autonome

# 3. Builder pour la production
npm run build
# → dossier dist/

# 4. Prévisualiser le build
npm run preview
```

## Ajouter un équipement

Ouvrir `src/data/catalogue.js` et ajouter une entrée dans le tableau `data` de la catégorie concernée :

```js
{
  name: "Nom de l'équipement",
  img: "https://url-de-la-photo.jpg",       // optionnel
  manuel: "https://url-du-manuel.pdf",       // optionnel
  desc: "Description de l'équipement.",
  peda: "Usage pédagogique.",
  specs: [
    { Puissance: "200 W" },
    { CCT: "3200–5600 K" },
    // ...
  ],
}
```

## Ajouter une catégorie

1. Ajouter une entrée dans `CATS` dans `src/data/catalogue.js`
2. Ajouter une carte dans `HOME_CARDS` dans le même fichier
