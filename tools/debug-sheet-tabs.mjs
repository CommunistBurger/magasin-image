const spreadsheetId = '1fVxohe1kAALsfMX7mWuT4NgCuQJtCpHgKDLobhYGiEw';
for (const sheet of ['catalogue', 'catalogue.sheet', 'catalogue sheet', 'items', 'items.lumiere', 'items.grip', 'items.machinerie', 'items.camera', 'items.objectifs', 'items.accessoires', 'categories', 'sections', 'contacts']) {
  try {
    const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheet)}&cb=${Date.now()}`;
    const res = await fetch(url);
    const text = await res.text();
    console.log(`\n[SHEET ${sheet}] status=${res.status} len=${text.length}`);
    console.log(text.slice(0, 400));
  } catch (error) {
    console.error(`[SHEET ${sheet}]`, error.message);
  }
}
