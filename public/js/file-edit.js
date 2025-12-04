// public/js/file-edit.js
const filesGridEdit = document.getElementById("files-grid");
const editBackdrop = document.getElementById("file-edit-modal-backdrop");
const editIdInput = document.getElementById("file-edit-id");
const editNameInput = document.getElementById("file-edit-name");
const editDateInput = document.getElementById("file-edit-date");
const editLocationInput = document.getElementById("file-edit-location");
const editGroupsContainer = document.getElementById("file-edit-groups");
const editFileInput = document.getElementById("file-edit-file");
const editCloseBtn = document.getElementById("file-edit-close-btn");
const editCancelBtn = document.getElementById("file-edit-cancel-btn");
const editSaveBtn = document.getElementById("file-edit-save-btn");

function openEditModal() {
  if (!editBackdrop) return;
  editBackdrop.classList.add("active");
}

function closeEditModal() {
  if (!editBackdrop) return;
  editBackdrop.classList.remove("active");
  editIdInput.value = "";
  editNameInput.value = "";
  editDateInput.value = "";
  editLocationInput.value = "";
  editFileInput.value = "";
  if (editGroupsContainer) {
    editGroupsContainer
      .querySelectorAll("input[type=checkbox]")
      .forEach(c => (c.checked = false));
  }
}

async function loadFileInfo(id) {
  const res = await fetch(`/api/files/${id}`);
  const data = await res.json();
  if (!data.ok) return;
  editIdInput.value = String(id);
  editNameInput.value = data.file.display_name || "";
  editDateInput.value = data.file.shoot_date || "";
  editLocationInput.value = data.file.location_text || "";
  if (editGroupsContainer) {
    const set = new Set((data.groupIds || []).map(String));
    editGroupsContainer
      .querySelectorAll("input[type=checkbox]")
      .forEach(c => {
        c.checked = set.has(c.value);
      });
  }
}

async function saveFileEdits() {
  const id = editIdInput.value;
  if (!id) return;

  const name = editNameInput.value.trim();
  const date = editDateInput.value;
  const location = editLocationInput.value.trim();
  const groupIds = [];
  if (editGroupsContainer) {
    editGroupsContainer
      .querySelectorAll("input[type=checkbox]")
      .forEach(c => {
        if (c.checked) groupIds.push(c.value);
      });
  }

  await fetch(`/files/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      display_name: name,
      groupIds,
      shoot_date: date,
      location
    })
  });

  const fileForReupload = editFileInput.files[0];
  if (fileForReupload) {
    const fd = new FormData();
    fd.append("file", fileForReupload);
    await fetch(`/files/${id}/reupload`, {
      method: "POST",
      body: fd
    });
    window.location.reload();
    return;
  } else {
    const card = filesGridEdit.querySelector(`[data-file-id="${id}"]`);
    if (card) {
      const titleEl = card.querySelector(".ri-file-title");
      const metaEl = card.querySelector(".ri-file-meta");
      if (titleEl) titleEl.textContent = name;
      if (metaEl) {
        let text = date || "";
        if (location) {
          text = text ? text + " · " + location : location;
        }
        metaEl.textContent = text;
      }
    }
  }

  closeEditModal();
}

filesGridEdit &&
  filesGridEdit.addEventListener("click", e => {
    const btn = e.target.closest(".ri-btn-edit");
    if (!btn) return;
    const id = btn.getAttribute("data-file-id");
    if (!id) return;
    loadFileInfo(id).then(() => {
      openEditModal();
    });
  });

editCloseBtn && editCloseBtn.addEventListener("click", closeEditModal);
editCancelBtn && editCancelBtn.addEventListener("click", closeEditModal);

editBackdrop &&
  editBackdrop.addEventListener("click", e => {
    if (e.target === editBackdrop) {
      closeEditModal();
    }
  });

editSaveBtn &&
  editSaveBtn.addEventListener("click", () => {
    saveFileEdits();
  });
