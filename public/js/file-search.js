// public/js/file-search.js
const fileSearchInput = document.getElementById("file-search-input");
const filesGrid = document.getElementById("files-grid");
const groupFilterRow = document.getElementById("group-filter-row");
const orgLayoutSearch = document.querySelector(".ri-org-layout");
const orgId_files = orgLayoutSearch
  ? orgLayoutSearch.getAttribute("data-org-id")
  : null;
const searchGroupsContainer = document.getElementById("file-search-groups");
const filesPagination = document.getElementById("files-pagination");

let currentGroup = "all";
let currentPage = 1;
let totalPages = 1;
let totalFiles = 0;
let lastQuery = "";

// Fetch files + groups + pagination info
async function fetchFilesAndGroups(q, group, page) {
  if (!orgId_files)
    return {
      files: [],
      groups: [],
      canEdit: false,
      page: 1,
      totalPages: 1,
      total: 0
    };

  const url = new URL(
    `/api/organizations/${orgId_files}/files`,
    window.location.origin
  );
  if (q) url.searchParams.set("q", q);
  if (group && group !== "all") url.searchParams.set("group", group);
  if (page && page > 0) url.searchParams.set("page", String(page));
  url.searchParams.set("perPage", "60");

  const res = await fetch(url);
  const data = await res.json();
  return {
    files: data.files || [],
    groups: data.groups || [],
    canEdit: !!data.canEdit,
    page: data.page || 1,
    totalPages: data.totalPages || 1,
    total: data.total || (data.files ? data.files.length : 0)
  };
}

function renderSearchGroups(groups) {
  if (!searchGroupsContainer) return;
  searchGroupsContainer.innerHTML = "";
  if (!groups.length) return;
  const label = document.createElement("span");
  label.textContent = "Matching groups:";
  label.className = "ri-muted";
  searchGroupsContainer.appendChild(label);

  groups.forEach(g => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "ri-chip";
    chip.style.setProperty("--chip-color", g.color_hex);
    chip.textContent = g.name;
    chip.dataset.group = String(g.id);
    chip.addEventListener("click", async () => {
      currentGroup = String(g.id);
      if (groupFilterRow) {
        groupFilterRow
          .querySelectorAll(".ri-chip")
          .forEach(chip => chip.classList.remove("ri-chip-active"));
      }
      lastQuery = fileSearchInput ? fileSearchInput.value.trim() : "";
      currentPage = 1;
      const {
        files,
        groups: newGroups,
        canEdit,
        page,
        totalPages: tp,
        total
      } = await fetchFilesAndGroups(lastQuery, currentGroup, currentPage);
      currentPage = page;
      totalPages = tp;
      totalFiles = total;
      renderFiles(files, canEdit);
      renderSearchGroups(newGroups);
      renderPagination();
    });
    searchGroupsContainer.appendChild(chip);
  });
}

function renderFiles(files, canEdit) {
  filesGrid.innerHTML = "";
  if (!files.length) {
    filesGrid.innerHTML = `<p class="ri-muted">No files found.</p>`;
    return;
  }
  files.forEach(f => {
    const card = document.createElement("div");
    card.className = "ri-file-card";
    card.dataset.fileId = f.id;
    card.dataset.displayName = f.display_name || "";
    card.dataset.shootDate = f.shoot_date || "";
    card.dataset.location = f.location || "";
    card.dataset.originalUrl = f.original_url || "";
    card.dataset.isVideo = f.is_video ? "1" : "0";

    const groups = Array.isArray(f.groups) ? f.groups : [];

    const thumbHtml = f.is_video
      ? `
        <div class="ri-file-thumb">
          <video src="${f.original_url}" muted preload="metadata"></video>
          <span class="ri-badge video-badge">Video</span>
        </div>
      `
      : `
        <div class="ri-file-thumb">
          <img src="${f.thumb_url}" alt="${f.display_name}" />
        </div>
      `;

    const groupsHtml =
      groups.length > 0
        ? `
      <div class="ri-file-groups-row">
        ${groups
          .map(
            gr => `
          <span class="ri-tag" style="--tag-color:${gr.color_hex}">
            <span class="ri-tag-color-dot"></span>
            ${gr.name}
          </span>
        `
          )
          .join("")}
      </div>
    `
        : "";

    let metaText = f.shoot_date || "";
    if (f.location) {
      metaText = metaText ? metaText + " · " + f.location : f.location;
    }

    const actionsHtml = f.is_video
      ? `
        <a href="/files/${f.id}/view" target="_blank" class="ri-link-small">View</a>
        <a href="/files/${f.id}/download" class="ri-link-small">Download</a>
        ${
          canEdit
            ? `<button type="button" class="ri-link-small ri-btn-edit" data-file-id="${f.id}">Edit</button>
               <button type="button" class="ri-link-small ri-link-danger ri-btn-delete" data-file-id="${f.id}">Delete</button>`
            : ""
        }
      `
      : `
        <a href="/files/${f.id}/download" class="ri-link-small">Download</a>
        ${
          canEdit
            ? `<button type="button" class="ri-link-small ri-btn-edit" data-file-id="${f.id}">Edit</button>
               <button type="button" class="ri-link-small ri-link-danger ri-btn-delete" data-file-id="${f.id}">Delete</button>`
            : ""
        }
      `;

    card.innerHTML = `
      ${thumbHtml}
      ${groupsHtml}
      <div class="ri-file-body">
        <div class="ri-file-title">${f.display_name}</div>
        <div class="ri-file-meta-line">
          <span class="ri-file-meta">${metaText}</span>
        </div>
        <div class="ri-file-actions">
          ${actionsHtml}
        </div>
      </div>
    `;

    filesGrid.appendChild(card);
  });
}

// Render Prev/Next pagination under grid
function renderPagination() {
  if (!filesPagination) return;

  if (totalPages <= 1) {
    filesPagination.innerHTML = "";
    return;
  }

  const disablePrev = currentPage <= 1;
  const disableNext = currentPage >= totalPages;

  filesPagination.innerHTML = `
    <button class="ri-page-link${
      disablePrev ? " ri-page-link-disabled" : ""
    }" data-page-dir="prev" ${disablePrev ? "disabled" : ""}>
      &laquo; Prev
    </button>
    <span class="ri-page-status">
      Page ${currentPage} of ${totalPages} (${totalFiles} files)
    </span>
    <button class="ri-page-link${
      disableNext ? " ri-page-link-disabled" : ""
    }" data-page-dir="next" ${disableNext ? "disabled" : ""}>
      Next &raquo;
    </button>
  `;
}

let fileSearchTimer;
fileSearchInput &&
  fileSearchInput.addEventListener("input", () => {
    clearTimeout(fileSearchTimer);
    const q = fileSearchInput.value.trim();
    fileSearchTimer = setTimeout(async () => {
      lastQuery = q;
      currentPage = 1;
      const { files, groups, canEdit, page, totalPages: tp, total } =
        await fetchFilesAndGroups(q, currentGroup, currentPage);
      currentPage = page;
      totalPages = tp;
      totalFiles = total;
      renderFiles(files, canEdit);
      renderSearchGroups(groups);
      renderPagination();
    }, 200);
  });

groupFilterRow &&
  groupFilterRow.addEventListener("click", async e => {
    if (e.target.matches(".ri-chip")) {
      groupFilterRow.querySelectorAll(".ri-chip").forEach(chip => {
        chip.classList.remove("ri-chip-active");
      });
      e.target.classList.add("ri-chip-active");
      currentGroup = e.target.getAttribute("data-group") || "all";
      const q = fileSearchInput ? fileSearchInput.value.trim() : "";
      lastQuery = q;
      currentPage = 1;
      const { files, groups, canEdit, page, totalPages: tp, total } =
        await fetchFilesAndGroups(q, currentGroup, currentPage);
      currentPage = page;
      totalPages = tp;
      totalFiles = total;
      renderFiles(files, canEdit);
      renderSearchGroups(groups);
      renderPagination();
    }
  });

// Pagination click (NO URL CHANGE)
filesPagination &&
  filesPagination.addEventListener("click", async e => {
    const btn = e.target.closest("button[data-page-dir]");
    if (!btn || btn.disabled) return;
    const dir = btn.getAttribute("data-page-dir");

    if (dir === "prev" && currentPage > 1) {
      currentPage -= 1;
    } else if (dir === "next" && currentPage < totalPages) {
      currentPage += 1;
    } else {
      return;
    }

    const { files, groups, canEdit, page, totalPages: tp, total } =
      await fetchFilesAndGroups(lastQuery, currentGroup, currentPage);
    currentPage = page;
    totalPages = tp;
    totalFiles = total;
    renderFiles(files, canEdit);
    renderSearchGroups(groups);
    renderPagination();
  });

// Delete button (delegated) – unchanged
filesGrid &&
  filesGrid.addEventListener("click", async e => {
    if (e.target.matches(".ri-btn-delete")) {
      const id = e.target.getAttribute("data-file-id");
      if (!id) return;
      if (!confirm("Delete this file?")) return;
      const res = await fetch(`/files/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.ok) {
        const card = filesGrid.querySelector(`[data-file-id="${id}"]`);
        if (card) card.remove();
      }
    }
  });

/* 👇 NEW: INITIAL LOAD SO PAGINATION SHOWS RIGHT AWAY 👇 */
if (filesGrid) {
  (async () => {
    lastQuery = fileSearchInput ? fileSearchInput.value.trim() : "";
    const { files, groups, canEdit, page, totalPages: tp, total } =
      await fetchFilesAndGroups(lastQuery, currentGroup, currentPage);
    currentPage = page;
    totalPages = tp;
    totalFiles = total;
    renderFiles(files, canEdit);
    renderSearchGroups(groups);
    renderPagination();
  })();
}
