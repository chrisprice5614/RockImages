// public/js/uploader.js
const fileInput = document.getElementById("file-input");
const dropZone = document.getElementById("upload-drop");
const queueContainer = document.getElementById("upload-queue");
const finishBtn = document.getElementById("upload-finish-btn");
const orgLayoutUpload = document.querySelector(".ri-org-layout");
const orgId_upload = orgLayoutUpload
  ? Number(orgLayoutUpload.getAttribute("data-org-id"))
  : null;

// map client side temp ID -> { fileId, display_name }
const uploadState = new Map();
let tempCounter = 1;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function createQueueItem(file) {
  const tempId = "temp-" + tempCounter++;
  const item = document.createElement("div");
  item.className = "ri-upload-item";
  item.dataset.tempId = tempId;

  item.innerHTML = `
    <div class="ri-upload-file-main">
      <div class="ri-upload-file-name">${file.name}</div>
      <div class="ri-upload-progress-bar">
        <div class="ri-upload-progress-fill"></div>
      </div>
      <div class="ri-upload-status"></div>
    </div>
    <div class="ri-upload-meta">
      <label>
        Name
        <input type="text" class="ri-input ri-input-sm ri-input-name" value="${file.name}" />
      </label>
      <div style="margin-top:6px;">
        <label>
          Date
          <input type="date" class="ri-input ri-input-sm ri-input-date" value="${todayIso()}" />
        </label>
      </div>
      <div style="margin-top:6px;">
        <label>
          Location
          <input type="text" class="ri-input ri-input-sm ri-input-location" placeholder="Location" />
        </label>
      </div>
      <div class="ri-upload-groups">
        <span class="ri-upload-groups-label">Groups:</span>
        <div class="ri-upload-groups-chips">
          ${Array.from(document.querySelectorAll(".ri-tag[data-group-id]"))
            .map(tag => {
              const gid = tag.getAttribute("data-group-id");
              const label = tag.textContent.trim();
              return `<label class="ri-group-chip">
                <input type="checkbox" value="${gid}" />
                <span>${label}</span>
              </label>`;
            })
            .join("")}
        </div>
      </div>
    </div>
  `;

  queueContainer.appendChild(item);
  return item;
}

async function uploadFile(file, tempId) {
  if (!orgId_upload) return;

  const item = queueContainer.querySelector(`[data-temp-id="${tempId}"]`);
  const progressFill = item.querySelector(".ri-upload-progress-fill");
  const statusEl = item.querySelector(".ri-upload-status");

  const formData = new FormData();
  formData.append("files", file);

  const xhr = new XMLHttpRequest();
  xhr.open("POST", `/organizations/${orgId_upload}/files/upload`, true);

  xhr.upload.addEventListener("progress", e => {
    if (e.lengthComputable) {
      const pct = (e.loaded / e.total) * 100;
      progressFill.style.width = pct.toFixed(0) + "%";
    }
  });

  xhr.onreadystatechange = async () => {
    if (xhr.readyState === 4) {
      if (xhr.status === 200) {
        progressFill.style.width = "100%";
        const data = JSON.parse(xhr.responseText);
        const created = data.files && data.files[0];
        if (created) {
          uploadState.set(tempId, {
            fileId: created.id,
            display_name: created.display_name
          });
          await pushMetadata(tempId);
          statusEl.textContent = "✔ Uploaded";
        }
      } else {
        progressFill.classList.add("ri-upload-error");
        statusEl.textContent = "Upload failed";
        statusEl.style.color = "#b91c1c";
      }
    }
  };

  xhr.send(formData);
}

async function pushMetadata(tempId) {
  const state = uploadState.get(tempId);
  if (!state || !state.fileId) return;

  const item = queueContainer.querySelector(`[data-temp-id="${tempId}"]`);
  if (!item) return;

  const nameInput = item.querySelector(".ri-input-name");
  const dateInput = item.querySelector(".ri-input-date");
  const locationInput = item.querySelector(".ri-input-location");
  const checks = item.querySelectorAll(".ri-group-chip input[type=checkbox]");
  const groupIds = [];
  checks.forEach(c => {
    if (c.checked) groupIds.push(c.value);
  });

  const body = {
    display_name: nameInput.value.trim() || state.display_name,
    groupIds,
    shoot_date: dateInput.value || null,
    location: locationInput.value.trim()
  };

  await fetch(`/files/${state.fileId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

function handleFiles(files) {
  Array.from(files).forEach(file => {
    const item = createQueueItem(file);
    const tempId = item.dataset.tempId;
    uploadFile(file, tempId);

    const nameInput = item.querySelector(".ri-input-name");
    const dateInput = item.querySelector(".ri-input-date");
    const locationInput = item.querySelector(".ri-input-location");
    const checks = item.querySelectorAll(".ri-group-chip input[type=checkbox]");

    function maybePush() {
      if (uploadState.get(tempId)?.fileId) {
        pushMetadata(tempId);
      }
    }

    nameInput.addEventListener("change", maybePush);
    dateInput.addEventListener("change", maybePush);
    locationInput.addEventListener("change", maybePush);
    checks.forEach(c => c.addEventListener("change", maybePush));
  });
}

fileInput &&
  fileInput.addEventListener("change", e => {
    if (e.target.files && e.target.files.length) {
      handleFiles(e.target.files);
      fileInput.value = "";
    }
  });

if (dropZone) {
  dropZone.addEventListener("click", () => fileInput && fileInput.click());
  dropZone.addEventListener("dragover", e => {
    e.preventDefault();
    dropZone.classList.add("ri-upload-drop-active");
  });
  dropZone.addEventListener("dragleave", e => {
    e.preventDefault();
    dropZone.classList.remove("ri-upload-drop-active");
  });
  dropZone.addEventListener("drop", e => {
    e.preventDefault();
    dropZone.classList.remove("ri-upload-drop-active");
    if (e.dataTransfer.files && e.dataTransfer.files.length) {
      handleFiles(e.dataTransfer.files);
    }
  });
}

finishBtn &&
  finishBtn.addEventListener("click", () => {
    window.location.reload();
  });
