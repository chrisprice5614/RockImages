// public/js/org-search.js
const input = document.getElementById("org-search-input");
const results = document.getElementById("org-search-results");

async function fetchOrgs(q) {
  const url = new URL("/api/orgs", window.location.origin);
  if (q) url.searchParams.set("q", q);
  const res = await fetch(url);
  const data = await res.json();
  return data.orgs || [];
}

function renderOrgs(orgs) {
  results.innerHTML = "";
  if (!orgs.length) {
    results.innerHTML = `<p class="ri-muted">No public organizations found.</p>`;
    return;
  }
  orgs.forEach(o => {
    const card = document.createElement("a");
    card.href = "/organizations/" + o.id;
    card.className = "ri-card ri-card-link";
    card.innerHTML = `
      <div class="ri-card-title">${o.name}</div>
      <div class="ri-card-sub">
        Owner: ${o.owner_name} · ${o.is_public ? "Public" : "Private"}
      </div>
      <p class="ri-card-desc">${o.description || ""}</p>
    `;
    results.appendChild(card);
  });
}

let orgSearchTimer;
input.addEventListener("input", () => {
  clearTimeout(orgSearchTimer);
  const q = input.value.trim();
  orgSearchTimer = setTimeout(async () => {
    const orgs = await fetchOrgs(q);
    renderOrgs(orgs);
  }, 200);
});

// initial load
fetchOrgs("").then(renderOrgs);
