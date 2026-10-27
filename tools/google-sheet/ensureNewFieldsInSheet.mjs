import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { google } from 'googleapis';

const spreadsheetId = process.env.GOOGLE_SHEET_ID || '1fVxohe1kAALsfMX7mWuT4NgCuQJtCpHgKDLobhYGiEw';
const sheetTitles = ['items.lumiere', 'items.grip', 'items.machinerie', 'items.camera', 'items.objectifs', 'items.accessoires'];

function readCredentialsFromEnv() {
  const jsonPath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (jsonPath) {
    const raw = fs.readFileSync(path.resolve(jsonPath), 'utf8');
    return JSON.parse(raw);
  }
  return null;
}

function normalizeHeader(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function hasHeader(headers, candidates) {
  const normalizedCandidates = candidates.map(normalizeHeader);
  return headers.some(header => normalizedCandidates.includes(normalizeHeader(header)));
}

function buildUpdatedRows(rows) {
  if (!rows.length) return rows;

  const existingLabels = [...(rows[0] || [])];
  const existingKeys = [...(rows[1] || [])];
  const labelRow = [...existingLabels];
  const keyRow = [...existingKeys];

  const additions = [
    { label: 'Catégorie', key: 'category', candidates: ['category', 'categorie', 'catégorie', 'cle_categorie'] },
    { label: 'Section', key: 'section', candidates: ['section', 'sous_categorie', 'sous-categorie', 'sous_categorie_id', 'section_id'] },
    { label: 'Nom', key: 'name', candidates: ['name', 'nom', 'nom_du_produit', 'nom_produit'] },
  ];

  const addedColumns = [];

  additions.forEach(addition => {
    if (!hasHeader(labelRow, addition.candidates)) {
      labelRow.push(addition.label);
      keyRow.push(addition.key);
      addedColumns.push({ key: addition.key, label: addition.label });
    }
  });

  const updatedRows = [labelRow, keyRow];
  rows.slice(2).forEach(row => {
    const newRow = [...row];
    while (newRow.length < labelRow.length) newRow.push('');

    addedColumns.forEach((column, index) => {
      const targetIndex = labelRow.length - addedColumns.length + index;
      const sourceValue = (() => {
        if (column.key === 'category') return newRow[1] || '';
        if (column.key === 'section') return newRow[2] || '';
        if (column.key === 'name') return newRow[3] || '';
        return '';
      })();
      newRow[targetIndex] = sourceValue;
    });

    updatedRows.push(newRow);
  });
  return updatedRows;
}

function getSheetRange(sheetTitle, startCell = 'A1', endCell = null) {
  const title = String(sheetTitle).replace(/'/g, "''");
  if (endCell) {
    return `${title}!${startCell}:${endCell}`;
  }
  return `${title}!${startCell}`;
}

async function main() {
  const creds = readCredentialsFromEnv();
  if (!creds?.client_email || !creds?.private_key) {
    console.error('Missing Google credentials');
    process.exit(1);
  }

  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  for (const sheetTitle of sheetTitles) {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: getSheetRange(sheetTitle, 'A1') });
    const rows = res.data.values || [];
    if (!rows.length) continue;

    const updatedRows = buildUpdatedRows(rows);
    const changed = JSON.stringify(rows) !== JSON.stringify(updatedRows);
    if (!changed) {
      console.log(`[sheet] ${sheetTitle}: already up to date`);
      continue;
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetTitle}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: updatedRows },
    });

    console.log(`[sheet] ${sheetTitle}: restored category/section/name columns and added model/brand/usage metadata columns`);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
