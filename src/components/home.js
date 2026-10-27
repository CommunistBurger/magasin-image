/**
 * components/home.js
 * Génère et injecte les cartes de catégories sur la page d'accueil.
 */

import { CATS, HOME_CARDS } from '../data/catalogueStore.js';
import { openModal } from './modal.js';

const MAX_RESULTS = 12;

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

/**
 * Construit une carte catégorie
 * @param {object} card — entrée de HOME_CARDS
 * @param {function} onClickFn — callback openCat(key)
 */
function buildCatCard(card, onClickFn) {
  const btn = document.createElement('button');
  btn.className   = 'cat-card';
  btn.dataset.theme = card.key || 'accessoires';

  btn.innerHTML = `
    <div class="cat-img" style="background-image:url('${card.img}')"></div>
    <div class="cat-body">
      <div class="cat-name">${card.name}</div>
      <p class="cat-desc">${card.desc}</p>
      <span class="cat-access" aria-hidden="true">→</span>
    </div>`;

  btn.addEventListener('click', () => onClickFn(card.key));
  return btn;
}

/**
 * Initialise la grille d'accueil
 * @param {function} openCatFn — fonction de navigation vers une catégorie
 */
export function initHome(openCatFn) {
  const grid = document.getElementById('cat-grid');
  if (!grid) return;

  grid.innerHTML = '';
  HOME_CARDS.forEach(card => {
    grid.appendChild(buildCatCard(card, openCatFn));
  });

  initHomeSearch();
}

function normalizeText(value) {
  return (value || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
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

function buildSearchIndex() {
  const index = [];

  Object.entries(CATS).forEach(([catKey, cat]) => {
    (cat.sections || []).forEach(section => {
      const items = cat.data?.[section.id] || [];

      items.forEach(item => {
        const hasUsefulContent = item && (getItemModel(item) || getItemUsageName(item) || item.desc);
        if (!hasUsefulContent) return;

        index.push({
          item,
          catKey,
          catTitle: cat.title,
          sectionLabel: section.label,
          searchBlob: normalizeText([
            getItemModel(item),
            getItemBrand(item),
            getItemUsageName(item),
            item.desc,
            item.peda,
            cat.title,
            section.label,
            ...(item.tags || []),
            ...(item.specs || []).map(spec => Object.values(spec).join(' ')),
          ].join(' ')),
        });
      });
    });
  });

  return index;
}

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

function buildResultCard(entry) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'home-product-card';

  const images = getItemImages(entry.item);
  const displayName = getItemDisplayName(entry.item);
  const brand = getItemBrand(entry.item);
  const model = getItemModel(entry.item);
  const metaText = [brand, displayName !== model && model ? model : ''].filter(Boolean).join(' • ');
  const mediaHTML = images.length
    ? `<div class="home-product-media">
        <img class="home-product-media-img" src="${images[0]}" alt="${displayName}" loading="lazy" />
      </div>`
    : '';
  const listKey = buildListItemKey(entry.item, { categoryTitle: entry.catTitle, sectionLabel: entry.sectionLabel });

  card.innerHTML = `
    ${mediaHTML}
    <div class="home-product-name">${displayName}</div>
    ${metaText ? `<div class="home-product-meta-line">${metaText}</div>` : ''}
    <p class="home-product-desc">${(entry.item.desc || '').slice(0, 120)}${(entry.item.desc || '').length > 120 ? '...' : ''}</p>
    <div class="home-product-meta">
      <span>${entry.catTitle}</span>
      <span>${entry.sectionLabel}</span>
    </div>
    <button type="button" class="product-add-btn" data-list-key="${listKey}" aria-label="Ajouter à la liste">+</button>`;

  card.addEventListener('click', event => {
    if (event.target.closest('.product-add-btn')) return;
    openModal(entry.item, { categoryKey: entry.catKey, categoryTitle: entry.catTitle, sectionLabel: entry.sectionLabel });
  });

  const addBtn = card.querySelector('.product-add-btn');
  addBtn?.addEventListener('click', event => {
    event.stopPropagation();
    window.magasinImageListAdd?.(entry.item, {
      categoryKey: entry.catKey,
      categoryTitle: entry.catTitle,
      sectionLabel: entry.sectionLabel,
    });
  });
  return card;
}

function initHomeSearch() {
  const input = document.getElementById('home-search-input');
  const resultsWrap = document.getElementById('home-search-results');
  const countEl = document.getElementById('home-search-count');
  const grid = document.getElementById('home-results-grid');
  const emptyEl = document.getElementById('home-search-empty');
  const moreEl = document.getElementById('home-search-more');

  if (!input || !resultsWrap || !countEl || !grid || !emptyEl || !moreEl) return;

  const searchIndex = buildSearchIndex();

  function renderResults() {
    const query = normalizeText(input.value);

    if (!query) {
      resultsWrap.style.display = 'none';
      grid.innerHTML = '';
      moreEl.style.display = 'none';
      return;
    }

    const matches = searchIndex.filter(entry => entry.searchBlob.includes(query));
    const visibleMatches = matches.slice(0, MAX_RESULTS);

    countEl.textContent = `${matches.length} resultat${matches.length > 1 ? 's' : ''}`;
    resultsWrap.style.display = 'block';
    emptyEl.style.display = matches.length === 0 ? 'block' : 'none';

    grid.innerHTML = '';
    visibleMatches.forEach(entry => grid.appendChild(buildResultCard(entry)));

    if (matches.length > MAX_RESULTS) {
      moreEl.textContent = `${matches.length - MAX_RESULTS} autre(s) resultat(s) non affiche(s).`;
      moreEl.style.display = 'block';
    } else {
      moreEl.style.display = 'none';
    }
  }

  input.addEventListener('input', renderResults);
  renderResults();
}
