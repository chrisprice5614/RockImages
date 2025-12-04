// public/js/file-view.js
const overlay = document.getElementById("file-view-overlay");
const overlayCloseBtn = document.getElementById("file-view-close-btn");
const overlayImage = document.getElementById("file-view-image");
const overlayVideo = document.getElementById("file-view-video");
const overlayTitle = document.getElementById("file-view-title");
const overlayDate = document.getElementById("file-view-date");
const overlayLocation = document.getElementById("file-view-location");
const overlayGroups = document.getElementById("file-view-groups");
const overlayDownload = document.getElementById("file-view-download");
const overlayFilesGrid = document.getElementById("files-grid");

function openFileOverlayFromCard(card) {
  if (!overlay || !card) return;

  const isVideo = card.dataset.isVideo === "1";
  const originalUrl = card.dataset.originalUrl || "";
  const name = card.dataset.displayName || "";
  const date = card.dataset.shootDate || "";
  const location = card.dataset.location || "";

  overlayImage.style.display = "none";
  overlayVideo.style.display = "none";
  overlayVideo.pause();

  if (isVideo) {
    overlayVideo.src = originalUrl;
    overlayVideo.style.display = "block";
  } else {
    overlayImage.src = originalUrl || card.querySelector("img")?.src || "";
    overlayImage.alt = name;
    overlayImage.style.display = "block";
  }

  overlayTitle.textContent = name;

  overlayDate.textContent = date || "";
  overlayLocation.textContent = location || "";

  overlayGroups.innerHTML = "";
  const tagNodes = card.querySelectorAll(".ri-file-groups-row .ri-tag");
  tagNodes.forEach(tag => {
    const clone = tag.cloneNode(true);
    overlayGroups.appendChild(clone);
  });

  overlayDownload.href = originalUrl || "#";

  overlay.classList.add("active");
}

function closeFileOverlay() {
  if (!overlay) return;
  overlay.classList.remove("active");
  overlayVideo.pause();
}

overlayFilesGrid &&
  overlayFilesGrid.addEventListener("click", e => {
    const thumb = e.target.closest(".ri-file-thumb");
    if (!thumb) return;
    const card = thumb.closest(".ri-file-card");
    if (!card) return;
    e.preventDefault();
    openFileOverlayFromCard(card);
  });

overlayCloseBtn && overlayCloseBtn.addEventListener("click", closeFileOverlay);

overlay &&
  overlay.addEventListener("click", e => {
    if (e.target === overlay) {
      closeFileOverlay();
    }
  });
