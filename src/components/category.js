/**
 * components/category.js
 * Génère la navigation par sous-catégories et la grille des fiches équipement.
 */

import { CATS } from '../data/catalogueStore.js';
import { openModal } from './modal.js';

function getItemModel(item) {
  return item?.model || item?.modele || item?.name || '';
}

function getItemBrand(item) {
  return item?.brand || item?.marque || '';
}

function getItemUsageName(item) {
  return item?.usageName || item?.usage_name || item?.nomUsage || item?.nom_d_usage || '';
}

function getItemDisplayName(item) {
  return getItemUsageName(item) || getItemModel(item) || 'Produit sans nom';
}

function getItemImages(item) {
  const images = [];

  if (Array.isArray(item.imgs)) {
    item.imgs.forEach(src => {
      if (typeof src === 'string' && src.trim()) images.push(src.trim());
    });
  }

  if (typeof item.img === 'string' && item.img.trim()) {
    images.push(item.img.trim());
  }

  return [...new Set(images)];
}

/** Construit une fiche équipement */
function buildListItemKey(item, meta = {}) {
  const values = [
    meta.categoryTitle || '',
    meta.sectionLabel || '',
    item?.brand || item?.marque || '',
    item?.model || item?.modele || item?.name || '',
    item?.usageName || item?.usage_name || item?.nomUsage || item?.nom_d_usage || '',
  ].filter(Boolean);
  return values.join('|');
}

function buildCard(item, sectionLabel, index, categoryKey, categoryTitle) {
  const card = document.createElement('div');
  card.className = 'card';
  card.style.animation      = 'fadeUp .4s both';
  card.style.animationDelay = `${index * 0.055}s`;

  const images = getItemImages(item);
  const displayName = getItemDisplayName(item);

  const mediaHTML = images.length
    ? `
      <div class="card-media" data-media>
        <img class="card-media-img" src="${images[0]}" alt="${displayName}" loading="lazy" />
      </div>`
    : '';

  const shortDesc = (item.desc || '').slice(0, 120);
  const brand = getItemBrand(item);
  const model = getItemModel(item);
  const metaText = [brand, displayName !== model && model ? model : ''].filter(Boolean).join(' • ');
  const listKey = buildListItemKey(item, { categoryTitle, sectionLabel });

  card.innerHTML = `
    ${mediaHTML}
    <div class="card-head">
      <div>
        <div class="card-name">${displayName}</div>
        ${metaText ? `<div class="card-product-meta">${metaText}</div>` : ''}
      </div>
    </div>
    <p class="card-desc">${shortDesc}${shortDesc.length === 120 ? '…' : ''}</p>
    <div class="card-footer">
      <span class="card-arrow" aria-hidden="true">→</span>
    </div>
    <button type="button" class="product-add-btn" data-list-key="${listKey}" aria-label="Ajouter à la liste">+</button>`;

  card.addEventListener('click', event => {
    if (event.target.closest('.product-add-btn')) return;
    openModal(item, { categoryKey, categoryTitle, sectionLabel });
  });

  const addBtn = card.querySelector('.product-add-btn');
  addBtn?.addEventListener('click', event => {
    event.stopPropagation();
    window.magasinImageListAdd?.(item, {
      categoryKey,
      categoryTitle,
      sectionLabel,
    });
  });
  return card;
}

/**
 * Ouvre et rend une page de catégorie
 * @param {string}   catKey     — clé dans CATS
 * @param {function} goHomeFn   — callback retour accueil
 */
export function openCat(catKey, goHomeFn) {
  const cat = CATS[catKey];
  if (!cat) return;

  // Basculer les vues
  document.getElementById('view-home').classList.remove('active');
  document.getElementById('view-contact')?.classList.remove('active');
  document.getElementById('view-cat').classList.add('active');

  // Remplir l'en-tête
  document.getElementById('cat-title').textContent   = cat.title;
  document.getElementById('cat-desc').textContent    = cat.desc;

  const searchInput = document.getElementById('cat-search');
  if (searchInput) {
    searchInput.value = '';
  }

  // Construire la nav sous-catégories
  const nav = document.getElementById('subcat-nav-inner');
  nav.innerHTML = '';

  let activeSectionId = '__all__';

  const allBtn = document.createElement('button');
  allBtn.className = 'subcat-btn active';
  allBtn.textContent = 'Tout';
  allBtn.dataset.section = '__all__';
  nav.appendChild(allBtn);

  cat.sections.forEach(sec => {
    const btn = document.createElement('button');
    btn.className = 'subcat-btn';
    btn.appendChild(document.createTextNode(sec.label));
    btn.dataset.section = sec.id;
    nav.appendChild(btn);
  });

  // Construire les sections + grilles
  const body = document.getElementById('cat-page-body');
  body.innerHTML = '';

  const emptyEl = document.createElement('div');
  emptyEl.className = 'cat-empty';
  emptyEl.textContent = 'Aucun produit ne correspond a votre recherche.';
  body.appendChild(emptyEl);

  cat.sections.forEach(sec => {
    const items = cat.data[sec.id] || [];

    const secEl  = document.createElement('div');
    secEl.className = 'eq-section';
    secEl.id        = `eqsec-${sec.id}`;

    const head = document.createElement('div');
    head.className = 'section-head';
    head.innerHTML = `
      <h2 class="section-title">${sec.title}</h2>`;

    const grid = document.createElement('div');
    grid.className = 'eq-grid';
    grid.id        = `eqgrid-${sec.id}`;

    items.forEach((item, i) => grid.appendChild(buildCard(item, sec.label, i, cat.key, cat.title)));

    secEl.appendChild(head);
    secEl.appendChild(grid);
    body.appendChild(secEl);
  });

  function normalizeText(text) {
    return (text || '').toString().toLowerCase().trim();
  }

  function getSearchValue() {
    return normalizeText(searchInput?.value || '');
  }

  function matchesQuery(item, query, sectionLabel) {
    if (!query) return true;

    const searchable = [
      item.name,
      item.desc,
      item.peda,
      sectionLabel,
      ...(item.tags || []),
      ...(item.specs || []).map(spec => Object.values(spec).join(' ')),
    ].join(' ');

    return normalizeText(searchable).includes(query);
  }

  function applyFilters() {
    const query = getSearchValue();
    let visibleCount = 0;

    cat.sections.forEach(sec => {
      const secEl = document.getElementById(`eqsec-${sec.id}`);
      const cards = secEl?.querySelectorAll('.card') || [];
      let sectionVisibleCards = 0;

      cards.forEach((cardEl, index) => {
        const item = (cat.data[sec.id] || [])[index] || {};
        const visible = matchesQuery(item, query, sec.label);
        cardEl.style.display = visible ? '' : 'none';
        if (visible) sectionVisibleCards += 1;
      });

      const sectionAllowed = activeSectionId === '__all__' || activeSectionId === sec.id;
      const showSection = sectionAllowed && sectionVisibleCards > 0;
      if (secEl) {
        secEl.style.display = showSection ? 'block' : 'none';
      }
      visibleCount += sectionAllowed ? sectionVisibleCards : 0;
    });

    emptyEl.classList.toggle('visible', visibleCount === 0);
  }

  nav.addEventListener('click', event => {
    const btn = event.target.closest('.subcat-btn');
    if (!btn) return;

    activeSectionId = btn.dataset.section || '__all__';
    nav.querySelectorAll('.subcat-btn').forEach(el => el.classList.remove('active'));
    btn.classList.add('active');
    applyFilters();
  });

  searchInput?.addEventListener('input', applyFilters);

  applyFilters();

  window.scrollTo(0, 0);
}
