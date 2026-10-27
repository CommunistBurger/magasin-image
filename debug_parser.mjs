import { readFileSync } from 'node:fs';

function normalizeText(value) {
  return (value || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
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
      return rowObj;
    });
}

const csvText = await (await fetch('https://docs.google.com/spreadsheets/d/e/2PACX-1vToLN24n012aQRl6FmQk-WRchbuUkKVKcKt1f74X6CMVPiwvZiJ3i_cgTyvLRSeK7z4JufNObu8fE5y/pub?output=csv&sheet=categories')).text();
const rows = parseRows(csvText);
console.log(JSON.stringify(rows.slice(0, 3), null, 2));
