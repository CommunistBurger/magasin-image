/**
 * Catalogue state driven by the Google Sheet sync layer.
 * The UI imports from this module so the local catalogue file is no longer required.
 */

export const CATS = {};
export const HOME_CARDS = [];

export function replaceCatalogueStructure(nextCats, nextHomeCards) {
  Object.keys(CATS).forEach(key => {
    delete CATS[key];
  });

  Object.entries(nextCats).forEach(([key, value]) => {
    CATS[key] = value;
  });

  HOME_CARDS.length = 0;
  nextHomeCards.forEach(card => HOME_CARDS.push(card));
}
