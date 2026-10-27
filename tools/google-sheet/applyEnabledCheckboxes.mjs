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

function getSheetByTitle(meta, title) {
  return (meta.data.sheets || []).find(sheet => sheet?.properties?.title === title) || null;
}

async function main() {
  const sheets = buildGoogleClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID || SHEET_SYNC_CONFIG.spreadsheetId;
  if (!spreadsheetId) {
    throw new Error('Aucun spreadsheetId configure.');
  }

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const itemsByCategory = SHEET_SYNC_CONFIG.sheetNames?.itemsByCategory || {};

  const targetTitles = [
    SHEET_SYNC_CONFIG.sheetNames?.categories || 'categories',
    SHEET_SYNC_CONFIG.sheetNames?.sections || 'sections',
    ...Object.values(itemsByCategory),
    'catalogue',
    'catalogue.sheet',
  ];

  const uniqueTitles = [...new Set(targetTitles.filter(Boolean))];
  const requests = [];
  const appliedSheets = [];

  uniqueTitles.forEach(title => {
    const sheet = getSheetByTitle(meta, title);
    if (!sheet?.properties?.sheetId) return;

    const rowCount = Math.max(sheet.properties?.gridProperties?.rowCount || 1000, 1000);
    requests.push({
      repeatCell: {
        range: {
          sheetId: sheet.properties.sheetId,
          startRowIndex: 2,
          endRowIndex: rowCount,
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

    appliedSheets.push(title);
  });

  if (requests.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests },
    });
  }

  console.log(JSON.stringify({ spreadsheetId, appliedSheets }, null, 2));
}

main().catch(error => {
  console.error('Erreur:', error?.message || error);
  process.exitCode = 1;
});
