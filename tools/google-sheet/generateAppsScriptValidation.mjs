import fs from 'node:fs';

const OUTPUT_PATH = new URL('./sectionValidation.generated.gs', import.meta.url);

function buildScript() {
  return `/**
 * Google Apps Script - Validation dynamique section selon category (onglets items.*)
 *
 * Installation:
 * 1) Ouvrir le Google Sheet
 * 2) Extensions > Apps Script
 * 3) Coller ce fichier dans Code.gs
 * 4) Enregistrer puis executer refreshAllSectionValidations() une fois
 */

const ITEM_SHEET_PREFIX = 'items.';
const SECTIONS_SHEET_NAME = 'sections';
const HEADER_LABEL_ROW = 1;
const KEY_ROW = 2;
const DATA_START_ROW = 3;
const DOC_PROP_TYPED_LOCK_PREFIX = 'sectionValidation.typedLock.';
const DOC_PROP_SAFE_MODE = 'sectionValidation.safeMode';
const SCRIPT_VERSION = 'section-validation-2026-07-13-1';

function sectionValidationDiagnostics() {
  const triggerCount = ScriptApp.getProjectTriggers().length;
  const safeMode = isSafeModeEnabled_();
  Logger.log('[SectionValidation] version=' + SCRIPT_VERSION + ' triggers=' + triggerCount + ' safeMode=' + safeMode);
}

function sectionValidationSetSafeMode(enabled) {
  try {
    PropertiesService.getDocumentProperties().setProperty(DOC_PROP_SAFE_MODE, enabled ? '1' : '0');
    Logger.log('[SectionValidation] safeMode=' + (enabled ? 'true' : 'false'));
  } catch (error) {
    logTriggerError_(error);
  }
}

function sectionValidationEnableSafeMode() {
  sectionValidationSetSafeMode(true);
}

function sectionValidationDisableSafeMode() {
  sectionValidationSetSafeMode(false);
}

function onEdit(e) {
  try {
    if (!e || !e.range) return;
    const sheet = e.range.getSheet();
    if (isSectionsSheet_(sheet)) {
      if (e.range.getRow() >= DATA_START_ROW) {
        refreshAllSectionValidations();
      }
      return;
    }

    if (!isItemSheet_(sheet)) return;

    const colMap = getColumnMapSafe_(sheet, defaultItemColumnMap_());
    if (!colMap.category || !colMap.section) return;

    const row = e.range.getRow();
    const col = e.range.getColumn();
    if (row < DATA_START_ROW) return;

    if (col === colMap.category) {
      applyRowValidationSafe_(sheet, row, colMap);
    }
  } catch (error) {
    logTriggerError_(error);
  }
}

function isSectionsSheet_(sheet) {
  const name = String(sheet.getName() || '');
  return name === SECTIONS_SHEET_NAME;
}

function refreshAllSectionValidations() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const targetSheets = getTargetItemSheets_(ss);
    if (!targetSheets.length) throw new Error('Aucun onglet items.* detecte.');

    targetSheets.forEach(sheet => {
      const colMap = getColumnMapSafe_(sheet, defaultItemColumnMap_());
      if (!colMap.category || !colMap.section) return;

      const lastRow = Math.max(sheet.getLastRow(), DATA_START_ROW);
      for (let row = DATA_START_ROW; row <= lastRow; row += 1) {
        applyRowValidationSafe_(sheet, row, colMap);
      }
    });
  } catch (error) {
    logTriggerError_(error);
  }
}

function logTriggerError_(error) {
  const message = error && error.message ? error.message : String(error || 'Erreur inconnue');
  try {
    Logger.log('[SectionValidation] ' + message);
  } catch (_) {
    // no-op
  }
}

function isItemSheet_(sheet) {
  const name = String(sheet.getName() || '');
  return name.indexOf(ITEM_SHEET_PREFIX) === 0;
}

function getTargetItemSheets_(spreadsheet) {
  return spreadsheet
    .getSheets()
    .filter(isItemSheet_);
}
function applyRowValidationSafe_(sheet, row, colMap) {
  try {
    applyRowValidation_(sheet, row, colMap);
  } catch (error) {
    const base = error && error.message ? error.message : String(error || 'Erreur inconnue');
    logTriggerError_(new Error('[Row ' + sheet.getName() + '!' + row + '] ' + base));
  }
}

function applyRowValidation_(sheet, row, colMap) {
  if (isSafeModeEnabled_()) {
    Logger.log('[SectionValidation] safeMode active, skipping section-cell write for ' + sheet.getName() + '!' + row);
    return;
  }
  if (isTypedColumnLocked_(sheet, colMap.section)) return;

  const sectionsByCategory = loadSectionsByCategory_(sheet.getParent());
  const category = String(sheet.getRange(row, colMap.category).getValue() || '').trim();
  const sectionCell = sheet.getRange(row, colMap.section);
  const allowedSections = sectionsByCategory[category] || [];

  if (!allowedSections.length) {
    const noteResult = setNoteSafely_(sectionCell, 'Aucune section disponible pour cette categorie.');
    if (!noteResult.ok && noteResult.forbiddenTypedColumn) {
      markTypedColumnLocked_(sheet, colMap.section);
    }
    return;
  }

  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(allowedSections, true)
    .setAllowInvalid(false)
    .build();

  const current = String(sectionCell.getValue() || '').trim();

  const validationResult = setValidationSafely_(sectionCell, rule);
  if (!validationResult.ok) {
    if (validationResult.forbiddenTypedColumn) {
      markTypedColumnLocked_(sheet, colMap.section);
      return;
    }

    // Google Sheets tables with typed columns can block Apps Script data validation edits.
    const suffix = current && !allowedSections.includes(current)
      ? ' (valeur actuelle hors liste)'
      : '';
    const noteResult = setNoteSafely_(sectionCell, 'Options autorisees: ' + allowedSections.join(', ') + suffix);
    if (!noteResult.ok && noteResult.forbiddenTypedColumn) {
      markTypedColumnLocked_(sheet, colMap.section);
    }
  } else {
    const clearResult = clearNoteSafely_(sectionCell);
    if (!clearResult.ok && clearResult.forbiddenTypedColumn) {
      markTypedColumnLocked_(sheet, colMap.section);
    }
  }
}

function loadSectionsByCategory_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName(SECTIONS_SHEET_NAME);
  if (!sheet) return {};

  const colMap = getColumnMapSafe_(sheet, defaultSectionsColumnMap_());
  if (!colMap.category || !colMap.id) return {};

  const lastRow = sheet.getLastRow();
  if (lastRow < DATA_START_ROW) return {};

  const values = sheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1, sheet.getLastColumn()).getValues();
  const map = {};

  values.forEach(row => {
    const enabledValue = String(row[(colMap.enabled || 1) - 1] || '').trim().toLowerCase();
    if (enabledValue && !['true', 'vrai', '1'].includes(enabledValue)) return;

    const category = String(row[colMap.category - 1] || '').trim();
    const sectionId = String(row[colMap.id - 1] || '').trim();
    if (!category || !sectionId) return;

    if (!map[category]) map[category] = [];
    map[category].push(sectionId);
  });

  return map;
}

function clearValidationSafely_(range) {
  try {
    range.clearDataValidations();
    return {
      ok: true,
      forbiddenTypedColumn: false,
    };
  } catch (error) {
    return {
      ok: false,
      forbiddenTypedColumn: isTypedColumnWriteForbiddenError_(error),
    };
  }
}

function setValidationSafely_(range, rule) {
  try {
    range.setDataValidation(rule);
    return {
      ok: true,
      forbiddenTypedColumn: false,
    };
  } catch (error) {
    return {
      ok: false,
      forbiddenTypedColumn: isTypedColumnWriteForbiddenError_(error),
    };
  }
}

function clearContentSafely_(range) {
  try {
    range.clearContent();
    return true;
  } catch (_) {
    return false;
  }
}

function clearNoteSafely_(range) {
  try {
    range.clearNote();
    return {
      ok: true,
      forbiddenTypedColumn: false,
    };
  } catch (error) {
    return {
      ok: false,
      forbiddenTypedColumn: isTypedColumnWriteForbiddenError_(error),
    };
  }
}

function setNoteSafely_(range, text) {
  try {
    range.setNote(text);
    return {
      ok: true,
      forbiddenTypedColumn: false,
    };
  } catch (error) {
    return {
      ok: false,
      forbiddenTypedColumn: isTypedColumnWriteForbiddenError_(error),
    };
  }
}

function typedColumnLockKey_(sheet, column) {
  return DOC_PROP_TYPED_LOCK_PREFIX + sheet.getSheetId() + '.' + column;
}

function isSafeModeEnabled_() {
  try {
    const value = PropertiesService.getDocumentProperties().getProperty(DOC_PROP_SAFE_MODE);
    return value === '1';
  } catch (_) {
    return false;
  }
}

function isTypedColumnLocked_(sheet, column) {
  try {
    const key = typedColumnLockKey_(sheet, column);
    const value = PropertiesService.getDocumentProperties().getProperty(key);
    return value === '1';
  } catch (_) {
    return false;
  }
}

function markTypedColumnLocked_(sheet, column) {
  try {
    const key = typedColumnLockKey_(sheet, column);
    PropertiesService.getDocumentProperties().setProperty(key, '1');
  } catch (_) {
    // ignore
  }
}

function isTypedColumnWriteForbiddenError_(error) {
  const raw = error && error.message ? error.message : String(error || '');
  const normalized = normalizeToken_(raw);
  return normalized.indexOf('operation n est pas autorisee sur les cellules des colonnes dont le type a ete determine par l utilisateur') !== -1;
}

function getColumnMap_(sheet) {
  const map = {};
  const lastColumn = Math.max(readLastColumnSafely_(sheet), 1);

  // Priorite: ligne de cles (ligne 2) quand elle est accessible.
  const keyRow = readRowSafely_(sheet, KEY_ROW, lastColumn);
  keyRow.forEach((key, idx) => {
    const raw = String(key || '').trim();
    if (!raw) return;
    map[raw] = idx + 1;
  });

  if (map.category && (map.section || map.id)) {
    return map;
  }

  // Fallback: mapping depuis la ligne labels (ligne 1), utile pour colonnes typées.
  const labelRow = readRowSafely_(sheet, HEADER_LABEL_ROW, lastColumn);
  labelRow.forEach((label, idx) => {
    const normalized = normalizeToken_(label);
    if (!normalized) return;
    const col = idx + 1;

    if (!map.enabled && ['enabled', 'actif', 'active'].includes(normalized)) {
      map.enabled = col;
    }

    if (!map.category && ['category', 'categorie'].includes(normalized)) {
      map.category = col;
    }

    if (!map.section && ['section', 'sous categorie', 'sous categorie id'].includes(normalized)) {
      map.section = col;
    }

    if (!map.id && ['id', 'cle section', 'section id', 'cle'].includes(normalized)) {
      map.id = col;
    }
  });

  // Si une seule notion de section est presente, reutiliser pour id/section.
  if (map.section && !map.id) map.id = map.section;
  if (map.id && !map.section) map.section = map.id;

  return map;
}

function readRowSafely_(sheet, row, lastColumn) {
  try {
    return sheet
      .getRange(row, 1, 1, lastColumn)
      .getValues()[0]
      .map(v => String(v || '').trim());
  } catch (_) {
    return [];
  }
}

function readLastColumnSafely_(sheet) {
  try {
    return sheet.getLastColumn();
  } catch (_) {
    return 0;
  }
}

function defaultItemColumnMap_() {
  return {
    enabled: 1,
    category: 2,
    section: 3,
  };
}

function defaultSectionsColumnMap_() {
  return {
    enabled: 1,
    category: 2,
    id: 3,
  };
}

function getColumnMapSafe_(sheet, fallbackMap) {
  try {
    const dynamic = getColumnMap_(sheet);
    return {
      ...fallbackMap,
      ...dynamic,
    };
  } catch (_) {
    return { ...fallbackMap };
  }
}

function normalizeToken_(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
`;
}

const content = buildScript();
fs.writeFileSync(OUTPUT_PATH, content, 'utf8');
console.log(`[apps-script] Generated: ${OUTPUT_PATH.pathname}`);
