/**
 * Configuration de synchronisation Google Sheets.
 *
 * 1) Publier la feuille en CSV (Publier sur le Web)
 * 2) Coller l'URL CSV dans csvUrl
 * 3) Passer enabled a true
 */
export const SHEET_SYNC_CONFIG = {
  enabled: true,
  // Si tu utilises le document public CSV publié par Google Sheets, laisse spreadsheetId vide.
  // Les URLs gviz/tq des onglets renvoient 401 si la feuille n'est pas publique ou si le document n'est pas publié.
  spreadsheetId: '1_Rrc3K-E5zxowtFnPjtPnR-REp25VU7jd7Q6BhWdDGo',
  // Le fallback CSV public est utile quand le Sheet n'est pas accessible en lecture publique via gviz/tq.
  // Il évite de rester bloqué sur un document privé ou une feuille non publiée.
  allowCsvFallbackWithSpreadsheet: true,
  sheetNames: {
    categories: 'categories',
    sections: 'sections',
    contacts: 'contacts',
    // Mode recommande: un onglet items par categorie.
    itemsByCategory: {
      lumiere: 'items.lumiere',
      grip: 'items.grip',
      machinerie: 'items.machinerie',
      camera: 'items.camera',
      objectifs: 'items.objectifs',
      accessoires: 'items.accessoires',
    },
  },
  csvUrl: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQuhW7atN6UhXPpXlw-cciv5_koj5cwrToEWdq4IRcknQz4CdULyYePPLR1WuzQu-8ctkxYQLKYTLnt/pub?output=csv',
  timeoutMs: 6000,
};
