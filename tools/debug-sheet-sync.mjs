import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const spreadsheetId = process.env.GOOGLE_SHEET_ID || '1fVxohe1kAALsfMX7mWuT4NgCuQJtCpHgKDLobhYGiEw';

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
  const firstScore = required.filter(key => firstHeaders.includes(key)).length;
  const secondScore = required.filter(key => secondHeaders.includes(key)).length;
  const secondLooksCanonical = required.every(key => secondHeaders.includes(key));
  const useSecondRowAsHeaders = secondLooksCanonical || secondScore > firstScore;
  const headers = useSecondRowAsHeaders ? secondHeaders : firstHeaders;
  const dataStartIndex = useSecondRowAsHeaders ? 2 : 1;
  return matrix.slice(dataStartIndex).filter(r => r.some(cell => (cell || '').trim() !== '')).map(r => {
    const rowObj = {};
    headers.forEach((header, index) => {
      rowObj[header] = (r[index] || '').trim();
    });
    return rowObj;
  });
}

async function fetchSheet(sheetName) {
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}&cb=${Date.now()}`;
  const res = await fetch(url);
  const text = await res.text();
  console.log(`\n[${sheetName}] status=${res.status} len=${text.length}`);
  if (!text || text.includes('<!DOCTYPE') || text.includes('<html')) {
    console.log(text.slice(0, 400));
    return { rows: [], sample: '' };
  }
  const rows = parseRows(text);
  console.log(`[${sheetName}] parsedRows=${rows.length}`);
  if (rows.length) {
    console.log(`[${sheetName}] firstRow=${JSON.stringify(rows[0])}`);
  }
  return { rows, sample: rows[0] ? JSON.stringify(rows[0]) : '' };
}

const sheets = ['categories', 'sections', 'contacts', 'items.lumiere', 'items.grip', 'items.machinerie', 'items.camera', 'items.objectifs', 'items.accessoires'];
for (const sheetName of sheets) {
  await fetchSheet(sheetName);
}
