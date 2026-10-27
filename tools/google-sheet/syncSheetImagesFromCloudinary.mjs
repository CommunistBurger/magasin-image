import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { google } from 'googleapis';
import { SHEET_SYNC_CONFIG } from '../../src/data/sheetConfig.js';

const DEFAULT_BASE_FOLDER = 'Photos';
const CATEGORY_ALIASES = {
  accessoires: ['accessoires', 'accessoire cam', 'accessoires cam', 'accessoire camera'],
  camera: ['camera', 'cameras', 'camera numerique', 'cameras numeriques', 'camera argentique', 'cameras argentiques'],
  lumiere: ['lumiere', 'lumieres', 'lighting'],
  machinerie: ['machinerie'],
  objectifs: ['objectifs', 'objectif', 'optiques', 'optique'],
  grip: ['grip'],
};

function printHelp() {
  console.log(`
Synchronise les colonnes img / imgs du Google Sheet depuis Cloudinary.

Usage:
  npm run sheet:cloudinary-sync -- --dry-run
  npm run sheet:cloudinary-sync -- --write

Options:
  --dry-run                 Simule la synchro sans ecrire dans le Sheet
  --write                   Applique les modifications dans le Sheet
  --base-folder=Photos      Prefixe Cloudinary a scanner
  --spreadsheet-id=<id>     Force un spreadsheetId
  --category=<key|nom>      Limite la synchro a une categorie
  --section=<id|nom>        Limite la synchro a une section (dans le scope choisi)
  --skip-existing           Ne remplace pas img/imgs si une ligne contient deja une image
  --no-check-images         Desactive la sonde HTTP des URLs d'images

Variables attendues:
  CLOUDINARY_CLOUD_NAME
  CLOUDINARY_API_KEY
  CLOUDINARY_API_SECRET
  GOOGLE_SERVICE_ACCOUNT_JSON

Alternative credentials Google:
  GOOGLE_SERVICE_ACCOUNT_EMAIL
  GOOGLE_PRIVATE_KEY
  GOOGLE_PROJECT_ID
`);
}

function parseArgs(argv) {
  const options = {
    dryRun: true,
    write: false,
    baseFolder: DEFAULT_BASE_FOLDER,
    spreadsheetId: '',
    checkImages: true,
    skipExisting: false,
    category: '',
    section: '',
  };

  argv.forEach(arg => {
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      return;
    }

    if (arg === '--write') {
      options.write = true;
      options.dryRun = false;
      return;
    }

    if (arg === '--dry-run') {
      options.dryRun = true;
      options.write = false;
      return;
    }

    if (arg.startsWith('--base-folder=')) {
      options.baseFolder = arg.slice('--base-folder='.length).trim() || DEFAULT_BASE_FOLDER;
      return;
    }

    if (arg.startsWith('--spreadsheet-id=')) {
      options.spreadsheetId = arg.slice('--spreadsheet-id='.length).trim();
      return;
    }

    if (arg.startsWith('--category=')) {
      options.category = arg.slice('--category='.length).trim();
      return;
    }

    if (arg.startsWith('--section=')) {
      options.section = arg.slice('--section='.length).trim();
      return;
    }

    if (arg === '--skip-existing') {
      options.skipExisting = true;
      return;
    }

    if (arg === '--no-check-images') {
      options.checkImages = false;
    }
  });

  return options;
}

function normalizeText(value) {
  return (value || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeHeader(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function slugify(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function singularize(value) {
  if (!value) return '';
  if (value.endsWith('aux')) return `${value.slice(0, -3)}al`;
  if (value.endsWith('s') || value.endsWith('x')) return value.slice(0, -1);
  return value;
}

function toTokenSet(value) {
  return new Set(normalizeText(value).split(' ').filter(Boolean));
}

function compareNames(leftValue, rightValue) {
  const left = normalizeText(leftValue);
  const right = normalizeText(rightValue);
  if (!left || !right) return 0;
  if (left === right) return 100;
  if (singularize(left) === singularize(right)) return 95;
  if (left.includes(right) || right.includes(left)) return 80;

  const leftTokens = toTokenSet(left);
  const rightTokens = toTokenSet(right);
  const sharedCount = [...leftTokens].filter(token => rightTokens.has(token)).length;
  if (!sharedCount) return 0;

  const longestSize = Math.max(leftTokens.size, rightTokens.size, 1);
  return Math.round((sharedCount / longestSize) * 70);
}

function naturalSort(values) {
  return [...values].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

export function buildImageColumns(images, categoryKey = '') {
  const normalized = (Array.isArray(images) ? images : [])
    .map(image => (image || '').toString().trim())
    .filter(Boolean);

  if (categoryKey === 'lumiere' && normalized.length > 1) {
    return {
      img: normalized.at(-1) || '',
      imgs: normalized.slice(1, -1).concat(normalized[0]).join('|'),
    };
  }

  return {
    img: normalized.at(-1) || '',
    imgs: normalized.slice(0, -1).join('|'),
  };
}

function encodePublicIdPath(publicId) {
  return publicId
    .split('/')
    .filter(Boolean)
    .map(segment => encodeURIComponent(segment))
    .join('/');
}

function pickCloudinaryUrl(resource, cloudName) {
  const secureUrl = (resource.secure_url || '').trim();
  if (secureUrl && secureUrl.includes('/image/upload/')) {
    return secureUrl;
  }

  const publicId = (resource.public_id || '').trim();
  const format = (resource.format || '').trim();
  if (!publicId || !format) {
    return secureUrl;
  }

  return `https://res.cloudinary.com/${cloudName}/image/upload/${encodePublicIdPath(publicId)}.${encodeURIComponent(format)}`;
}

function readCredentialsFromEnv() {
  const jsonPath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (jsonPath) {
    const raw = fs.readFileSync(path.resolve(jsonPath), 'utf8');
    const parsed = JSON.parse(raw);
    return {
      project_id: parsed.project_id,
      client_email: parsed.client_email,
      private_key: parsed.private_key,
    };
  }

  if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    return {
      project_id: process.env.GOOGLE_PROJECT_ID || '',
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    };
  }

  return null;
}

function getRequiredEnv(name) {
  const value = (process.env[name] || '').trim();
  if (!value) {
    throw new Error(`Variable d'environnement manquante: ${name}`);
  }
  return value;
}

function buildGoogleClient() {
  const credentials = readCredentialsFromEnv();
  if (!credentials?.client_email || !credentials?.private_key) {
    throw new Error('Credentials Google manquants. Renseigne GOOGLE_SERVICE_ACCOUNT_JSON ou les variables inline.');
  }

  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  return google.sheets({ version: 'v4', auth });
}

function getSheetConfig() {
  const spreadsheetId = SHEET_SYNC_CONFIG.spreadsheetId || '';
  const itemsByCategory = SHEET_SYNC_CONFIG.sheetNames?.itemsByCategory || {};

  if (!spreadsheetId) {
    throw new Error('Aucun spreadsheetId dans src/data/sheetConfig.js.');
  }

  if (!Object.keys(itemsByCategory).length) {
    throw new Error('Aucun onglet itemsByCategory configure dans src/data/sheetConfig.js.');
  }

  return {
    spreadsheetId,
    itemsByCategory,
    sectionsSheet: SHEET_SYNC_CONFIG.sheetNames?.sections || 'sections',
    categoriesSheet: SHEET_SYNC_CONFIG.sheetNames?.categories || 'categories',
  };
}

function toRows(values) {
  const matrix = Array.isArray(values) ? values : [];
  const headerRow = matrix[1] || [];
  const headers = headerRow.map(header => normalizeHeader(header));

  return (matrix.slice(2) || []).map((row, rowIndex) => {
    const padded = [...row];
    while (padded.length < headers.length) padded.push('');

    const record = {};
    headers.forEach((header, index) => {
      record[header] = padded[index] || '';
    });

    return {
      rowNumber: rowIndex + 3,
      raw: padded,
      record,
    };
  });
}

function buildCategoryMap(values) {
  const rows = toRows(values);
  const map = {};

  rows.forEach(({ record }) => {
    const key = record.key || record.category || '';
    if (!key) return;

    map[key] = {
      key,
      title: record.title || record.name || key,
    };
  });

  return map;
}

function resolveCategoryKey(input, categoryMap, itemsByCategory) {
  const value = (input || '').trim();
  if (!value) return '';

  if (itemsByCategory[value] && categoryMap[value]) return value;

  const aliasKey = findAliasedCategoryKey(value);
  if (aliasKey && itemsByCategory[aliasKey] && categoryMap[aliasKey]) return aliasKey;

  const normalized = normalizeText(value);
  const keyMatch = Object.keys(itemsByCategory).find(key => normalizeText(key) === normalized);
  if (keyMatch) return keyMatch;

  const titleMatch = Object.values(categoryMap).find(category => normalizeText(category.title) === normalized);
  if (titleMatch && itemsByCategory[titleMatch.key]) return titleMatch.key;

  return '';
}

function buildSectionMap(values) {
  const rows = toRows(values);
  const map = {};

  rows.forEach(({ record }) => {
    const categoryKey = record.category || '';
    const sectionId = record.id || record.section || '';
    if (!categoryKey || !sectionId) return;

    if (!map[categoryKey]) map[categoryKey] = {};
    map[categoryKey][sectionId] = {
      id: sectionId,
      label: record.label || record.name || sectionId,
      title: record.title || record.label || sectionId,
    };
  });

  return map;
}

function getHeaders(values) {
  return (Array.isArray(values) ? values[1] : []).map(header => normalizeHeader(header));
}

function buildRowsByCompositeKey(rows) {
  const map = new Map();

  rows.forEach(row => {
    const key = [
      row.record.category || '',
      row.record.section || '',
      normalizeText(row.record.name || ''),
    ].join('::');

    if (!key.endsWith('::')) map.set(key, row);
  });

  return map;
}

function buildSectionsByFolderName(sectionMap) {
  const result = {};

  Object.entries(sectionMap).forEach(([categoryKey, sections]) => {
    result[categoryKey] = new Map();
    Object.values(sections).forEach(section => {
      const aliases = [section.id, section.label, section.title];
      aliases.forEach(alias => {
        const normalized = normalizeText(alias);
        if (!normalized) return;
        result[categoryKey].set(normalized, section.id);
      });
    });
  });

  return result;
}

async function fetchSheetValues(sheets, spreadsheetId, range) {
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return response.data.values || [];
}

async function listCloudinaryResources({ cloudName, apiKey, apiSecret, prefix }) {
  const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
  const resources = [];
  let nextCursor = '';

  do {
    const url = new URL(`https://api.cloudinary.com/v1_1/${cloudName}/resources/image/upload`);
    const cleanedPrefix = (prefix || '').replace(/^\/+|\/+$/g, '');
    if (cleanedPrefix) {
      url.searchParams.set('prefix', cleanedPrefix);
    }
    url.searchParams.set('max_results', '500');
    url.searchParams.set('direction', 'asc');
    if (nextCursor) url.searchParams.set('next_cursor', nextCursor);

    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${auth}`,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Cloudinary API ${response.status}: ${body}`);
    }

    const payload = await response.json();
    resources.push(...(payload.resources || []));
    nextCursor = payload.next_cursor || '';
  } while (nextCursor);

  return resources;
}

function findAliasedCategoryKey(folderName) {
  const normalizedFolder = normalizeText(folderName);
  if (!normalizedFolder) return '';

  for (const [categoryKey, aliases] of Object.entries(CATEGORY_ALIASES)) {
    if (aliases.some(alias => normalizeText(alias) === normalizedFolder)) {
      return categoryKey;
    }
  }

  return '';
}

function findCategorySegmentIndex(segments) {
  for (let index = 0; index < segments.length; index += 1) {
    if (findAliasedCategoryKey(segments[index])) return index;
  }

  return -1;
}

function extractResourceFolderInfo(resource, baseFolder) {
  const cleanedBase = baseFolder.replace(/^\/+|\/+$/g, '');
  const assetFolder = (resource.asset_folder || resource.folder || '').trim();

  if (assetFolder) {
    const folderSegments = assetFolder.split('/').filter(Boolean);
    const baseIndex = folderSegments.findIndex(segment => segment === cleanedBase);
    const categoryIndex = findCategorySegmentIndex(folderSegments);
    const startIndex = baseIndex >= 0 ? baseIndex + 1 : categoryIndex;
    if (startIndex >= 0) {
      return {
        relativeFolders: folderSegments.slice(startIndex),
        folderPath: assetFolder,
      };
    }
  }

  const publicId = resource.public_id || '';
  if (!publicId) {
    return null;
  }

  const segments = publicId.split('/').filter(Boolean);
  const baseIndex = segments.findIndex(segment => segment === cleanedBase);
  const categoryIndex = findCategorySegmentIndex(segments);
  const startIndex = baseIndex >= 0 ? baseIndex + 1 : categoryIndex;
  if (startIndex < 0) {
    return null;
  }

  return {
    relativeFolders: segments.slice(startIndex, -1),
    folderPath: segments.slice(0, -1).join('/'),
  };
}

export function buildFolderGroups(resources, baseFolder) {
  const cloudName = getRequiredEnv('CLOUDINARY_CLOUD_NAME');
  const groups = new Map();

  resources.forEach(resource => {
    const folderInfo = extractResourceFolderInfo(resource, baseFolder);
    if (!folderInfo) return;

    const publicId = resource.public_id || '';
    const relativeFolders = folderInfo.relativeFolders;
    if (relativeFolders.length < 2) return;

    const productFolder = relativeFolders[relativeFolders.length - 1] || '';
    const categoryFolder = relativeFolders[0] || '';
    const sectionFolder = relativeFolders.length > 2
      ? relativeFolders.slice(1, -1).join(' / ')
      : '';
    const folderPath = folderInfo.folderPath;
    const fileName = resource.display_name || resource.original_filename || publicId.split('/').at(-1) || '';

    const deliveryUrl = pickCloudinaryUrl(resource, cloudName);
    if (!productFolder || !deliveryUrl) return;

    if (!groups.has(folderPath)) {
      groups.set(folderPath, {
        folderPath,
        productFolder,
        sectionFolder,
        categoryFolder,
        images: [],
      });
    }

    groups.get(folderPath).images.push({
      publicId,
      fileName,
      secureUrl: deliveryUrl,
    });
  });

  for (const group of groups.values()) {
    group.images = group.images
      .sort((a, b) => a.publicId.localeCompare(b.publicId, undefined, { numeric: true, sensitivity: 'base' }))
      .map(image => image.secureUrl);
  }

  return [...groups.values()];
}

function findBestCategoryKey(folderName, categoryMap) {
  const aliasedKey = findAliasedCategoryKey(folderName);
  if (aliasedKey && categoryMap[aliasedKey]) return aliasedKey;

  const ranked = Object.values(categoryMap)
    .map(category => ({
      key: category.key,
      score: Math.max(
        compareNames(folderName, category.key),
        compareNames(folderName, category.title),
      ),
    }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  const second = ranked[1];
  if (!best || best.score < 60) return '';
  if (second && second.score === best.score) return '';
  return best.key;
}

function findBestSectionId(folderName, categoryKey, sectionMap) {
  const sections = Object.values(sectionMap[categoryKey] || {});
  const ranked = sections
    .map(section => ({
      id: section.id,
      score: Math.max(
        compareNames(folderName, section.id),
        compareNames(folderName, section.label),
        compareNames(folderName, section.title),
      ),
    }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  const second = ranked[1];
  if (!best || best.score < 60) return '';
  if (second && second.score === best.score) return '';
  return best.id;
}

function matchesSectionScope(group, sectionFilter, sectionMap) {
  if (!sectionFilter) return true;

  const normalizedFilter = normalizeText(sectionFilter);
  const aliases = [group.sectionId, group.sectionFolder];

  if (group.categoryKey && group.sectionId && sectionMap[group.categoryKey]?.[group.sectionId]) {
    const section = sectionMap[group.categoryKey][group.sectionId];
    aliases.push(section.label, section.title);
  }

  return aliases
    .filter(Boolean)
    .some(value => normalizeText(value) === normalizedFilter);
}

export function annotateCloudinaryGroups(groups, categoryMap, sectionMap) {
  return groups.map(group => {
    const categoryKey = findBestCategoryKey(group.categoryFolder, categoryMap);
    const inferredSectionFolder = group.sectionFolder || group.categoryFolder;
    const sectionId = categoryKey ? findBestSectionId(inferredSectionFolder, categoryKey, sectionMap) : '';
    return {
      ...group,
      sectionFolder: inferredSectionFolder,
      categoryKey,
      sectionId,
    };
  });
}

function ensureUniqueSectionId(baseId, categoryKey, sectionMap) {
  const existing = new Set(Object.keys(sectionMap[categoryKey] || {}));
  let nextId = baseId || 'section';
  let suffix = 2;

  while (existing.has(nextId)) {
    nextId = `${baseId}-${suffix}`;
    suffix += 1;
  }

  return nextId;
}

function planMissingSections(annotatedGroups, sectionRows, sectionMap) {
  const sectionsByFolder = buildSectionsByFolderName(sectionMap);
  const newSections = [];
  const nextOrderByCategory = {};

  sectionRows.forEach(({ record }) => {
    const categoryKey = record.category || '';
    if (!categoryKey) return;
    const orderValue = Number(record.order || record.num || 0);
    nextOrderByCategory[categoryKey] = Math.max(nextOrderByCategory[categoryKey] || 0, Number.isFinite(orderValue) ? orderValue : 0);
  });

  annotatedGroups.forEach(group => {
    if (!group.categoryKey || group.sectionId) return;

    if (!sectionsByFolder[group.categoryKey]) {
      sectionsByFolder[group.categoryKey] = new Map();
    }

    const normalizedFolder = normalizeText(group.sectionFolder);
    const existingSectionId = sectionsByFolder[group.categoryKey].get(normalizedFolder);
    if (existingSectionId) {
      group.sectionId = existingSectionId;
      return;
    }

    const baseId = slugify(group.sectionFolder);
    const sectionId = ensureUniqueSectionId(baseId, group.categoryKey, sectionMap);
    const order = (nextOrderByCategory[group.categoryKey] || 0) + 1;
    nextOrderByCategory[group.categoryKey] = order;

    const section = {
      id: sectionId,
      label: group.sectionFolder,
      title: group.sectionFolder,
    };

    if (!sectionMap[group.categoryKey]) sectionMap[group.categoryKey] = {};
    sectionMap[group.categoryKey][sectionId] = section;
    sectionsByFolder[group.categoryKey].set(normalizedFolder, sectionId);
    group.sectionId = sectionId;

    newSections.push({
      category: group.categoryKey,
      id: sectionId,
      num: String(order).padStart(2, '0'),
      label: group.sectionFolder,
      title: group.sectionFolder,
      sub: '',
      order: String(order).padStart(2, '0'),
    });
  });

  return newSections;
}

function updateRowsWithCloudinary(rows, categoryKey, categoryGroups) {
  const missing = [];
  const usedGroups = new Set();
  let touched = 0;

  const groupIndex = new Map();
  categoryGroups.forEach(group => {
    const key = [categoryKey, group.sectionId || '', normalizeText(group.productFolder || '')].join('::');
    groupIndex.set(key, group);
  });

  rows.forEach(row => {
    const itemName = row.record.name || '';
    if (!itemName.trim()) return;

    const key = [
      categoryKey,
      row.record.section || '',
      normalizeText(itemName),
    ].join('::');
    const match = groupIndex.get(key);

    if (!match) {
      missing.push(`${categoryKey} / ${row.record.section || '?'} / ${itemName}`);
      return;
    }

    const nextImageColumns = buildImageColumns(match.images, categoryKey);
    const prevImg = row.record.img || '';
    const prevImgs = row.record.imgs || '';

    usedGroups.add(key);

    if (prevImg === nextImageColumns.img && prevImgs === nextImageColumns.imgs) return;

    row.record.img = nextImageColumns.img;
    row.record.imgs = nextImageColumns.imgs;
    touched += 1;
  });

  return { touched, missing, usedGroups };
}

function hasImageData(record) {
  const img = (record?.img || '').toString().trim();
  const imgs = (record?.imgs || '').toString().trim();
  return Boolean(img || imgs);
}

function updateRowsWithCloudinaryWithOptions(rows, categoryKey, categoryGroups, options) {
  const base = updateRowsWithCloudinary(rows, categoryKey, categoryGroups);
  if (!options?.skipExisting) {
    return { ...base, skippedExisting: 0 };
  }

  const groupIndex = new Map();
  categoryGroups.forEach(group => {
    const key = [categoryKey, group.sectionId || '', normalizeText(group.productFolder || '')].join('::');
    groupIndex.set(key, group);
  });

  const missing = [];
  const usedGroups = new Set();
  let touched = 0;
  let skippedExisting = 0;

  rows.forEach(row => {
    const itemName = row.record.name || '';
    if (!itemName.trim()) return;

    const key = [
      categoryKey,
      row.record.section || '',
      normalizeText(itemName),
    ].join('::');
    const match = groupIndex.get(key);

    if (!match) {
      if (!hasImageData(row.record)) {
        missing.push(`${categoryKey} / ${row.record.section || '?'} / ${itemName}`);
      } else {
        skippedExisting += 1;
      }
      return;
    }

    usedGroups.add(key);

    if (hasImageData(row.record)) {
      skippedExisting += 1;
      return;
    }

    const nextImageColumns = buildImageColumns(match.images, categoryKey);
    const prevImg = row.record.img || '';
    const prevImgs = row.record.imgs || '';

    if (prevImg === nextImageColumns.img && prevImgs === nextImageColumns.imgs) return;

    row.record.img = nextImageColumns.img;
    row.record.imgs = nextImageColumns.imgs;
    touched += 1;
  });

  return {
    touched,
    missing,
    usedGroups,
    skippedExisting,
  };
}

function rowsToValues(originalValues, rows) {
  const matrix = Array.isArray(originalValues) ? originalValues.map(row => [...row]) : [];
  const headers = (matrix[1] || []).map(header => normalizeHeader(header));
  const imgIndex = headers.indexOf('img');
  const imgsIndex = headers.indexOf('imgs');

  if (imgIndex < 0 || imgsIndex < 0) {
    throw new Error('Colonnes img ou imgs introuvables dans le Sheet.');
  }

  rows.forEach(row => {
    while (row.raw.length <= imgsIndex) row.raw.push('');
    row.raw[imgIndex] = row.record.img || '';
    row.raw[imgsIndex] = row.record.imgs || '';
    matrix[row.rowNumber - 1] = row.raw;
  });

  return matrix;
}

function appendRows(values, rowsToAppend) {
  const matrix = Array.isArray(values) ? values.map(row => [...row]) : [];
  rowsToAppend.forEach(row => {
    matrix.push(row);
  });
  return matrix;
}

function pruneEmptySections(sectionValues, activeSectionIdsByCategory) {
  const matrix = Array.isArray(sectionValues) ? sectionValues.map(row => [...row]) : [];
  if (matrix.length < 3) return matrix;

  const headers = (matrix[1] || []).map(header => normalizeHeader(header));
  const categoryIndex = headers.indexOf('category');
  const idIndex = headers.indexOf('id');

  if (categoryIndex < 0 || idIndex < 0) return matrix;

  const keptRows = matrix.slice(0, 2);

  matrix.slice(2).forEach(row => {
    const categoryKey = (row[categoryIndex] || '').toString().trim();
    const sectionId = (row[idIndex] || '').toString().trim();
    if (!categoryKey || !sectionId) return;

    const activeSections = activeSectionIdsByCategory[categoryKey];
    if (!activeSections?.has(sectionId)) return;

    keptRows.push(row);
  });

  return keptRows;
}

function pruneSectionMap(sectionMap, activeSectionIdsByCategory) {
  Object.entries(sectionMap).forEach(([categoryKey, sections]) => {
    Object.keys(sections || {}).forEach(sectionId => {
      if (activeSectionIdsByCategory[categoryKey]?.has(sectionId)) return;
      delete sections[sectionId];
    });
  });
}

function buildSectionAppendRows(sectionValues, pendingSections) {
  const headers = getHeaders(sectionValues);
  if (!headers.length) {
    throw new Error('Impossible de lire les en-tetes de l\'onglet sections.');
  }

  return pendingSections.map(section => headers.map(header => {
    if (header === 'enabled') return 'TRUE';
    return section[header] || '';
  }));
}

function createItemRow(itemValues, item) {
  const headers = getHeaders(itemValues);
  if (!headers.length) {
    throw new Error('Impossible de lire les en-tetes de l\'onglet items.');
  }

  return headers.map(header => {
    if (header === 'enabled') return 'TRUE';
    return item[header] || '';
  });
}

function buildMissingProductRows(itemValues, categoryKey, categoryGroups, usedGroups) {
  const appendRowsList = [];
  const created = [];

  categoryGroups.forEach(group => {
    const key = [categoryKey, group.sectionId || '', normalizeText(group.productFolder || '')].join('::');
    if (usedGroups.has(key)) return;
    if (!group.sectionId || !group.productFolder) return;

    const imageColumns = buildImageColumns(group.images, categoryKey);
    const rowData = {
      category: categoryKey,
      section: group.sectionId,
      name: group.productFolder,
      img: imageColumns.img,
      imgs: imageColumns.imgs,
    };

    appendRowsList.push(createItemRow(itemValues, rowData));
    created.push({
      categoryKey,
      sectionId: group.sectionId,
      name: group.productFolder,
      imageCount: group.images.length,
    });
  });

  return { appendRowsList, created };
}

async function writeSheetValues(sheets, spreadsheetId, sheetTitle, values) {
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetTitle}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  });
}

function getSheetByTitle(meta, title) {
  return (meta.data.sheets || []).find(sheet => sheet?.properties?.title === title) || null;
}

async function refreshSectionValidationsForItemSheets(sheets, spreadsheetId, itemsByCategory, sectionMap) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const requests = [];

  Object.entries(itemsByCategory).forEach(([categoryKey, sheetTitle]) => {
    const sheet = getSheetByTitle(meta, sheetTitle);
    if (!sheet?.properties?.sheetId) return;

    const rowCount = Math.max(sheet.properties?.gridProperties?.rowCount || 1000, 1000);
    const sectionOptions = Object.keys(sectionMap[categoryKey] || {})
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

    const rule = sectionOptions.length
      ? {
          condition: {
            type: 'ONE_OF_LIST',
            values: sectionOptions.map(value => ({ userEnteredValue: value })),
          },
          strict: true,
          showCustomUi: true,
        }
      : null;

    requests.push({
      repeatCell: {
        range: {
          sheetId: sheet.properties.sheetId,
          startRowIndex: 2,
          endRowIndex: rowCount,
          startColumnIndex: 2,
          endColumnIndex: 3,
        },
        cell: {
          dataValidation: rule,
        },
        fields: 'dataValidation',
      },
    });
  });

  if (!requests.length) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });
}

async function probeImageUrls(groups, sampleSize = 12) {
  const uniqueUrls = [];
  const seen = new Set();

  groups.forEach(group => {
    group.images.forEach(url => {
      if (!url || seen.has(url)) return;
      seen.add(url);
      uniqueUrls.push(url);
    });
  });

  const sample = uniqueUrls.slice(0, sampleSize);
  if (!sample.length) {
    return {
      checked: 0,
      ok: 0,
      failed: 0,
      failures: [],
    };
  }

  const checks = await Promise.all(sample.map(async url => {
    try {
      const response = await fetch(url, { method: 'HEAD' });
      return {
        url,
        ok: response.ok,
        status: response.status,
      };
    } catch (error) {
      return {
        url,
        ok: false,
        status: 0,
        error: error?.message || 'Erreur reseau',
      };
    }
  }));

  const failures = checks.filter(check => !check.ok);
  return {
    checked: checks.length,
    ok: checks.length - failures.length,
    failed: failures.length,
    failures,
  };
}

function printSummary(summary, options) {
  console.log('');
  console.log(options.write ? 'Mode: write' : 'Mode: dry-run');
  if (summary.scopeLabel) {
    console.log(`Scope: ${summary.scopeLabel}`);
  }
  console.log(`Ressources Cloudinary lues: ${summary.resourceCount}`);
  if (summary.resourceCountAfterFallback !== summary.resourceCount) {
    console.log(`Ressources Cloudinary apres repli global: ${summary.resourceCountAfterFallback}`);
  }
  console.log(`Dossiers produits detectes: ${summary.detectedGroups}`);
  console.log(`Lignes mises a jour: ${summary.updated}`);
  console.log(`Sections creees: ${summary.createdSections.length}`);
  console.log(`Produits crees: ${summary.createdProducts.length}`);
  console.log(`Produits sans dossier Cloudinary: ${summary.missing.length}`);
  if (summary.skippedExisting > 0) {
    console.log(`Lignes existantes preservees (--skip-existing): ${summary.skippedExisting}`);
  }

  if (summary.imageProbe) {
    console.log(`Sonde images: ${summary.imageProbe.ok}/${summary.imageProbe.checked} URL(s) accessibles`);
    if (summary.imageProbe.failed > 0) {
      console.log(`Sonde images en echec: ${summary.imageProbe.failed}`);
    }
  }

  if (summary.unmappedCategories.length) {
    console.log(`Dossiers categories non mappes: ${summary.unmappedCategories.length}`);
  }

  if (summary.bySheet.length) {
    console.log('');
    summary.bySheet.forEach(entry => {
      console.log(`${entry.sheet}: ${entry.touched} ligne(s) modifiee(s), ${entry.created} creee(s)`);
    });
  }

  if (summary.createdSections.length) {
    console.log('');
    console.log('Sections creees:');
    summary.createdSections.forEach(line => console.log(`- ${line}`));
  }

  if (summary.unmappedCategories.length) {
    console.log('');
    console.log('Categories Cloudinary non mappees:');
    summary.unmappedCategories.forEach(line => console.log(`- ${line}`));
  }

  if (summary.createdProducts.length) {
    console.log('');
    console.log('Produits crees:');
    summary.createdProducts.forEach(line => console.log(`- ${line}`));
  }

  if (summary.imageProbe?.failures?.length) {
    console.log('');
    console.log('Exemples URL images en echec:');
    summary.imageProbe.failures.slice(0, 5).forEach(entry => {
      const suffix = entry.error ? ` (${entry.error})` : ` (HTTP ${entry.status})`;
      console.log(`- ${entry.url}${suffix}`);
    });
  }

  if (summary.missing.length) {
    console.log('');
    console.log('Absents:');
    summary.missing.forEach(line => console.log(`- ${line}`));
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const cloudName = getRequiredEnv('CLOUDINARY_CLOUD_NAME');
  const apiKey = getRequiredEnv('CLOUDINARY_API_KEY');
  const apiSecret = getRequiredEnv('CLOUDINARY_API_SECRET');

  const sheets = buildGoogleClient();
  const config = getSheetConfig();
  const spreadsheetId = options.spreadsheetId || process.env.GOOGLE_SHEET_ID || config.spreadsheetId;
  const baseFolder = options.baseFolder || DEFAULT_BASE_FOLDER;

  const [categoryValues, sectionValues] = await Promise.all([
    fetchSheetValues(sheets, spreadsheetId, config.categoriesSheet),
    fetchSheetValues(sheets, spreadsheetId, config.sectionsSheet),
  ]);

  const categoryMap = buildCategoryMap(categoryValues);
  const sectionMap = buildSectionMap(sectionValues);
  const sectionRows = toRows(sectionValues);
  const scopedCategoryKey = resolveCategoryKey(options.category, categoryMap, config.itemsByCategory);
  if (options.category && !scopedCategoryKey) {
    throw new Error(`Categorie introuvable pour le scope: ${options.category}`);
  }

  const resources = await listCloudinaryResources({
    cloudName,
    apiKey,
    apiSecret,
    prefix: baseFolder,
  });
  const effectiveResources = resources.length
    ? resources
    : await listCloudinaryResources({
        cloudName,
        apiKey,
        apiSecret,
        prefix: '',
      });

  const folderGroups = buildFolderGroups(effectiveResources, baseFolder);
  const annotatedGroups = annotateCloudinaryGroups(folderGroups, categoryMap, sectionMap)
    .filter(group => group.categoryKey)
    .filter(group => (scopedCategoryKey ? group.categoryKey === scopedCategoryKey : true));
  const scopedGroups = annotatedGroups.filter(group => matchesSectionScope(group, options.section, sectionMap));
  const newSections = planMissingSections(scopedGroups, sectionRows, sectionMap);
  const summary = {
    resourceCount: resources.length,
    resourceCountAfterFallback: effectiveResources.length,
    detectedGroups: scopedGroups.length,
    updated: 0,
    missing: [],
    skippedExisting: 0,
    createdSections: newSections.map(section => `${section.category} / ${section.id} / ${section.label}`),
    createdProducts: [],
    unmappedCategories: [...new Set(
      folderGroups
        .filter(group => !scopedGroups.find(annotated => annotated.folderPath === group.folderPath))
        .map(group => group.categoryFolder || '(vide)'),
    )],
    imageProbe: null,
    scopeLabel: [
      scopedCategoryKey ? `category=${scopedCategoryKey}` : '',
      options.section ? `section=${options.section}` : '',
    ].filter(Boolean).join(', '),
    bySheet: [],
  };
  const activeSectionIdsByCategory = {};

  if (options.checkImages) {
    summary.imageProbe = await probeImageUrls(scopedGroups, 12);
  }

  const categoryEntries = Object.entries(config.itemsByCategory)
    .filter(([categoryKey]) => (scopedCategoryKey ? categoryKey === scopedCategoryKey : true));

  for (const [categoryKey, sheetTitle] of categoryEntries) {
    const values = await fetchSheetValues(sheets, spreadsheetId, sheetTitle);
    const rows = toRows(values);
    const headers = getHeaders(values);
    const sectionIndex = headers.indexOf('section');
    const categoryGroups = scopedGroups.filter(group => group.categoryKey === categoryKey && group.sectionId);
    const existingRowIndex = buildRowsByCompositeKey(rows);
    const result = updateRowsWithCloudinaryWithOptions(rows, categoryKey, categoryGroups, options);
    const { appendRowsList, created } = buildMissingProductRows(values, categoryKey, categoryGroups, new Set([
      ...result.usedGroups,
      ...existingRowIndex.keys(),
    ]));
    const activeSections = new Set();

    rows.forEach(row => {
      const sectionId = (row.record.section || '').toString().trim();
      if (sectionId) activeSections.add(sectionId);
    });

    if (sectionIndex >= 0) {
      appendRowsList.forEach(row => {
        const sectionId = (row[sectionIndex] || '').toString().trim();
        if (sectionId) activeSections.add(sectionId);
      });
    }

    newSections
      .filter(section => section.category === categoryKey)
      .forEach(section => activeSections.add(section.id));

    activeSectionIdsByCategory[categoryKey] = activeSections;

    summary.updated += result.touched;
    summary.missing.push(...result.missing);
    summary.skippedExisting += result.skippedExisting || 0;
    summary.createdProducts.push(...created.map(item => `${item.categoryKey} / ${item.sectionId} / ${item.name} (${item.imageCount} image(s))`));
    summary.bySheet.push({ sheet: sheetTitle, touched: result.touched, created: created.length });

    if (options.write && (result.touched > 0 || appendRowsList.length > 0)) {
      const nextValues = appendRows(rowsToValues(values, rows), appendRowsList);
      await writeSheetValues(sheets, spreadsheetId, sheetTitle, nextValues);
    }
  }

  if (options.write) {
    if (newSections.length > 0) {
      const sectionAppendRows = buildSectionAppendRows(sectionValues, newSections);
      sectionValues.splice(0, sectionValues.length, ...appendRows(sectionValues, sectionAppendRows));
    }

    pruneSectionMap(sectionMap, activeSectionIdsByCategory);
    const prunedSectionValues = pruneEmptySections(sectionValues, activeSectionIdsByCategory);
    await writeSheetValues(sheets, spreadsheetId, config.sectionsSheet, prunedSectionValues);
    await refreshSectionValidationsForItemSheets(
      sheets,
      spreadsheetId,
      config.itemsByCategory,
      sectionMap,
    );
  }

  printSummary(summary, options);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch(error => {
    console.error('Erreur:', error?.message || error);
    process.exitCode = 1;
  });
}