/**
 * main.js
 * Point d'entrée du projet Vite.
 * Initialise la navigation et branche les événements globaux.
 */

import { initHome }   from './components/home.js';
import { openCat }    from './components/category.js';
import { initModal }  from './components/modal.js';
import { CONTACTS }   from './data/contacts.js';
import { HOME_CARDS } from './data/catalogueStore.js';
import { syncCatalogueFromSheet } from './data/sheetSync.js';

const CATEGORY_THEMES = {
  camera: 'camera',
  objectifs: 'objectifs',
  grip: 'grip',
  lumiere: 'lumiere',
  machinerie: 'machinerie',
  accessoires: 'accessoires',
};

const LIST_STORAGE_KEY = 'magasin-image-list-v1';

function setTheme(themeKey = 'accessoires') {
  document.body.dataset.theme = themeKey;
}

function getListEntries() {
  try {
    return JSON.parse(localStorage.getItem(LIST_STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveListEntries(entries) {
  localStorage.setItem(LIST_STORAGE_KEY, JSON.stringify(entries));
}

function getListItemIdentifier(item, meta = {}) {
  const values = [
    meta.categoryTitle || item?.categoryTitle || '',
    meta.categoryKey || item?.categoryKey || '',
    meta.sectionLabel || item?.sectionLabel || '',
    item?.brand || item?.marque || '',
    item?.model || item?.modele || item?.name || '',
    item?.usageName || item?.usage_name || item?.nomUsage || item?.nom_d_usage || '',
  ].filter(Boolean);

  return values.join('|').trim();
}

function addToList(item, meta = {}) {
  if (!item) return;

  const entries = getListEntries();
  const nextId = getListItemIdentifier(item, meta);
  const alreadyAdded = entries.some(entry => entry.id === nextId);

  if (alreadyAdded) {
    removeFromList(nextId);
    return;
  }

  const nextEntry = {
    id: nextId,
    categoryKey: meta.categoryKey || item.categoryKey || '',
    categoryTitle: meta.categoryTitle || item.categoryTitle || 'Sans catégorie',
    sectionLabel: meta.sectionLabel || item.sectionLabel || '',
    brand: item.brand || item.marque || '',
    model: item.model || item.modele || item.name || '',
    usageName: item.usageName || item.usage_name || item.nomUsage || item.nom_d_usage || '',
    desc: item.desc || '',
    peda: item.peda || '',
    imgs: Array.isArray(item.imgs) ? item.imgs : (typeof item.img === 'string' ? [item.img] : []),
    img: typeof item.img === 'string' ? item.img : (Array.isArray(item.imgs) ? item.imgs[0] || '' : ''),
    raw: item,
  };

  entries.push(nextEntry);
  saveListEntries(entries);
  renderListView();
  updateListButtons();
}

function removeFromList(id) {
  const nextEntries = getListEntries().filter(entry => entry.id !== id);
  saveListEntries(nextEntries);
  renderListView();
  updateListButtons();
}

function updateListButtons() {
  const entries = getListEntries();
  const ids = new Set(entries.map(entry => entry.id));

  document.querySelectorAll('[data-list-key]').forEach(btn => {
    const isAdded = ids.has(btn.dataset.listKey);
    btn.classList.toggle('added', isAdded);
    btn.textContent = isAdded ? '✓' : '+';
    btn.setAttribute('aria-label', isAdded ? 'Retirer de la liste' : 'Ajouter à la liste');
    btn.title = isAdded ? 'Retirer de la liste' : 'Ajouter à la liste';
  });
}

function escapeCsvCell(value) {
  const text = (value ?? '').toString().replace(/\r?\n/g, ' ');
  if (/[",]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function exportList() {
  const entries = getListEntries();
  if (!entries.length) {
    window.alert('Aucune sélection pour exporter.');
    return;
  }

  const grouped = {};
  entries.forEach(entry => {
    const key = entry.categoryTitle || 'Sans catégorie';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(entry);
  });

  const rows = [];
  Object.entries(grouped).forEach(([categoryTitle, groupEntries]) => {
    rows.push([categoryTitle]);
    rows.push(['Catégorie', 'Produit']);
    groupEntries.forEach(entry => {
      rows.push([
        categoryTitle,
        entry.usageName || entry.model || 'Produit',
      ]);
    });
    rows.push([]);
  });

  const csv = rows.map(row => row.map(escapeCsvCell).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const csvUrl = URL.createObjectURL(blob);
  const csvLink = document.createElement('a');
  csvLink.href = csvUrl;
  csvLink.download = 'liste-magasin-image.csv';
  document.body.appendChild(csvLink);
  csvLink.click();
  csvLink.remove();
  URL.revokeObjectURL(csvUrl);

  // Le CSV est téléchargé directement par le navigateur sans ouvrir d'onglet supplémentaire.
}

function renderListView() {
  const container = document.getElementById('list-groups');
  const summary = document.getElementById('list-summary-count');
  if (!container || !summary) return;

  const entries = getListEntries();
  summary.textContent = `${entries.length} produit${entries.length > 1 ? 's' : ''}`;

  if (!entries.length) {
    container.innerHTML = `
      <div class="list-empty-state">
        <p>Aucune sélection pour le moment.</p>
        <span>Ajoutez des produits avec le bouton + sur les fiches.</span>
      </div>
    `;
    return;
  }

  const grouped = {};
  entries.forEach(entry => {
    const cat = entry.categoryTitle || 'Sans catégorie';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(entry);
  });

  container.innerHTML = Object.entries(grouped).map(([categoryTitle, groupEntries]) => `
    <div class="list-group">
      <div class="list-group-title">${categoryTitle}</div>
      <div class="list-group-items">
        ${groupEntries.map(entry => `
          <div class="list-item">
            <div class="list-item-copy">
              <div class="list-item-name">${entry.usageName || entry.model || 'Produit'}</div>
              <div class="list-item-meta">${[entry.brand, entry.model].filter(Boolean).join(' • ') || entry.sectionLabel || 'Produit'}</div>
            </div>
            <button class="list-item-remove" type="button" data-remove-key="${entry.id}">Retirer</button>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');

  document.querySelectorAll('[data-remove-key]').forEach(button => {
    button.addEventListener('click', () => removeFromList(button.dataset.removeKey));
  });
}

function syncListTabState(activeView) {
  const tabBtn = document.getElementById('list-tab-btn');
  if (!tabBtn) return;
  tabBtn.classList.toggle('active', activeView === 'list');
}

function goHome() {
  setTheme('accessoires');
  document.body.classList.add('home-reentry');
  document.getElementById('view-home').classList.add('active');
  document.getElementById('view-cat').classList.remove('active');
  document.getElementById('view-list').classList.remove('active');
  document.getElementById('view-contact').classList.remove('active');
  updateHeaderActiveCategory(null);
  syncListTabState('home');
  window.history.pushState({ view: 'home' }, '', window.location.pathname);
  window.scrollTo(0, 0);
}

function openList() {
  setTheme('accessoires');
  document.getElementById('view-home').classList.remove('active');
  document.getElementById('view-cat').classList.remove('active');
  document.getElementById('view-contact').classList.remove('active');
  document.getElementById('view-list').classList.add('active');
  updateHeaderActiveCategory(null);
  syncListTabState('list');
  renderListView();
  window.history.pushState({ view: 'list' }, '', window.location.pathname + '#liste');
  window.scrollTo(0, 0);
}

/* ──────────────────────────────────────────────────────────
   Navigation
   ────────────────────────────────────────────────────────── */

/** Accès à la page contact */
function goContact() {
  setTheme('accessoires');
  document.getElementById('view-home').classList.remove('active');
  document.getElementById('view-cat').classList.remove('active');
  document.getElementById('view-list').classList.remove('active');
  document.getElementById('view-contact').classList.add('active');

  updateHeaderActiveCategory(null);
  syncListTabState('contact');
  renderContacts();
  window.scrollTo(0, 0);
}

function updateHeaderActiveCategory(activeKey) {
  const nav = document.getElementById('h-cats');
  if (!nav) return;

  nav.querySelectorAll('.h-cat-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.key === activeKey);
  });
}

function initHeaderCategoryNav(openCategoryFn) {
  const nav = document.getElementById('h-cats');
  if (!nav) return;

  nav.innerHTML = '';

  HOME_CARDS.forEach(card => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'h-cat-btn';
    btn.dataset.key = card.key;
    btn.textContent = card.name;
    btn.addEventListener('click', () => {
      openCategoryFn(card.key);
      updateHeaderActiveCategory(card.key);
    });
    nav.appendChild(btn);
  });
}

/** Affiche la liste des contacts */
function renderContacts() {
  const listEl = document.getElementById('contact-list');
  if (!listEl) return;

  listEl.innerHTML = '';

  CONTACTS.forEach(contact => {
    const card = document.createElement('div');
    card.className = 'contact-card';

    card.innerHTML = `
      <div class="contact-role">${contact.role}</div>
      <div class="contact-name">${contact.name}</div>
      <div class="contact-item">
        <div class="contact-label">Email</div>
        <div class="contact-value"><a href="mailto:${contact.email}">${contact.email}</a></div>
      </div>
      <div class="contact-item">
        <div class="contact-label">Téléphone</div>
        <div class="contact-value"><a href="tel:${contact.phone.replace(/\s/g, '')}">${contact.phone}</a></div>
      </div>`;

    listEl.appendChild(card);
  });
}

/* ──────────────────────────────────────────────────────────
   Init au chargement du DOM
   ────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  setTheme('accessoires');

  window.magasinImageListAdd = addToList;
  window.magasinImageListUpdateButtons = updateListButtons;

  const openCategory = catKey => {
    setTheme(CATEGORY_THEMES[catKey] || 'accessoires');
    openCat(catKey, goHome);
    updateHeaderActiveCategory(catKey);
    window.history.pushState({ view: 'category', catKey }, '', `#${catKey}`);
  };
  await syncCatalogueFromSheet();

  // Modale
  initModal();

  // Grille d'accueil (injecte les cartes catégories)
  initHome(openCategory);

  // Raccourcis catégories dans le header
  initHeaderCategoryNav(openCategory);

  // Bouton logo
  document.getElementById('logo-btn')
    .addEventListener('click', goHome);

  document.getElementById('list-tab-btn')
    .addEventListener('click', openList);

  document.getElementById('list-back-btn')
    .addEventListener('click', goHome);

  document.getElementById('list-export-btn')
    .addEventListener('click', exportList);

  // Boutons « retour » de la vue catégorie
  const backBtn = document.getElementById('back-btn');
  const backBtnFooter = document.getElementById('back-btn-footer');
  if (backBtn) backBtn.addEventListener('click', goHome);
  if (backBtnFooter) backBtnFooter.addEventListener('click', goHome);

  // Bouton contact — footers (accueil/categorie/contact)
  document.querySelectorAll('[data-footer-contact]').forEach(btn => {
    btn.addEventListener('click', goContact);
  });

  // Boutons « retour » de la vue contact
  const backBtnContact = document.getElementById('back-btn-contact');
  const backBtnContactFooter = document.getElementById('back-btn-contact-footer');
  if (backBtnContact) backBtnContact.addEventListener('click', goHome);
  if (backBtnContactFooter) backBtnContactFooter.addEventListener('click', goHome);

  renderListView();
  updateListButtons();

  const introOverlay = document.getElementById('intro-overlay');
  if (introOverlay) {
    window.setTimeout(() => {
      introOverlay.classList.add('is-hidden');
      document.body.classList.remove('intro-active');
    }, 200);
  } else {
    document.body.classList.remove('intro-active');
  }

  window.addEventListener('popstate', () => {
    const catView = document.getElementById('view-cat');
    const listView = document.getElementById('view-list');
    if (catView?.classList.contains('active')) {
      goHome();
    } else if (listView?.classList.contains('active')) {
      goHome();
    }
  });

});
