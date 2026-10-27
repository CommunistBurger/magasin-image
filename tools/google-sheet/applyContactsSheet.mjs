import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { google } from 'googleapis';
import { CONTACTS } from '../../src/data/contacts.js';
import { SHEET_SYNC_CONFIG } from '../../src/data/sheetConfig.js';

const CONTACTS_SHEET_TITLE = SHEET_SYNC_CONFIG.sheetNames?.contacts || 'contacts';
const CONTACT_HEADERS = ['enabled', 'name', 'role', 'email', 'phone', 'order'];
const CONTACT_HEADER_LABELS = {
  enabled: 'Actif',
  name: 'Nom',
  role: 'Role',
  email: 'Email',
  phone: 'Telephone',
  order: 'Ordre',
};

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

function getSheetByTitle(meta, title) {
  return (meta.data.sheets || []).find(sheet => sheet?.properties?.title === title) || null;
}

function toSheetValues() {
  const labelRow = CONTACT_HEADERS.map(key => CONTACT_HEADER_LABELS[key] || key);
  const keyRow = [...CONTACT_HEADERS];
  const dataRows = CONTACTS.map((contact, index) => [
    'TRUE',
    contact.name || '',
    contact.role || '',
    contact.email || '',
    contact.phone || '',
    String(index + 1).padStart(2, '0'),
  ]);

  return [labelRow, keyRow, ...dataRows];
}

async function ensureSheet(sheets, spreadsheetId, title) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = getSheetByTitle(meta, title);
  if (existing) return existing.properties.sheetId;

  const addRes = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title } } }],
    },
  });

  const reply = addRes.data.replies?.find(r => r.addSheet?.properties?.sheetId);
  const sheetId = reply?.addSheet?.properties?.sheetId;
  if (sheetId === undefined || sheetId === null) {
    throw new Error(`Impossible de creer l'onglet ${title}.`);
  }

  return sheetId;
}

async function configureSheetLayout(sheets, spreadsheetId, sheetId) {
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

  CONTACT_HEADERS.forEach((_, idx) => {
    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: 'COLUMNS',
          startIndex: idx,
          endIndex: idx + 1,
        },
        properties: {
          pixelSize: idx < 2 ? 180 : 240,
        },
        fields: 'pixelSize',
      },
    });
  });

  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 2,
        endRowIndex: 1000,
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
  });

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });
}

async function main() {
  const sheets = buildGoogleClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID || SHEET_SYNC_CONFIG.spreadsheetId;
  if (!spreadsheetId) {
    throw new Error('Aucun spreadsheetId configure.');
  }

  const sheetId = await ensureSheet(sheets, spreadsheetId, CONTACTS_SHEET_TITLE);
  const values = toSheetValues();

  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${CONTACTS_SHEET_TITLE}!A:Z`,
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${CONTACTS_SHEET_TITLE}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  });

  await configureSheetLayout(sheets, spreadsheetId, sheetId);

  console.log(JSON.stringify({
    spreadsheetId,
    contactsSheet: CONTACTS_SHEET_TITLE,
    rowCount: values.length - 2,
  }, null, 2));
}

main().catch(error => {
  console.error('Erreur:', error?.message || error);
  process.exitCode = 1;
});
