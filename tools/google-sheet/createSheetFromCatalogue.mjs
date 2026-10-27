import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { google } from 'googleapis';
import { CATS, HOME_CARDS } from '../../src/data/catalogue.js';
import { CONTACTS } from '../../src/data/contacts.js';

const OUTPUT_CSV_PATH = new URL('./catalogue.sheet.csv', import.meta.url);

const HEADERS = [
  'enabled',
  'category',
  'section',
  'modele',
  'marque',
  'nom_usage',
  'desc',
  'peda',
  'img',
  'imgs',
  'manuel',
  'tags',
  'specs',
  'lienLabel',
  'lienUrl',
  'lienLabel2',
  'lienUrl2',
  'lienLabel3',
  'lienUrl3',
];

const CATEGORY_HEADERS = [
  'enabled',
  'key',
  'title',
  'desc',
  'home_name',
  'home_desc',
  'home_img',
  'home_tags',
  'order',
];

const CATEGORY_HEADER_LABELS = {
  enabled: 'Actif',
  key: 'Cle categorie',
  title: 'Titre categorie',
  desc: 'Description categorie',
  home_name: 'Nom carte accueil',
  home_desc: 'Description carte accueil',
  home_img: 'Image carte accueil',
  home_tags: 'Tags accueil',
  order: 'Ordre',
};

const SECTION_HEADERS = [
  'enabled',
  'category',
  'id',
  'num',
  'label',
  'title',
  'sub',
  'order',
];

const CONTACTS_SHEET_TITLE = 'contacts';
const CONTACT_HEADERS = [
  'enabled',
  'name',
  'role',
  'email',
  'phone',
  'order',
];

const CONTACT_HEADER_LABELS = {
  enabled: 'Actif',
  name: 'Nom',
  role: 'Role',
  email: 'Email',
  phone: 'Telephone',
  order: 'Ordre',
};

const SECTION_HEADER_LABELS = {
  enabled: 'Actif',
  category: 'Categorie',
  id: 'Cle section',
  num: 'Numero',
  label: 'Label',
  title: 'Titre',
  sub: 'Sous-titre',
  order: 'Ordre',
};

const HEADER_LABELS = {
  enabled: 'Actif',
  category: 'Categorie',
  section: 'Section',
  modele: 'Modèle',
  marque: 'Marque',
  nom_usage: 'Nom d’usage',
  desc: 'Description',
  peda: 'Pedagogie',
  img: 'Image principale',
  imgs: 'Images supplementaires',
  manuel: 'Manuel',
  tags: 'Tags',
  specs: 'Specifications',
  lienLabel: 'Bouton 1 - Label',
  lienUrl: 'Bouton 1 - URL',
  lienLabel2: 'Bouton 2 - Label',
  lienUrl2: 'Bouton 2 - URL',
  lienLabel3: 'Bouton 3 - Label',
  lienUrl3: 'Bouton 3 - URL',
};

const OPTIONS_SHEET_TITLE = '_options';
const CATEGORIES_SHEET_TITLE = 'categories';
const SECTIONS_SHEET_TITLE = 'sections';
const DEFAULT_CATALOGUE_SHEET_TITLE = 'catalogue';
const LEGACY_CATALOGUE_SHEET_TITLE = 'catalogue.sheet';
const ALLOW_UPDATE_ENV = 'GOOGLE_SHEET_ALLOW_OVERWRITE';
const WRITE_MODE_ENV = 'GOOGLE_SHEET_WRITE_MODE';
const WRITE_MODE = (process.env[WRITE_MODE_ENV] || 'safe').trim().toLowerCase();

function toA1Column(colIndex1Based) {
  let index = colIndex1Based;
  let result = '';
  while (index > 0) {
    const rem = (index - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    index = Math.floor((index - 1) / 26);
  }
  return result;
}

function csvEscape(value) {
  const str = value === undefined || value === null ? '' : String(value);
  if (!/[",\n\r]/.test(str)) return str;
  return '"' + str.replace(/"/g, '""') + '"';
}

function stringifySpecs(specs) {
  if (!Array.isArray(specs) || specs.length === 0) return '';

  return specs
    .map(entry => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return '';
      const key = Object.keys(entry)[0] || '';
      const value = key ? entry[key] : '';
      return key ? `${key}=${value ?? ''}` : '';
    })
    .filter(Boolean)
    .join('|');
}

function inferBrandFromName(name) {
  const value = (name || '').toString().trim();
  if (!value) return '';

  const knownBrands = ['ARRI', 'Sony', 'Bolex', 'Canon', 'Panasonic', 'Red', 'Blackmagic', 'Aaton', 'Cooke', 'Zeiss', 'Manfrotto', 'Avenger', 'DMG', 'Rosco', 'De Sisti', 'E-Image', 'Elemack'];
  const upperValue = value.toUpperCase();
  const matchedBrand = knownBrands.find(brand => upperValue.startsWith(`${brand.toUpperCase()} `));
  return matchedBrand || '';
}

function getProductModel(item) {
  return item?.model || item?.modele || item?.name || '';
}

function getProductBrand(item) {
  const override = item?.brand || item?.marque || '';
  if (override) return override;
  return inferBrandFromName(getProductModel(item));
}

function getProductUsageName(item) {
  return item?.usageName || item?.usage_name || item?.nomUsage || item?.nom_d_usage || '';
}

function getItemImages(categoryKey, item) {
  const images = [item?.img, ...(Array.isArray(item?.imgs) ? item.imgs : [])]
    .map(value => (value || '').toString().trim())
    .filter(Boolean);

  if (categoryKey === 'lumiere' && images.length > 1) {
    return {
      img: images.at(-1) || '',
      imgs: images.slice(1, -1).concat(images[0]).join('|'),
    };
  }

  return {
    img: images[0] || '',
    imgs: images.slice(1).join('|'),
  };
}

function hasSectionItems(categoryKey, sectionId) {
  return ((CATS[categoryKey]?.data?.[sectionId]) || []).some(Boolean);
}

function flattenCatalogue() {
  const rows = [];

  Object.entries(CATS).forEach(([categoryKey, category]) => {
    const sections = category.sections || [];

    sections.forEach(section => {
      const items = category.data?.[section.id] || [];

      items.forEach(item => {
        const imageColumns = getItemImages(categoryKey, item);
        rows.push({
          enabled: 'TRUE',
          category: categoryKey,
          section: section.id,
          modele: getProductModel(item),
          marque: getProductBrand(item),
          nom_usage: getProductUsageName(item),
          desc: item.desc || '',
          peda: item.peda || '',
          img: imageColumns.img,
          imgs: imageColumns.imgs,
          manuel: item.manuel || '',
          tags: Array.isArray(item.tags) ? item.tags.join(',') : '',
          specs: stringifySpecs(item.specs),
          lienLabel: item.lienLabel || '',
          lienUrl: item.lienUrl || '',
          lienLabel2: item.lienLabel2 || '',
          lienUrl2: item.lienUrl2 || '',
          lienLabel3: item.lienLabel3 || '',
          lienUrl3: item.lienUrl3 || '',
        });
      });
    });
  });

  return rows;
}

function groupRowsByCategory(rows) {
  const grouped = {};

  rows.forEach(row => {
    const categoryKey = row.category;
    if (!categoryKey) return;
    if (!grouped[categoryKey]) grouped[categoryKey] = [];
    grouped[categoryKey].push(row);
  });

  return grouped;
}

function perCategorySheetName(categoryKey) {
  return `items.${categoryKey}`;
}

function flattenCategories() {
  return Object.entries(CATS).map(([categoryKey, category], index) => {
    const homeCard = HOME_CARDS.find(card => card.key === categoryKey) || {};
    return {
      enabled: 'TRUE',
      key: categoryKey,
      title: category.title || homeCard.name || categoryKey,
      desc: category.desc || '',
      home_name: homeCard.name || category.title || categoryKey,
      home_desc: homeCard.desc || category.desc || '',
      home_img: homeCard.img || '',
      home_tags: Array.isArray(homeCard.tags) ? homeCard.tags.join(',') : '',
      order: String(index + 1).padStart(2, '0'),
    };
  });
}

function flattenSections() {
  const rows = [];

  Object.entries(CATS).forEach(([categoryKey, category]) => {
    (category.sections || []).forEach((section, index) => {
      if (!hasSectionItems(categoryKey, section.id)) return;
      rows.push({
        enabled: 'TRUE',
        category: categoryKey,
        id: section.id || '',
        num: section.num || String(index + 1).padStart(2, '0'),
        label: section.label || section.title || section.id || '',
        title: section.title || section.label || section.id || '',
        sub: section.sub || '',
        order: String(index + 1).padStart(2, '0'),
      });
    });
  });

  return rows;
}

function flattenContacts() {
  return CONTACTS.map((contact, index) => ({
    enabled: 'TRUE',
    name: contact.name || '',
    role: contact.role || '',
    email: contact.email || '',
    phone: contact.phone || '',
    order: String(index + 1).padStart(2, '0'),
  }));
}

function buildCsv(rows) {
  const lines = [HEADERS.map(csvEscape).join(',')];

  rows.forEach(row => {
    const line = HEADERS.map(header => csvEscape(row[header] ?? '')).join(',');
    lines.push(line);
  });

  return lines.join('\n');
}

function toSheetValues(rows, headers = HEADERS, headerLabels = HEADER_LABELS) {
  const labelRow = headers.map(header => headerLabels[header] || header);
  const values = [labelRow, headers];
  rows.forEach(row => {
    values.push(headers.map(header => row[header] ?? ''));
  });
  return values;
}

function ensureOutputDir() {
  const csvFilePath = fileURLToPath(OUTPUT_CSV_PATH);
  fs.mkdirSync(path.dirname(csvFilePath), { recursive: true });
}

function writeCsvFile(csv) {
  const csvFilePath = fileURLToPath(OUTPUT_CSV_PATH);
  ensureOutputDir();
  fs.writeFileSync(csvFilePath, csv, 'utf8');
  return csvFilePath;
}

function readCredentialsFromEnv() {
  const jsonPath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (jsonPath) {
    const raw = fs.readFileSync(path.resolve(jsonPath), 'utf8');
    const parsed = JSON.parse(raw);
    return {
      source: `json:${path.resolve(jsonPath)}`,
      project_id: parsed.project_id,
      client_email: parsed.client_email,
      private_key: parsed.private_key,
    };
  }

  if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    return {
      source: 'env:inline',
      project_id: process.env.GOOGLE_PROJECT_ID || '',
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    };
  }

  return null;
}

function buildOptionsGrid() {
  const categories = Object.keys(CATS);
  const maxSections = Math.max(
    1,
    ...categories.map(catKey => (CATS[catKey]?.sections || []).filter(section => hasSectionItems(catKey, section.id)).length),
  );

  const rows = [];
  rows.push(categories);

  for (let rowIdx = 0; rowIdx < maxSections; rowIdx += 1) {
    const row = categories.map(catKey => {
      const sec = (CATS[catKey]?.sections || [])[rowIdx];
      return sec?.id || '';
    });
    rows.push(row);
  }

  return rows;
}

function getSheetByTitle(meta, title) {
  return (meta.data.sheets || []).find(s => s?.properties?.title === title) || null;
}

function getMaxSectionCount() {
  return Math.max(
    1,
    ...Object.keys(CATS).map(catKey => (CATS[catKey]?.sections || []).filter(section => hasSectionItems(catKey, section.id)).length),
  );
}

async function resolveCatalogueSheetTitle(sheets, spreadsheetId) {
  const forced = (process.env.GOOGLE_SHEET_TAB || '').trim();
  if (forced) return forced;

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  if (getSheetByTitle(meta, LEGACY_CATALOGUE_SHEET_TITLE)) {
    return LEGACY_CATALOGUE_SHEET_TITLE;
  }

  return DEFAULT_CATALOGUE_SHEET_TITLE;
}

async function ensureSheet(sheets, spreadsheetId, title) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = getSheetByTitle(meta, title);
  if (existing) return existing.properties.sheetId;

  const addRes = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: { title },
          },
        },
      ],
    },
  });

  const reply = addRes.data.replies?.find(r => r.addSheet?.properties?.sheetId);
  const sheetId = reply?.addSheet?.properties?.sheetId;
  if (sheetId === undefined || sheetId === null) {
    throw new Error(`Impossible de creer l'onglet ${title}.`);
  }

  return sheetId;
}

async function upsertNamedRanges(sheets, spreadsheetId, optionsSheetId, optionsGrid) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existingRanges = meta.data.namedRanges || [];
  const categories = optionsGrid[0] || [];
  const requests = [];

  existingRanges.forEach(namedRange => {
    if (categories.includes(namedRange.name)) {
      requests.push({
        deleteNamedRange: {
          namedRangeId: namedRange.namedRangeId,
        },
      });
    }
  });

  categories.forEach((catKey, idx) => {
    const sectionCount = (CATS[catKey]?.sections || []).filter(section => hasSectionItems(catKey, section.id)).length;
    if (!sectionCount) return;

    requests.push({
      addNamedRange: {
        namedRange: {
          name: catKey,
          range: {
            sheetId: optionsSheetId,
            startRowIndex: 1,
            endRowIndex: 1 + sectionCount,
            startColumnIndex: idx,
            endColumnIndex: idx + 1,
          },
        },
      },
    });
  });

  if (requests.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests },
    });
  }
}

async function configureDropdowns(
  sheets,
  spreadsheetId,
  catalogueSheetId,
  categories,
  maxRows,
  options = {},
) {
  const fixedCategory = options.fixedCategory || '';
  const sectionOptions = Array.isArray(options.sectionOptions) ? options.sectionOptions : [];
  const lastRow = Math.max(3, maxRows || 1000);

  const categoryValidationValues = (fixedCategory ? [fixedCategory] : categories)
    .filter(Boolean)
    .map(value => ({ userEnteredValue: value }));

  const sectionValidationValues = sectionOptions
    .filter(Boolean)
    .map(value => ({ userEnteredValue: value }));

  const sectionValidation = sectionValidationValues.length
    ? {
        condition: {
          type: 'ONE_OF_LIST',
          values: sectionValidationValues,
        },
        strict: true,
        showCustomUi: true,
      }
    : null;

  const requests = [
    {
      repeatCell: {
        range: {
          sheetId: catalogueSheetId,
          startRowIndex: 2,
          endRowIndex: lastRow,
          startColumnIndex: 1,
          endColumnIndex: 2,
        },
        cell: {
          dataValidation: {
            condition: {
              type: 'ONE_OF_LIST',
              values: categoryValidationValues,
            },
            strict: true,
            showCustomUi: true,
          },
        },
        fields: 'dataValidation',
      },
    },
    {
      repeatCell: {
        range: {
          sheetId: catalogueSheetId,
          startRowIndex: 2,
          endRowIndex: lastRow,
          startColumnIndex: 0,
          endColumnIndex: 1,
        },
        cell: {
          dataValidation: {
            condition: {
              type: 'BOOLEAN',
              values: [
                { userEnteredValue: 'TRUE' },
                { userEnteredValue: 'FALSE' },
              ],
            },
            strict: true,
            showCustomUi: true,
          },
        },
        fields: 'dataValidation',
      },
    },
    {
      repeatCell: {
        range: {
          sheetId: catalogueSheetId,
          startRowIndex: 2,
          endRowIndex: lastRow,
          startColumnIndex: 2,
          endColumnIndex: 3,
        },
        cell: {
          dataValidation: sectionValidation,
        },
        fields: 'dataValidation',
      },
    },
  ];

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });
}

async function configureSheetLayout(sheets, spreadsheetId, catalogueSheetId, optionsSheetId, maxRows) {
  const lastRow = Math.max(3, maxRows || 1000);
  const requests = [
    {
      updateSheetProperties: {
        properties: {
          sheetId: catalogueSheetId,
          gridProperties: {
            frozenRowCount: 1,
          },
        },
        fields: 'gridProperties.frozenRowCount',
      },
    },
    {
      updateSheetProperties: {
        properties: {
          sheetId: optionsSheetId,
          hidden: true,
        },
        fields: 'hidden',
      },
    },
    {
      repeatCell: {
        range: {
          sheetId: catalogueSheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: HEADERS.length,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.11, green: 0.18, blue: 0.34 },
            textFormat: {
              foregroundColor: { red: 1, green: 1, blue: 1 },
              bold: true,
              fontSize: 10,
            },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
            wrapStrategy: 'WRAP',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)',
      },
    },
    {
      updateDimensionProperties: {
        range: {
          sheetId: catalogueSheetId,
          dimension: 'ROWS',
          startIndex: 1,
          endIndex: 2,
        },
        properties: {
          hiddenByUser: true,
        },
        fields: 'hiddenByUser',
      },
    },
    {
      repeatCell: {
        range: {
          sheetId: catalogueSheetId,
          startRowIndex: 2,
          endRowIndex: lastRow,
          startColumnIndex: 0,
          endColumnIndex: HEADERS.length,
        },
        cell: {
          userEnteredFormat: {
            verticalAlignment: 'TOP',
            wrapStrategy: 'WRAP',
            textFormat: {
              fontSize: 10,
            },
          },
        },
        fields: 'userEnteredFormat(verticalAlignment,wrapStrategy,textFormat.fontSize)',
      },
    },
  ];

  const widthByHeader = {
    enabled: 90,
    category: 130,
    section: 140,
    modele: 220,
    marque: 140,
    nom_usage: 220,
    desc: 420,
    peda: 360,
    img: 260,
    imgs: 300,
    manuel: 260,
    tags: 180,
    specs: 420,
    lienLabel: 150,
    lienUrl: 260,
    lienLabel2: 150,
    lienUrl2: 260,
    lienLabel3: 150,
    lienUrl3: 260,
  };

  HEADERS.forEach((header, idx) => {
    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId: catalogueSheetId,
          dimension: 'COLUMNS',
          startIndex: idx,
          endIndex: idx + 1,
        },
        properties: {
          pixelSize: widthByHeader[header] || 160,
        },
        fields: 'pixelSize',
      },
    });
  });

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });
}

async function writeSheetValues(sheets, spreadsheetId, sheetTitle, values, inputOption = 'RAW') {
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${sheetTitle}!A:Z`,
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetTitle}!A1`,
    valueInputOption: inputOption,
    requestBody: { values },
  });
}

async function configureMetaSheetLayout(sheets, spreadsheetId, sheetId, headers) {
  const requests = [
    {
      updateSheetProperties: {
        properties: {
          sheetId,
          gridProperties: {
            frozenRowCount: 1,
          },
        },
        fields: 'gridProperties.frozenRowCount',
      },
    },
    {
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: 'ROWS',
          startIndex: 1,
          endIndex: 2,
        },
        properties: {
          hiddenByUser: true,
        },
        fields: 'hiddenByUser',
      },
    },
  ];

  headers.forEach((_, idx) => {
    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: 'COLUMNS',
          startIndex: idx,
          endIndex: idx + 1,
        },
        properties: {
          pixelSize: idx < 4 ? 180 : 240,
        },
        fields: 'pixelSize',
      },
    });
  });

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });
}

async function createOrUpdateGoogleSheet(payload) {
  const credentials = readCredentialsFromEnv();
  const allowExistingUpdate = WRITE_MODE === 'overwrite' || ['1', 'true', 'yes', 'oui'].includes(String(process.env[ALLOW_UPDATE_ENV] || '').trim().toLowerCase());

  if (!credentials?.client_email || !credentials?.private_key) {
    return {
      mode: 'csv-only',
      message: 'Aucun credential Google detecte. CSV genere uniquement.',
    };
  }

  if (!allowExistingUpdate) {
    return {
      mode: 'csv-only',
      message: `Ecriture Google Sheets desactive en mode safe. Definir ${WRITE_MODE_ENV}=overwrite pour autoriser la mise a jour du sheet existant.`,
    };
  }

  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
  });

  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetIdEnv = process.env.GOOGLE_SHEET_ID;
  let catalogueSheetTitle = DEFAULT_CATALOGUE_SHEET_TITLE;

  let spreadsheetId = spreadsheetIdEnv;
  let spreadsheetUrl = '';

  if (spreadsheetIdEnv && !allowExistingUpdate) {
    throw new Error(
      `Refus de re-ecrire la feuille existante ${spreadsheetIdEnv}. ` +
      `Ajoute ${ALLOW_UPDATE_ENV}=true pour confirmer l'ecrasement.`,
    );
  }

  if (!spreadsheetId) {
    const createRes = await sheets.spreadsheets.create({
      requestBody: {
        properties: { title: 'Magasin Image Catalogue' },
        sheets: [{ properties: { title: 'catalogue' } }],
      },
    });

    spreadsheetId = createRes.data.spreadsheetId;
    spreadsheetUrl = createRes.data.spreadsheetUrl || '';
  }

  if (!spreadsheetId) {
    throw new Error('Impossible de recuperer un spreadsheetId Google Sheets.');
  }

  catalogueSheetTitle = await resolveCatalogueSheetTitle(sheets, spreadsheetId);
  const catalogueSheetId = await ensureSheet(sheets, spreadsheetId, catalogueSheetTitle);
  const categoriesSheetId = await ensureSheet(sheets, spreadsheetId, CATEGORIES_SHEET_TITLE);
  const sectionsSheetId = await ensureSheet(sheets, spreadsheetId, SECTIONS_SHEET_TITLE);
  const contactsSheetId = await ensureSheet(sheets, spreadsheetId, CONTACTS_SHEET_TITLE);
  const optionsSheetId = await ensureSheet(sheets, spreadsheetId, OPTIONS_SHEET_TITLE);
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const catalogueSheet = getSheetByTitle(meta, catalogueSheetTitle);
  const maxRows = catalogueSheet?.properties?.gridProperties?.rowCount || 1000;

  const optionsGrid = buildOptionsGrid();
  const optionsLastCol = toA1Column(optionsGrid[0]?.length || 1);
  const categoryKeys = Object.keys(CATS);

  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${OPTIONS_SHEET_TITLE}!A:${optionsLastCol}`,
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${OPTIONS_SHEET_TITLE}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: optionsGrid },
  });

  await upsertNamedRanges(sheets, spreadsheetId, optionsSheetId, optionsGrid);

  await writeSheetValues(sheets, spreadsheetId, CATEGORIES_SHEET_TITLE, payload.categoryValues, 'USER_ENTERED');
  await writeSheetValues(sheets, spreadsheetId, SECTIONS_SHEET_TITLE, payload.sectionValues, 'USER_ENTERED');
  await writeSheetValues(sheets, spreadsheetId, CONTACTS_SHEET_TITLE, payload.contactValues, 'USER_ENTERED');
  await writeSheetValues(sheets, spreadsheetId, catalogueSheetTitle, payload.itemValues, 'USER_ENTERED');

  const perCategorySheetIds = {};
  for (const categoryKey of categoryKeys) {
    const sheetTitle = perCategorySheetName(categoryKey);
    const sheetId = await ensureSheet(sheets, spreadsheetId, sheetTitle);
    perCategorySheetIds[categoryKey] = sheetId;
    await writeSheetValues(
      sheets,
      spreadsheetId,
      sheetTitle,
      payload.itemValuesByCategory?.[categoryKey] || toSheetValues([]),
      'USER_ENTERED',
    );
  }

  await configureSheetLayout(
    sheets,
    spreadsheetId,
    catalogueSheetId,
    optionsSheetId,
    maxRows,
  );
  await configureDropdowns(
    sheets,
    spreadsheetId,
    catalogueSheetId,
    optionsGrid[0] || [],
    maxRows,
  );

  for (const categoryKey of categoryKeys) {
    const sheetId = perCategorySheetIds[categoryKey];
    const sectionOptions = (CATS[categoryKey]?.sections || [])
      .map(section => section.id)
      .filter(sectionId => sectionId && hasSectionItems(categoryKey, sectionId));

    await configureSheetLayout(
      sheets,
      spreadsheetId,
      sheetId,
      optionsSheetId,
      maxRows,
    );

    await configureDropdowns(
      sheets,
      spreadsheetId,
      sheetId,
      optionsGrid[0] || [],
      maxRows,
      {
        fixedCategory: categoryKey,
        sectionOptions,
      },
    );
  }
  await configureMetaSheetLayout(sheets, spreadsheetId, categoriesSheetId, CATEGORY_HEADERS);
  await configureMetaSheetLayout(sheets, spreadsheetId, sectionsSheetId, SECTION_HEADERS);
  await configureMetaSheetLayout(sheets, spreadsheetId, contactsSheetId, CONTACT_HEADERS);

  if (!spreadsheetUrl) {
    spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
  }

  return {
    mode: spreadsheetIdEnv ? 'updated' : 'created',
    spreadsheetId,
    spreadsheetUrl,
    catalogueSheetTitle,
    perCategorySheetNames: categoryKeys.map(perCategorySheetName),
  };
}

async function main() {
  const rows = flattenCatalogue();
  const rowsByCategory = groupRowsByCategory(rows);
  const categoryRows = flattenCategories();
  const sectionRows = flattenSections();
  const contactRows = flattenContacts();
  const csv = buildCsv(rows);
  const itemValues = toSheetValues(rows);
  const itemValuesByCategory = Object.fromEntries(
    Object.entries(rowsByCategory).map(([categoryKey, categoryRowsList]) => [
      categoryKey,
      toSheetValues(categoryRowsList),
    ]),
  );
  const categoryValues = toSheetValues(categoryRows, CATEGORY_HEADERS, CATEGORY_HEADER_LABELS);
  const sectionValues = toSheetValues(sectionRows, SECTION_HEADERS, SECTION_HEADER_LABELS);
  const contactValues = toSheetValues(contactRows, CONTACT_HEADERS, CONTACT_HEADER_LABELS);
  const csvPath = writeCsvFile(csv);

  const result = await createOrUpdateGoogleSheet({
    itemValues,
    itemValuesByCategory,
    categoryValues,
    sectionValues,
    contactValues,
  });

  const credentials = readCredentialsFromEnv();

  console.log(`[sheet] Lignes exportees: ${rows.length}`);
  console.log(`[sheet] CSV genere: ${csvPath}`);
  console.log(`[sheet] Credentials source: ${credentials?.source || 'none'}`);
  if (credentials?.project_id) {
    console.log(`[sheet] Credentials project_id: ${credentials.project_id}`);
  }
  if (credentials?.client_email) {
    console.log(`[sheet] Credentials client_email: ${credentials.client_email}`);
  }
  console.log(`[sheet] Mode: ${process.env.GOOGLE_SHEET_ID ? 'update existing sheet' : 'create new sheet'}`);

  if (result.mode === 'csv-only') {
    console.log('[sheet] Aucun Google Sheet mis a jour automatiquement.');
    if (result.message) console.log(`[sheet] ${result.message}`);
    console.log('[sheet] Definir GOOGLE_SHEET_WRITE_MODE=overwrite et GOOGLE_SERVICE_ACCOUNT_JSON (+ optionnel GOOGLE_SHEET_ID) pour une mise a jour API.');
    return;
  }

  console.log(`[sheet] Spreadsheet ${result.mode}: ${result.spreadsheetId}`);
  console.log(`[sheet] URL: ${result.spreadsheetUrl}`);
  console.log(`[sheet] Onglet cible: ${result.catalogueSheetTitle}`);
  console.log(`[sheet] Onglets categorie: ${(result.perCategorySheetNames || []).join(', ')}`);
  console.log('[sheet] Pense a partager la feuille avec ton compte Google si tu veux la modifier manuellement.');
}

main().catch(error => {
  const credentials = readCredentialsFromEnv();
  const status = error?.response?.status;
  const apiMessage = error?.response?.data?.error?.message;
  const apiCode = error?.response?.data?.error?.code;

  console.error('[sheet] Erreur:', error?.message || error);
  console.error(`[sheet] Credentials source: ${credentials?.source || 'none'}`);
  if (credentials?.project_id) {
    console.error(`[sheet] Credentials project_id: ${credentials.project_id}`);
  }
  if (credentials?.client_email) {
    console.error(`[sheet] Credentials client_email: ${credentials.client_email}`);
  }
  console.error(`[sheet] Mode: ${process.env.GOOGLE_SHEET_ID ? 'update existing sheet' : 'create new sheet'}`);
  if (status) console.error(`[sheet] HTTP status: ${status}`);
  if (apiCode) console.error(`[sheet] API code: ${apiCode}`);
  if (apiMessage) console.error(`[sheet] API message: ${apiMessage}`);

  if ((apiMessage || '').toLowerCase().includes('does not have permission')) {
    console.error('[sheet] Pistes:');
    console.error('[sheet] 1) Si GOOGLE_SHEET_ID est defini, partager ce Sheet avec client_email (role Editor).');
    console.error('[sheet] 2) Activer Google Sheets API + Google Drive API dans le meme projet que le service account.');
    console.error('[sheet] 3) Donner au service account le role "Service Usage Consumer" sur le projet Google Cloud.');
    console.error('[sheet] 4) Retester sans GOOGLE_SHEET_ID pour forcer la creation d\'un nouveau Sheet.');
  }
  process.exit(1);
});
