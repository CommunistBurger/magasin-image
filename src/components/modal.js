/**
 * components/modal.js
 * Gère l'ouverture et la fermeture de la modale de détail équipement.
 */

const overlay      = document.getElementById('modalOverlay');
const closeBtn     = document.getElementById('modal-close-btn');
const mediaWrap    = document.getElementById('mMedia');
const imgEl        = document.getElementById('mImg');
const prevBtn      = document.getElementById('mImgPrev');
const nextBtn      = document.getElementById('mImgNext');
const dotsEl       = document.getElementById('mImgDots');
const metaEl       = document.getElementById('mMeta');
let imageZoomed    = false;
let modalRuntimeCleanup = null;

function getItemModel(item) {
  return item?.model || item?.modele || item?.name || '';
}

function getItemBrand(item) {
  return item?.brand || item?.marque || '';
}

function getItemUsageName(item) {
  return item?.usageName || item?.usage_name || item?.nomUsage || item?.nom_d_usage || '';
}

function getItemDisplayName(item) {
  return getItemUsageName(item) || getItemModel(item) || 'Produit sans nom';
}

function resetImageZoom() {
  imageZoomed = false;
  if (!mediaWrap) return;
  mediaWrap.classList.remove('zoomed');
  if (imgEl) imgEl.style.transformOrigin = '50% 50%';
}

function toggleImageZoom(event) {
  if (!mediaWrap || !imgEl) return;

  if (!imageZoomed) {
    const rect = imgEl.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 100;
    const y = ((event.clientY - rect.top) / Math.max(rect.height, 1)) * 100;
    imgEl.style.transformOrigin = `${Math.max(0, Math.min(100, x))}% ${Math.max(0, Math.min(100, y))}%`;
    mediaWrap.classList.add('zoomed');
    imageZoomed = true;
    return;
  }

  resetImageZoom();
}

function panZoomedImage(event) {
  if (!imageZoomed || !imgEl) return;
  const rect = imgEl.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 100;
  const y = ((event.clientY - rect.top) / Math.max(rect.height, 1)) * 100;
  imgEl.style.transformOrigin = `${Math.max(0, Math.min(100, x))}% ${Math.max(0, Math.min(100, y))}%`;
}

function getItemImages(item) {
  const images = [];

  if (Array.isArray(item.imgs)) {
    item.imgs.forEach(src => {
      if (typeof src === 'string' && src.trim()) images.push(src.trim());
    });
  }

  if (typeof item.img === 'string' && item.img.trim()) {
    images.push(item.img.trim());
  }

  return [...new Set(images)];
}

function getListItemKey(item, meta = {}) {
  const values = [
    meta.categoryTitle || item?.categoryTitle || '',
    meta.categoryKey || item?.categoryKey || '',
    meta.sectionLabel || item?.sectionLabel || '',
    item?.brand || item?.marque || '',
    item?.model || item?.modele || item?.name || '',
    item?.usageName || item?.usage_name || item?.nomUsage || item?.nom_d_usage || '',
  ].filter(Boolean);

  return values.join('|').trim();
}

/** Ouvre la modale avec les données d'un équipement */
export function openModal(item, meta = {}) {
  if (typeof modalRuntimeCleanup === 'function') {
    modalRuntimeCleanup();
    modalRuntimeCleanup = null;
  }

  const displayName = getItemDisplayName(item);
  const brand = getItemBrand(item);
  const model = getItemModel(item);
  const modalAddBtn = document.getElementById('modal-add-btn');
  const modalListKey = getListItemKey(item, meta);
  const metaParts = [];

  if (brand) metaParts.push(`<span class="modal-meta-pill">${brand}</span>`);
  if (model && model !== displayName) metaParts.push(`<span class="modal-meta-pill modal-meta-pill-muted">${model}</span>`);

  document.getElementById('mName').textContent = displayName;
  if (metaEl) {
    metaEl.innerHTML = metaParts.length ? metaParts.join('') : '';
    metaEl.style.display = metaParts.length ? 'flex' : 'none';
  }
  document.getElementById('mDesc').textContent = item.desc;
  document.getElementById('mPeda').textContent = item.peda;

  // Specs
  const specs = Array.isArray(item.specs) ? item.specs : [];
  document.getElementById('mSpecs').innerHTML = specs
    .map(s => Object.entries(s)
      .map(([k, v]) => `
        <div class="spec-row">
          <div class="spec-label">${k}</div>
          <div class="spec-val">${v}</div>
        </div>`)
      .join(''))
    .join('');

  // Images optionnelles (carousel)
  const images = getItemImages(item);
  let currentImageIndex = 0;
  let touchStartX = 0;
  let touchStartY = 0;
  let slideDirection = 'next';
  let hasRenderedImage = false;

  function preloadImage(src) {
    return new Promise(resolve => {
      const nextImg = new Image();
      nextImg.decoding = 'async';
      nextImg.onload = () => resolve(src);
      nextImg.onerror = () => resolve(src);
      nextImg.src = src;
    });
  }

  async function renderModalImage() {
    if (!images.length || !imgEl || !dotsEl) return;

    resetImageZoom();

    const nextSrc = images[currentImageIndex];
    const shouldAnimate = hasRenderedImage && imgEl.src && imgEl.src !== nextSrc;

    imgEl.classList.remove('slide-next', 'slide-prev');
    imgEl.style.opacity = '0.2';
    imgEl.style.transition = 'opacity .12s ease';

    await preloadImage(nextSrc);

    imgEl.src = nextSrc;
    imgEl.style.opacity = '1';

    if (shouldAnimate) {
      imgEl.classList.add(slideDirection === 'prev' ? 'slide-prev' : 'slide-next');
    }
    hasRenderedImage = true;

    dotsEl.innerHTML = images
      .map((_, i) => `<button type="button" class="modal-media-dot ${i === currentImageIndex ? 'active' : ''}" data-dot-index="${i}" aria-label="Aller a l'image ${i + 1}"></button>`)
      .join('');
  }

  function goToImage(nextIndex, direction) {
    if (!images.length || images.length < 2) return;
    if (nextIndex === currentImageIndex) return;
    slideDirection = direction === 'prev' ? 'prev' : 'next';
    currentImageIndex = (nextIndex + images.length) % images.length;
    renderModalImage();
  }

  function showPrevImage() {
    goToImage(currentImageIndex - 1, 'prev');
  }

  function showNextImage() {
    goToImage(currentImageIndex + 1, 'next');
  }

  function onModalKeydown(event) {
    if (!overlay.classList.contains('open')) return;
    if (!images.length || images.length < 2) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      showPrevImage();
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      showNextImage();
    }
  }

  function onTouchStart(event) {
    if (!event.touches?.length || imageZoomed) return;
    touchStartX = event.touches[0].clientX;
    touchStartY = event.touches[0].clientY;
  }

  function onTouchEnd(event) {
    if (!event.changedTouches?.length || imageZoomed) return;
    const endX = event.changedTouches[0].clientX;
    const endY = event.changedTouches[0].clientY;
    const dx = endX - touchStartX;
    const dy = endY - touchStartY;

    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
    if (dx > 0) {
      showPrevImage();
    } else {
      showNextImage();
    }
  }

  if (images.length) {
    mediaWrap.style.display = 'block';
    prevBtn.style.display = images.length > 1 ? 'flex' : 'none';
    nextBtn.style.display = images.length > 1 ? 'flex' : 'none';
    dotsEl.style.display = images.length > 1 ? 'flex' : 'none';
    renderModalImage();
    imgEl.onclick = toggleImageZoom;
    imgEl.onmousemove = panZoomedImage;
    imgEl.ondragstart = event => event.preventDefault();

    if (images.length > 1) {
      document.addEventListener('keydown', onModalKeydown);
      mediaWrap.addEventListener('touchstart', onTouchStart, { passive: true });
      mediaWrap.addEventListener('touchend', onTouchEnd, { passive: true });
    }

    prevBtn.onclick = event => {
      event.stopPropagation();
      showPrevImage();
    };

    nextBtn.onclick = event => {
      event.stopPropagation();
      showNextImage();
    };

    dotsEl.onclick = event => {
      const dot = event.target.closest('[data-dot-index]');
      if (!dot) return;
      event.stopPropagation();
      const targetIndex = Number(dot.dataset.dotIndex);
      goToImage(targetIndex, targetIndex < currentImageIndex ? 'prev' : 'next');
    };

    modalRuntimeCleanup = () => {
      document.removeEventListener('keydown', onModalKeydown);
      mediaWrap.removeEventListener('touchstart', onTouchStart);
      mediaWrap.removeEventListener('touchend', onTouchEnd);
      imgEl.ondragstart = null;
    };
  } else {
    resetImageZoom();
    mediaWrap.style.display = 'none';
    imgEl.onclick = null;
    imgEl.onmousemove = null;
    imgEl.ondragstart = null;
    prevBtn.onclick = null;
    nextBtn.onclick = null;
    dotsEl.onclick = null;
    modalRuntimeCleanup = null;
  }

  // Liens optionnels
  const linksTitleEl = document.getElementById('mLinksTitle');
  const linksEl = document.getElementById('mLinks');

  const lienManuel = typeof item.manuel === 'string' ? item.manuel.trim() : '';
  const liensCustom = [
    {
      label: typeof item.lienLabel === 'string' ? item.lienLabel.trim() : '',
      url: typeof item.lienUrl === 'string' ? item.lienUrl.trim() : '',
    },
    {
      label: typeof item.lienLabel2 === 'string' ? item.lienLabel2.trim() : '',
      url: typeof item.lienUrl2 === 'string' ? item.lienUrl2.trim() : '',
    },
    {
      label: typeof item.lienLabel3 === 'string' ? item.lienLabel3.trim() : '',
      url: typeof item.lienUrl3 === 'string' ? item.lienUrl3.trim() : '',
    },
  ];

  const boutonsLiens = [];

  if (lienManuel) {
    boutonsLiens.push(`
      <a class="modal-link-btn" href="${lienManuel}" target="_blank" rel="noopener" onclick="event.stopPropagation()">
        Ouvrir le manuel
      </a>`);
  }

  liensCustom.forEach(lien => {
    if (!lien.url || !lien.label) return;
    boutonsLiens.push(`
      <a class="modal-link-btn" href="${lien.url}" target="_blank" rel="noopener" onclick="event.stopPropagation()">
        ${lien.label}
      </a>`);
  });

  linksEl.innerHTML = boutonsLiens.join('');
  const hasLinks = boutonsLiens.length > 0;
  linksTitleEl.style.display = hasLinks ? 'block' : 'none';
  linksEl.style.display = hasLinks ? 'flex' : 'none';

  if (modalAddBtn) {
    const isAdded = JSON.parse(localStorage.getItem('magasin-image-list-v1') || '[]').some(entry => entry.id === modalListKey);
    modalAddBtn.dataset.listKey = modalListKey;
    modalAddBtn.classList.toggle('added', isAdded);
    modalAddBtn.textContent = isAdded ? '✓' : '+';
    modalAddBtn.setAttribute('aria-label', isAdded ? 'Retirer de la liste' : 'Ajouter à la liste');
    modalAddBtn.onclick = event => {
      event.stopPropagation();
      window.magasinImageListAdd?.(item, meta);
      const entries = JSON.parse(localStorage.getItem('magasin-image-list-v1') || '[]');
      const added = entries.some(entry => entry.id === modalListKey);
      modalAddBtn.classList.toggle('added', added);
      modalAddBtn.textContent = added ? '✓' : '+';
      modalAddBtn.setAttribute('aria-label', added ? 'Retirer de la liste' : 'Ajouter à la liste');
      window.magasinImageListUpdateButtons?.();
    };
  }

  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

/** Ferme la modale */
export function closeModal() {
  if (typeof modalRuntimeCleanup === 'function') {
    modalRuntimeCleanup();
    modalRuntimeCleanup = null;
  }
  resetImageZoom();
  overlay.classList.remove('open');
  document.body.style.overflow = '';
}

/** Initialise les écouteurs d'événements de la modale */
export function initModal() {
  // Clic sur le fond
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeModal();
  });

  // Bouton ✕
  closeBtn.addEventListener('click', closeModal);

  // Touche Échap
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });
}
