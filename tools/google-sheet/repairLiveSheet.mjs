import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { google } from 'googleapis';
import { SHEET_SYNC_CONFIG } from '../../src/data/sheetConfig.js';

function readCredentialsFromEnv() {
  const jsonPath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (jsonPath) {
    const raw = fs.readFileSync(path.resolve(jsonPath), 'utf8');
    const parsed = JSON.parse(raw);
    return {
      client_email: parsed.client_email,
      private_key: parsed.private_key,
    };
  }

  if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    return {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    };
  }

  return null;
}

function buildGoogleClient() {
  const credentials = readCredentialsFromEnv();
  if (!credentials?.client_email || !credentials?.private_key) {
    throw new Error('Credentials Google manquants.');
  }

  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  return google.sheets({ version: 'v4', auth });
}

function normalizeHeader(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function getHeaders(values) {
  return (values[1] || []).map(normalizeHeader);
}

function toRows(values) {
  const headers = getHeaders(values);
  return (values.slice(2) || []).map((row, index) => {
    const padded = [...row];
    while (padded.length < headers.length) padded.push('');
    const record = {};
    headers.forEach((header, headerIndex) => {
      record[header] = padded[headerIndex] || '';
    });
    return {
      rowNumber: index + 3,
      raw: padded,
      record,
    };
  });
}

function splitImages(img, imgs) {
  return [img, ...String(imgs || '').split('|')]
    .map(value => String(value || '').trim())
    .filter(Boolean);
}

const SECTION_REMAP = {
  lumiere: {
    lumiere: 'pieds',
  },
  machinerie: {
    machinerie: 'autre',
  },
  accessoires: {
    'accessoire-cam': 'autre',
  },
};

function titleCase(value) {
  return String(value || '')
    .split(/[-_ ]+/)
    .filter(Boolean)
    .map(token => token.slice(0, 1).toUpperCase() + token.slice(1))
    .join(' ');
}

function swapFirstAndLast(images) {
  if (images.length < 2) return images;
  const next = [...images];
  const first = next[0];
  next[0] = next[next.length - 1];
  next[next.length - 1] = first;
  return next;
}

async function fetchSheetValues(sheets, spreadsheetId, range) {
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return response.data.values || [];
}

async function writeSheetValues(sheets, spreadsheetId, sheetTitle, values) {
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${sheetTitle}!A:Z`,
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetTitle}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  });
}

async function main() {
  const sheets = buildGoogleClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID || SHEET_SYNC_CONFIG.spreadsheetId;
  const itemsByCategory = SHEET_SYNC_CONFIG.sheetNames?.itemsByCategory || {};
  const sectionsSheet = SHEET_SYNC_CONFIG.sheetNames?.sections || 'sections';
  const lumiereSheet = itemsByCategory.lumiere || 'items.lumiere';

  if (!spreadsheetId) {
    throw new Error('Aucun spreadsheetId configure.');
  }

  const sectionValues = await fetchSheetValues(sheets, spreadsheetId, sectionsSheet);
  const sectionRows = toRows(sectionValues);
  const enableLumiereSwap = ['1', 'true', 'yes', 'oui']
    .includes(String(process.env.REPAIR_SWAP_LUMIERE || '').trim().toLowerCase());
  const sectionIdsByCategory = {};

  sectionRows.forEach(({ record }) => {
    const categoryKey = String(record.category || '').trim();
    const sectionId = String(record.id || '').trim();
    if (!categoryKey || !sectionId) return;
    if (!sectionIdsByCategory[categoryKey]) sectionIdsByCategory[categoryKey] = new Set();
    sectionIdsByCategory[categoryKey].add(sectionId);
  });

  const activeSectionsByCategory = {};
  for (const [categoryKey, sheetTitle] of Object.entries(itemsByCategory)) {
    const itemValues = await fetchSheetValues(sheets, spreadsheetId, sheetTitle);
    const itemHeaders = getHeaders(itemValues);
    const sectionIndex = itemHeaders.indexOf('section');
    const itemRows = toRows(itemValues);
    const nextItemValues = itemValues.map(row => [...row]);
    const activeSections = new Set();
    let updatedRows = 0;

    itemRows.forEach(({ record }) => {
      const name = String(record.name || '').trim();
      const sourceSectionId = String(record.section || '').trim();
      const remappedSectionId = SECTION_REMAP[categoryKey]?.[sourceSectionId] || sourceSectionId;
      const sectionId = remappedSectionId;

      if (sectionIndex >= 0 && remappedSectionId !== sourceSectionId) {
        const rowIndex = itemRows.findIndex(row => row.record === record);
        if (rowIndex >= 0) {
          const nextRaw = [...itemRows[rowIndex].raw];
          nextRaw[sectionIndex] = remappedSectionId;
          nextItemValues[itemRows[rowIndex].rowNumber - 1] = nextRaw;
          updatedRows += 1;
        }
      }

      if (name && sectionId) activeSections.add(sectionId);
    });

    if (updatedRows > 0) {
      await writeSheetValues(sheets, spreadsheetId, sheetTitle, nextItemValues);
    }

    activeSectionsByCategory[categoryKey] = activeSections;
  }

  const sectionHeaders = getHeaders(sectionValues);
  const categoryIndex = sectionHeaders.indexOf('category');
  const idIndex = sectionHeaders.indexOf('id');
  const numIndex = sectionHeaders.indexOf('num');
  const orderIndex = sectionHeaders.indexOf('order');

  const nextSectionValues = sectionValues.slice(0, 2).map(row => [...row]);
  const orderByCategory = {};

  Object.entries(SECTION_REMAP).forEach(([categoryKey, remap]) => {
    Object.values(remap).forEach(targetSectionId => {
      if (!activeSectionsByCategory[categoryKey]?.has(targetSectionId)) return;
      if (sectionIdsByCategory[categoryKey]?.has(targetSectionId)) return;

      const nextOrder = (orderByCategory[categoryKey] || sectionRows
        .filter(({ record }) => String(record.category || '').trim() === categoryKey)
        .length) + 1;
      orderByCategory[categoryKey] = nextOrder;
      nextSectionValues.push(sectionHeaders.map(header => {
        if (header === 'enabled') return 'TRUE';
        if (header === 'category') return categoryKey;
        if (header === 'id') return targetSectionId;
        if (header === 'num' || header === 'order') return String(nextOrder);
        if (header === 'label' || header === 'title') return titleCase(targetSectionId);
        return '';
      }));

      if (!sectionIdsByCategory[categoryKey]) sectionIdsByCategory[categoryKey] = new Set();
      sectionIdsByCategory[categoryKey].add(targetSectionId);
    });
  });

  sectionRows.forEach(({ raw, record }) => {
    const categoryKey = String(record.category || '').trim();
    const sectionId = String(record.id || '').trim();
    if (!categoryKey || !sectionId) return;
    if (!activeSectionsByCategory[categoryKey]?.has(sectionId)) return;

    const nextRaw = [...raw];
    const nextOrder = (orderByCategory[categoryKey] || 0) + 1;
    orderByCategory[categoryKey] = nextOrder;

    if (numIndex >= 0) nextRaw[numIndex] = String(nextOrder);
    if (orderIndex >= 0) nextRaw[orderIndex] = String(nextOrder);
    if (categoryIndex >= 0) nextRaw[categoryIndex] = categoryKey;
    if (idIndex >= 0) nextRaw[idIndex] = sectionId;

    nextSectionValues.push(nextRaw);
  });

  await writeSheetValues(sheets, spreadsheetId, sectionsSheet, nextSectionValues);

  let swappedRows = 0;

  if (enableLumiereSwap) {
    const lumiereValues = await fetchSheetValues(sheets, spreadsheetId, lumiereSheet);
    const lumiereHeaders = getHeaders(lumiereValues);
    const imgIndex = lumiereHeaders.indexOf('img');
    const imgsIndex = lumiereHeaders.indexOf('imgs');
    const lumiereRows = toRows(lumiereValues);
    const nextLumiereValues = lumiereValues.map(row => [...row]);

    if (imgIndex >= 0 && imgsIndex >= 0) {
      lumiereRows.forEach(({ rowNumber, raw, record }) => {
        const images = splitImages(record.img, record.imgs);
        const swapped = swapFirstAndLast(images);
        if (swapped.length < 2) return;

        const nextImg = swapped[0] || '';
        const nextImgs = swapped.slice(1).join('|');
        if (nextImg === String(record.img || '') && nextImgs === String(record.imgs || '')) return;

        const nextRaw = [...raw];
        while (nextRaw.length <= imgsIndex) nextRaw.push('');
        nextRaw[imgIndex] = nextImg;
        nextRaw[imgsIndex] = nextImgs;
        nextLumiereValues[rowNumber - 1] = nextRaw;
        swappedRows += 1;
      });
    }

    await writeSheetValues(sheets, spreadsheetId, lumiereSheet, nextLumiereValues);
  }

  console.log(JSON.stringify({
    spreadsheetId,
    removedSections: sectionRows.length - (nextSectionValues.length - 2),
    keptSections: nextSectionValues.length - 2,
    swappedRows,
  }, null, 2));
}

main().catch(error => {
  console.error('Erreur:', error?.message || error);
  process.exitCode = 1;
});
