import { CATS, HOME_CARDS, replaceCatalogueStructure } from './catalogueStore.js';
import { CONTACTS } from './contacts.js';
import { SHEET_SYNC_CONFIG } from './sheetConfig.js';

function normalizeText(value) {
  return (value || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function normalizeHeader(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function boolFromCell(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = normalizeText(value);
  if (['false', '0', 'no', 'non', 'off', 'faux', 'unchecked'].includes(normalized)) return false;
  if (['true', '1', 'yes', 'oui', 'on', 'vrai', 'checked'].includes(normalized)) return true;
  return fallback;
}

function parseCsv(csvText) {
  const rows = [];
  let row = [];
  let field = '';
  let i = 0;
  let inQuotes = false;

  while (i < csvText.length) {
    const char = csvText[i];

    if (inQuotes) {
      if (char === '"') {
        if (csvText[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }

    if (char === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }

    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }

    if (char === '\r') {
      i += 1;
      continue;
    }

    field += char;
    i += 1;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function parseRows(csvText) {
  const matrix = parseCsv(csvText);
  if (!matrix.length) return [];

  const firstHeaders = matrix[0].map(h => normalizeHeader(h));
  const secondHeaders = (matrix[1] || []).map(h => normalizeHeader(h));
  const required = ['enabled', 'category', 'section', 'name'];
  const recognizedAliases = [
    'enabled', 'actif', 'active',
    'category', 'categorie', 'catégorie', 'key', 'cle_categorie', 'cle',
    'section', 'sous_categorie', 'sous-categorie', 'section_id', 'cle_section',
    'name', 'nom', 'nom_du_produit', 'nom_produit',
    'title', 'titre', 'titre_categorie', 'label',
    'desc', 'description', 'description_categorie', 'home_desc', 'card_desc',
    'home_name', 'card_name', 'nom_carte_accueil',
    'home_img', 'img', 'image', 'image_carte_accueil', 'image_principale',
    'imgs', 'images', 'images_supplementaires',
    'home_tags', 'tags', 'tags_accueil',
    'order', 'ordre', 'position', 'sort', 'num', 'number', 'numero',
    'peda', 'pedagogie', 'specs', 'specifications', 'manuel',
    'modele', 'model', 'modèle', 'marque', 'brand',
    'nom_usage', 'usage_name', 'nom_d_usage', 'usage', 'nom_usage_fr',
    'lienlabel', 'lien_label', 'lienurl', 'lien_url',
    'lienlabel2', 'lien_label2', 'lienurl2', 'lien_url2',
    'lienlabel3', 'lien_label3', 'lienurl3', 'lien_url3',
  ];

  const firstScore = required.filter(key => firstHeaders.includes(key)).length;
  const secondScore = required.filter(key => secondHeaders.includes(key)).length;
  const secondKnownKeyCount = secondHeaders.filter(header => recognizedAliases.includes(header)).length;

  const secondLooksCanonical = required.every(key => secondHeaders.includes(key));
  const useSecondRowAsHeaders = secondLooksCanonical || secondScore > firstScore || secondKnownKeyCount >= 4;
  const headers = useSecondRowAsHeaders ? secondHeaders : firstHeaders;
  const dataStartIndex = useSecondRowAsHeaders ? 2 : 1;

  return matrix
    .slice(dataStartIndex)
    .filter(r => r.some(cell => (cell || '').trim() !== ''))
    .map(r => {
      const rowObj = {};
      headers.forEach((header, index) => {
        rowObj[header] = (r[index] || '').trim();
      });

      const columnNames = new Set([...firstHeaders, ...secondHeaders, ...headers]);
      const looksLikeCategorySheet =
        columnNames.has('key') ||
        columnNames.has('cle_categorie') ||
        columnNames.has('categorie') ||
        columnNames.has('titre_categorie') ||
        columnNames.has('title');

      if (!looksLikeCategorySheet) {
        if (!hasAnyColumn(rowObj, ['category', 'categorie', 'catégorie', 'cle_categorie']) && r.length > 1) {
          rowObj.category = (r[1] || '').trim();
        }
        if (!hasAnyColumn(rowObj, ['section', 'sous_categorie', 'sous-categorie', 'sous_categorie_id', 'section_id']) && r.length > 2) {
          rowObj.section = (r[2] || '').trim();
        }
        if (!hasAnyColumn(rowObj, ['name', 'nom', 'nom_du_produit', 'nom_produit']) && r.length > 3) {
          rowObj.name = (r[3] || '').trim();
        }
      }

      return rowObj;
    });
}

function hasAnyColumn(row, aliases) {
  return aliases.some(alias => Object.prototype.hasOwnProperty.call(row, alias));
}

function readColumn(row, aliases) {
  for (const alias of aliases) {
    if (row[alias] !== undefined && row[alias] !== '') return row[alias];
  }
  return '';
}

function getModelValue(row) {
  return readColumn(row, ['modele', 'model', 'modèle', 'nom_du_produit', 'nom_produit', 'name', 'nom']);
}

function getBrandValue(row) {
  return readColumn(row, ['marque', 'brand']);
}

function getUsageNameValue(row) {
  return readColumn(row, ['nom_usage', 'usage_name', 'nom_d_usage', 'usage', 'nom_usage_fr']);
}

function getSpecsValue(row) {
  return readColumn(row, ['specs', 'specifications', 'caracteristiques']);
}

function parseImages(value) {
  if (!value) return [];
  return value
    .split(/\||\n/)
    .map(v => v.trim())
    .filter(Boolean);
}

function parseTags(value) {
  if (!value) return [];
  return value
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
}

function parseSpecs(value) {
  if (!value) return [];

  const trimmed = value.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.filter(spec => spec && typeof spec === 'object' && !Array.isArray(spec));
      }
    } catch (_) {
      // Fallback to key=value parser.
    }
  }

  return trimmed
    .split('|')
    .map(entry => entry.trim())
    .filter(Boolean)
    .map(entry => {
      const splitIndex = entry.includes('=') ? entry.indexOf('=') : entry.indexOf(':');
      if (splitIndex < 1) return null;

      const key = entry.slice(0, splitIndex).trim();
      const val = entry.slice(splitIndex + 1).trim();
      if (!key) return null;
      return { [key]: val };
    })
    .filter(Boolean);
}

function findCategoryKey(categoryValue) {
  const norm = normalizeText(categoryValue);
  if (!norm) return '';

  if (CATS[categoryValue]) return categoryValue;

  return Object.keys(CATS).find(key => {
    const cat = CATS[key];
    return normalizeText(key) === norm || normalizeText(cat.title) === norm;
  }) || '';
}

function findCategoryKeyInMap(categoryMap, categoryValue) {
  const norm = normalizeText(categoryValue);
  if (!norm) return '';

  if (categoryMap[categoryValue]) return categoryValue;

  return Object.keys(categoryMap).find(key => {
    const cat = categoryMap[key];
    return normalizeText(key) === norm || normalizeText(cat.title) === norm;
  }) || '';
}

function findSectionId(category, sectionValue) {
  const norm = normalizeText(sectionValue);
  if (!norm) return '';

  const sections = category.sections || [];
  const match = sections.find(sec => {
    return (
      normalizeText(sec.id) === norm ||
      normalizeText(sec.label) === norm ||
      normalizeText(sec.title) === norm
    );
  });

  return match?.id || '';
}

function buildEmptyDataMap() {
  const map = {};

  Object.keys(CATS).forEach(catKey => {
    map[catKey] = {};
    const sections = CATS[catKey]?.sections || [];
    sections.forEach(section => {
      map[catKey][section.id] = [];
    });
  });

  return map;
}

function replaceContacts(nextContacts) {
  CONTACTS.length = 0;
  nextContacts.forEach(contact => CONTACTS.push(contact));
}

function buildDynamicCatalogue(categoryRows, sectionRows, itemRows, contactsRows = []) {
  const nextCats = {};
  const nextHomeCards = [];
  const nextContacts = [];

  categoryRows.forEach((row, index) => {
    const enabled = boolFromCell(readColumn(row, ['enabled', 'actif', 'active']), true);
    if (!enabled) return;

    const key = readColumn(row, ['key', 'category', 'categorie', 'cle_categorie', 'cle']);
    const title = readColumn(row, ['title', 'titre_categorie', 'titre', 'name', 'nom']);
    if (!key || !title) return;

    nextCats[key] = {
      title,
      desc: readColumn(row, ['desc', 'description', 'description_categorie']),
      sections: [],
      data: {},
    };

    nextHomeCards.push({
      key,
      img: readColumn(row, ['home_img', 'img', 'image', 'image_carte_accueil']),
      name: readColumn(row, ['home_name', 'card_name', 'nom_carte_accueil']) || title,
      desc: readColumn(row, ['home_desc', 'card_desc', 'desc', 'description', 'description_carte_accueil']),
      tags: parseTags(readColumn(row, ['home_tags', 'tags', 'tags_accueil'])),
      order: readColumn(row, ['order', 'sort', 'position', 'ordre']) || String(index),
    });
  });

  sectionRows.forEach((row, index) => {
    const enabled = boolFromCell(readColumn(row, ['enabled', 'actif', 'active']), true);
    if (!enabled) return;

    const categoryKey = readColumn(row, ['category', 'categorie', 'cle_categorie', 'cle']);
    const category = nextCats[categoryKey];
    if (!category) return;

    const sectionId = readColumn(row, ['id', 'section', 'section_id', 'cle_section']);
    const label = readColumn(row, ['label', 'name', 'nom', 'titre', 'title']);
    if (!sectionId || !label) return;

    category.sections.push({
      id: sectionId,
      num: readColumn(row, ['num', 'number', 'numero']) || String(index + 1).padStart(2, '0'),
      label,
      title: readColumn(row, ['title', 'titre']) || label,
      sub: readColumn(row, ['sub', 'subtitle', 'sous_titre']),
      order: readColumn(row, ['order', 'sort', 'position', 'ordre']) || String(index),
    });
    category.data[sectionId] = [];
  });

  itemRows.forEach(row => {
    const enabledAliases = ['enabled', 'actif', 'active'];
    const enabled = boolFromCell(
      readColumn(row, enabledAliases),
      true,
    );
    if (!enabled) return;

    const categoryValue = readColumn(row, ['category', 'categorie', 'catégorie', 'cle_categorie']);
    const sectionValue = readColumn(row, ['section', 'sous_categorie', 'sous-categorie', 'sous_categorie_id', 'section_id']);
    const model = getModelValue(row);
    if (!categoryValue || !sectionValue || !model) return;

    const categoryKey = findCategoryKeyInMap(nextCats, categoryValue);
    if (!categoryKey) return;

    const category = nextCats[categoryKey];
    const sectionId = findSectionId(category, sectionValue);
    if (!sectionId) return;

    const item = {
      model,
      brand: getBrandValue(row),
      usageName: getUsageNameValue(row),
      name: model,
      desc: readColumn(row, ['desc', 'description']),
      peda: readColumn(row, ['peda', 'pedagogie']),
      specs: parseSpecs(getSpecsValue(row)),
    };

    const img = readColumn(row, ['img', 'image', 'image_principale']);
    const imgs = parseImages(readColumn(row, ['imgs', 'images', 'images_supplementaires']));
    const manuel = readColumn(row, ['manuel', 'manual']);
    const tags = parseTags(readColumn(row, ['tags']));
    const lienLabel = readColumn(row, ['lienlabel', 'lien_label']);
    const lienUrl = readColumn(row, ['lienurl', 'lien_url']);
    const lienLabel2 = readColumn(row, ['lienlabel2', 'lien_label2']);
    const lienUrl2 = readColumn(row, ['lienurl2', 'lien_url2']);
    const lienLabel3 = readColumn(row, ['lienlabel3', 'lien_label3']);
    const lienUrl3 = readColumn(row, ['lienurl3', 'lien_url3']);

    if (img) item.img = img;
    if (imgs.length) item.imgs = imgs;
    if (manuel) item.manuel = manuel;
    if (tags.length) item.tags = tags;
    if (lienLabel) item.lienLabel = lienLabel;
    if (lienUrl) item.lienUrl = lienUrl;
    if (lienLabel2) item.lienLabel2 = lienLabel2;
    if (lienUrl2) item.lienUrl2 = lienUrl2;
    if (lienLabel3) item.lienLabel3 = lienLabel3;
    if (lienUrl3) item.lienUrl3 = lienUrl3;

    category.data[sectionId].push(item);
  });

  Object.values(nextCats).forEach(category => {
    category.sections.sort((a, b) => String(a.order).localeCompare(String(b.order), undefined, { numeric: true }));
    category.sections.forEach(section => delete section.order);
  });

  nextHomeCards.sort((a, b) => String(a.order).localeCompare(String(b.order), undefined, { numeric: true }));
  nextHomeCards.forEach(card => delete card.order);

  contactsRows.forEach((row, index) => {
    const enabled = boolFromCell(readColumn(row, ['enabled', 'actif', 'active']), true);
    if (!enabled) return;

    const name = readColumn(row, ['name', 'nom']);
    const role = readColumn(row, ['role', 'fonction']);
    const email = readColumn(row, ['email', 'mail']);
    const phone = readColumn(row, ['phone', 'telephone', 'tel']);

    if (!name && !role && !email && !phone) return;

    nextContacts.push({
      name: name || `Contact ${index + 1}`,
      role: role || '',
      email: email || '',
      phone: phone || '',
      order: readColumn(row, ['order', 'sort', 'position', 'ordre']) || String(index),
    });
  });

  nextContacts.sort((a, b) => String(a.order).localeCompare(String(b.order), undefined, { numeric: true }));
  nextContacts.forEach(contact => delete contact.order);

  if (!Object.keys(nextCats).length) {
    console.warn('[SheetSync] Aucun onglet categories exploitable. Catalogue local conserve.');
    return false;
  }

  replaceCatalogueStructure(nextCats, nextHomeCards);
  if (nextContacts.length) {
    replaceContacts(nextContacts);
  }
  return true;
}

function buildSheetCsvUrl(spreadsheetId, sheetName) {
  const cacheBuster = Date.now();
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}&cb=${cacheBuster}`;
}

function ensureCsvLikeResponse(response, csvText, sheetName) {
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  const preview = (csvText || '').slice(0, 300).toLowerCase();
  const looksLikeHtml = contentType.includes('text/html') || preview.startsWith('<!doctype html') || preview.startsWith('<html');

  if (looksLikeHtml) {
    throw new Error(
      `Le sheet \"${sheetName}\" n'est pas accessible en CSV public (auth requise). ` +
      'Publier le document sur le Web ou partager en lecture publique.',
    );
  }
}

function normalizePerCategorySheetConfig(configValue) {
  if (!configValue) return [];

  if (Array.isArray(configValue)) {
    return configValue
      .filter(entry => entry && typeof entry === 'object')
      .map(entry => ({
        category: entry.category || entry.key || '',
        sheet: entry.sheet || entry.name || '',
      }))
      .filter(entry => entry.category && entry.sheet);
  }

  if (typeof configValue === 'object') {
    return Object.entries(configValue)
      .map(([category, sheet]) => ({ category, sheet }))
      .filter(entry => entry.category && entry.sheet);
  }

  return [];
}

function injectCategoryIfMissing(rows, categoryKey) {
  rows.forEach(row => {
    const hasCategory = hasAnyColumn(row, ['category', 'categorie']);
    if (!hasCategory) row.category = categoryKey;
  });
}

function applyDatabaseRows(rows) {
  const nextData = buildEmptyDataMap();
  let insertedCount = 0;

  rows.forEach(row => {
    const enabledAliases = ['enabled', 'actif', 'active'];
    const enabled = boolFromCell(
      readColumn(row, enabledAliases),
      true,
    );
    if (!enabled) return;

    const categoryValue = readColumn(row, ['category', 'categorie', 'catégorie', 'cle_categorie']);
    const sectionValue = readColumn(row, ['section', 'sous_categorie', 'sous-categorie', 'sous_categorie_id', 'section_id']);
    const model = getModelValue(row);

    if (!categoryValue || !sectionValue || !model) return;

    const categoryKey = findCategoryKey(categoryValue);
    if (!categoryKey) {
      console.warn('[SheetSync] Categorie introuvable:', categoryValue);
      return;
    }

    const category = CATS[categoryKey];
    const sectionId = findSectionId(category, sectionValue);
    if (!sectionId) {
      console.warn('[SheetSync] Section introuvable:', sectionValue, 'dans', categoryKey);
      return;
    }

    const item = {
      model,
      brand: getBrandValue(row),
      usageName: getUsageNameValue(row),
      name: model,
      desc: readColumn(row, ['desc', 'description']),
      peda: readColumn(row, ['peda', 'pedagogie']),
      specs: parseSpecs(getSpecsValue(row)),
    };

    const img = readColumn(row, ['img', 'image']);
    const imgs = parseImages(readColumn(row, ['imgs', 'images']));
    const manuel = readColumn(row, ['manuel']);
    const tags = parseTags(readColumn(row, ['tags']));
    const lienLabel = readColumn(row, ['lienlabel', 'lien_label']);
    const lienUrl = readColumn(row, ['lienurl', 'lien_url']);
    const lienLabel2 = readColumn(row, ['lienlabel2', 'lien_label2']);
    const lienUrl2 = readColumn(row, ['lienurl2', 'lien_url2']);
    const lienLabel3 = readColumn(row, ['lienlabel3', 'lien_label3']);
    const lienUrl3 = readColumn(row, ['lienurl3', 'lien_url3']);

    if (img) item.img = img;
    if (imgs.length) item.imgs = imgs;
    if (manuel) item.manuel = manuel;
    if (tags.length) item.tags = tags;
    if (lienLabel) item.lienLabel = lienLabel;
    if (lienUrl) item.lienUrl = lienUrl;
    if (lienLabel2) item.lienLabel2 = lienLabel2;
    if (lienUrl2) item.lienUrl2 = lienUrl2;
    if (lienLabel3) item.lienLabel3 = lienLabel3;
    if (lienUrl3) item.lienUrl3 = lienUrl3;

    nextData[categoryKey][sectionId].push(item);
    insertedCount += 1;
  });

  if (insertedCount === 0) {
    console.warn('[SheetSync] Aucune ligne exploitable trouvee dans la feuille. Catalogue local conserve.');
    return;
  }

  Object.keys(CATS).forEach(catKey => {
    const sections = CATS[catKey]?.sections || [];
    sections.forEach(section => {
      CATS[catKey].data[section.id] = nextData[catKey][section.id] || [];
    });
  });
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
    });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

function buildCatalogueFromRows(rows) {
  const categoryRows = rows.filter(row => {
    const hasCategoryKey = hasAnyColumn(row, ['key', 'category', 'categorie', 'cle_categorie', 'cle']);
    const hasTitle = hasAnyColumn(row, ['title', 'titre_categorie', 'titre', 'name', 'nom']);
    const isItemLike = hasAnyColumn(row, ['section', 'sous_categorie', 'sous-categorie', 'section_id']) && hasAnyColumn(row, ['name', 'nom', 'nom_produit', 'modele']);
    return hasCategoryKey && hasTitle && !isItemLike;
  });

  const itemRows = rows.filter(row => {
    const hasCategory = hasAnyColumn(row, ['category', 'categorie', 'cle_categorie']);
    const hasSection = hasAnyColumn(row, ['section', 'sous_categorie', 'sous-categorie', 'section_id']);
    const hasModel = hasAnyColumn(row, ['name', 'nom', 'nom_produit', 'modele']);
    return hasCategory && hasSection && hasModel;
  });

  if (!categoryRows.length && !itemRows.length) {
    return false;
  }

  if (categoryRows.length) {
    const nextCats = {};
    const nextHomeCards = [];

    categoryRows.forEach((row, index) => {
      const key = readColumn(row, ['key', 'category', 'categorie', 'cle_categorie', 'cle']);
      const title = readColumn(row, ['title', 'titre_categorie', 'titre', 'name', 'nom']);
      if (!key || !title) return;

      nextCats[key] = {
        title,
        desc: readColumn(row, ['desc', 'description', 'description_categorie']),
        sections: [],
        data: {},
      };

      nextHomeCards.push({
        key,
        img: readColumn(row, ['home_img', 'img', 'image', 'image_carte_accueil']),
        name: readColumn(row, ['home_name', 'card_name', 'nom_carte_accueil']) || title,
        desc: readColumn(row, ['home_desc', 'card_desc', 'desc', 'description', 'description_carte_accueil']),
        tags: parseTags(readColumn(row, ['home_tags', 'tags', 'tags_accueil'])),
        order: readColumn(row, ['order', 'sort', 'position', 'ordre']) || String(index),
      });
    });

    if (Object.keys(nextCats).length) {
      nextHomeCards.sort((a, b) => String(a.order).localeCompare(String(b.order), undefined, { numeric: true }));
      nextHomeCards.forEach(card => delete card.order);
      replaceCatalogueStructure(nextCats, nextHomeCards);
    }
  }

  if (itemRows.length) {
    applyDatabaseRows(itemRows);
    return true;
  }

  return !!categoryRows.length;
}

async function syncFromPublicCsv(csvUrl, timeoutMs) {
  if (!csvUrl) return false;

  const response = await fetchWithTimeout(csvUrl, timeoutMs || 6000);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const csv = await response.text();
  const rows = parseRows(csv);
  if (!rows.length) {
    throw new Error('CSV public vide ou illisible');
  }

  const built = buildCatalogueFromRows(rows);
  if (!built) {
    throw new Error('CSV public sans structure exploitable (categories ou produits)');
  }

  return true;
}

export async function syncCatalogueFromSheet() {
  const config = SHEET_SYNC_CONFIG;
  if (!config.enabled) return;
  const allowCsvFallbackWithSpreadsheet = config.allowCsvFallbackWithSpreadsheet === true;

  try {
    if (config.spreadsheetId) {
      const sheetNames = config.sheetNames || {};
      const categoriesName = sheetNames.categories || 'categories';
      const sectionsName = sheetNames.sections || 'sections';
      const contactsName = sheetNames.contacts || 'contacts';
      const perCategorySheets = normalizePerCategorySheetConfig(sheetNames.itemsByCategory);

      let itemRows = [];
      let categoriesRows = [];
      let sectionsRows = [];
      let contactsRows = [];

      if (perCategorySheets.length > 0) {
        const fetchedRows = await Promise.all(perCategorySheets.map(async entry => {
          try {
            const response = await fetchWithTimeout(buildSheetCsvUrl(config.spreadsheetId, entry.sheet), config.timeoutMs || 6000);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const csv = await response.text();
            ensureCsvLikeResponse(response, csv, entry.sheet);
            const rows = parseRows(csv);
            injectCategoryIfMissing(rows, entry.category);
            return rows;
          } catch (error) {
            console.warn(`[SheetSync] Onglet ${entry.sheet} ignore:`, error?.message || error);
            return [];
          }
        }));

        itemRows = fetchedRows.flat();
      }

      const categoriesRes = await fetchWithTimeout(buildSheetCsvUrl(config.spreadsheetId, categoriesName), config.timeoutMs || 6000).catch(error => {
        console.warn('[SheetSync] Onglet categories ignore:', error?.message || error);
        return null;
      });
      const sectionsRes = await fetchWithTimeout(buildSheetCsvUrl(config.spreadsheetId, sectionsName), config.timeoutMs || 6000).catch(error => {
        console.warn('[SheetSync] Onglet sections ignore:', error?.message || error);
        return null;
      });
      const contactsRes = await fetchWithTimeout(buildSheetCsvUrl(config.spreadsheetId, contactsName), config.timeoutMs || 6000).catch(error => {
        console.warn('[SheetSync] Onglet contacts ignore:', error?.message || error);
        return null;
      });

      if (categoriesRes) {
        const categoriesCsv = await categoriesRes.text();
        ensureCsvLikeResponse(categoriesRes, categoriesCsv, categoriesName);
        categoriesRows = parseRows(categoriesCsv);
      }

      if (sectionsRes) {
        const sectionsCsv = await sectionsRes.text();
        ensureCsvLikeResponse(sectionsRes, sectionsCsv, sectionsName);
        sectionsRows = parseRows(sectionsCsv);
      }

      if (contactsRes) {
        const contactsCsv = await contactsRes.text();
        ensureCsvLikeResponse(contactsRes, contactsCsv, contactsName);
        contactsRows = parseRows(contactsCsv);
      }

      if (categoriesRows.length && sectionsRows.length) {
        buildDynamicCatalogue(categoriesRows, sectionsRows, itemRows, contactsRows);
        return;
      }

      if (config.csvUrl) {
        if (allowCsvFallbackWithSpreadsheet) {
          try {
            await syncFromPublicCsv(config.csvUrl, config.timeoutMs || 6000);
            return;
          } catch (fallbackError) {
            console.warn('[SheetSync] Fallback CSV public impossible :', fallbackError?.message || fallbackError);
          }
        }

        console.warn(
          '[SheetSync] Le Google Sheet n’est pas accessible en lecture publique ou la structure attendue est absente. ' +
          'Publie le document via Fichier > Publier sur le Web / ou active le CSV public dans src/data/sheetConfig.js.',
        );
      }

      console.warn('[SheetSync] Structure de categories/sections introuvable dans le sheet; aucune valeur locale ne remplace le contenu du sheet.');
      return;
    }

    if (!config.csvUrl) return;
    await syncFromPublicCsv(config.csvUrl, config.timeoutMs || 6000);
  } catch (error) {
    const csvFallback = (!config.spreadsheetId || allowCsvFallbackWithSpreadsheet) && config.csvUrl ? await (async () => {
      try {
        return await syncFromPublicCsv(config.csvUrl, config.timeoutMs || 6000);
      } catch (fallbackError) {
        console.warn('[SheetSync] Fallback CSV public impossible :', fallbackError?.message || fallbackError);
        return false;
      }
    })() : false;

    if (!csvFallback) {
      console.warn('[SheetSync] Synchronisation Google Sheets ignoree :', error?.message || error);
    }
  }
}
