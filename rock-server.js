// app.js
const path = require("path");
const fs = require("fs");
const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const bcrypt = require("bcrypt");
const multer = require("multer");
const sharp = require("sharp");
require("dotenv").config();

const db = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

const fetch = require("node-fetch");

async function verifyCaptcha(token, remoteIp) {
  const secret = process.env.RECAPTCHA_SECRET; // Put your secret in .env
  const url = `https://www.google.com/recaptcha/api/siteverify`;

  const params = new URLSearchParams();
  params.append("secret", secret);
  params.append("response", token);
  if (remoteIp) params.append("remoteip", remoteIp);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params
  });

  const data = await res.json();
  return data.success === true;
}

// --------- Session & middleware ----------
app.use(
  session({
    store: new SQLiteStore({ db: "sessions.db", dir: "." }),
    secret: "rockimages-secret-change-me",
    resave: false,
    saveUninitialized: false
  })
);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use("/public", express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const uploadRoot = path.join(__dirname, "uploads");
const originalDir = path.join(uploadRoot, "original");
const thumbsDir = path.join(uploadRoot, "thumbs");

[uploadRoot, originalDir, thumbsDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Flash-like helper using session
app.use((req, res, next) => {
  res.locals.currentUser = null;
  if (req.session.userId) {
    const user = db
      .prepare("SELECT id, username, email FROM users WHERE id = ?")
      .get(req.session.userId);
    if (user) res.locals.currentUser = user;
  }
  res.locals.flash = req.session.flash || [];
  req.session.flash = [];
  res.flash = (type, message) => {
    req.session.flash.push({ type, message });
  };
  next();
});

// ---------- Auth helpers ----------
function requireLogin(req, res, next) {
  if (!req.session.userId) {
    return res.redirect("/login");
  }
  next();
}

function getOrgById(id) {
  return db.prepare("SELECT * FROM organizations WHERE id = ?").get(id);
}

function getOrgRole(orgId, userId) {
  return db
    .prepare("SELECT role FROM org_members WHERE org_id = ? AND user_id = ?")
    .get(orgId, userId);
}

function canEditOrg(orgId, userId) {
  const row = getOrgRole(orgId, userId);
  return row && (row.role === "owner" || row.role === "editor");
}

// ---------- Multer upload ----------
const uploadStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, "uploads", "original"));
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, unique + ext);
  }
});

const upload = multer({ storage: uploadStorage });

// ---------- Thumbnail helpers ----------
async function createImageThumb(originalPath, thumbPath) {
  await sharp(originalPath).resize(400).jpeg({ quality: 70 }).toFile(thumbPath);
}

function createVideoThumb(originalPath, thumbPath) {
  return new Promise((resolve, reject) => {
    const args = [
      "-ss",
      "00:00:01",
      "-i",
      originalPath,
      "-frames:v",
      "1",
      "-vf",
      "scale=400:-1",
      thumbPath
    ];
    const ff = spawn("ffmpeg", args);
    ff.on("exit", code => {
      if (code === 0) resolve();
      else reject(new Error("ffmpeg exited with code " + code));
    });
  });
}

// ---------- Routes ----------

// Home: org search
app.get("/", (req, res) => {
  res.render("home");
});

// Register
app.get("/register", (req, res) => {
  res.render("register");
});

app.post("/register", async (req, res) => {
   const { username, email, password } = req.body;
  const captchaToken = req.body["g-recaptcha-response"];

  // Check missing captcha
  if (!captchaToken) {
    return res.render("register", { error: "Please complete the CAPTCHA." });
  }

  // Verify with Google
  const captchaValid = await verifyCaptcha(
    captchaToken,
    req.headers["x-forwarded-for"] || req.socket.remoteAddress
  );

  if (!captchaValid) {
    return res.render("register", { error: "CAPTCHA failed. Please try again." });
  }

  if (!username || !email || !password) {
    res.flash("error", "All fields required.");
    return res.redirect("/register");
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const stmt = db.prepare(
      "INSERT INTO users (username, email, password_hash) VALUES (?,?,?)"
    );
    const info = stmt.run(username.trim(), email.trim(), hash);
    req.session.userId = info.lastInsertRowid;
    res.redirect("/dashboard");
  } catch (e) {
    res.flash("error", "Username or email already taken.");
    res.redirect("/register");
  }
});

// Login
app.get("/login", (req, res) => {
  res.render("login");
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const user = db
    .prepare("SELECT * FROM users WHERE username = ?")
    .get(username.trim());
  if (!user) {
    res.flash("error", "Invalid credentials.");
    return res.redirect("/login");
  }
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    res.flash("error", "Invalid credentials.");
    return res.redirect("/login");
  }
  req.session.userId = user.id;
  res.redirect("/dashboard");
});

// Logout
app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

// Dashboard
app.get("/dashboard", requireLogin, (req, res) => {
  const userId = req.session.userId;

  const myOrgs = db
    .prepare(
      `
      SELECT o.*, om.role
      FROM organizations o
      JOIN org_members om ON o.id = om.org_id
      WHERE om.user_id = ?
      ORDER BY o.created_at DESC
    `
    )
    .all(userId);

  const recentFiles = db
    .prepare(
      `
      SELECT f.*, o.name AS org_name
      FROM files f
      JOIN organizations o ON f.org_id = o.id
      WHERE f.uploader_id = ? AND f.is_deleted = 0
      ORDER BY f.created_at DESC
      LIMIT 12
    `
    )
    .all(userId);

  res.render("dashboard", { myOrgs, recentFiles });
});

// New org
app.get("/organizations/new", requireLogin, (req, res) => {
  res.render("org-new");
});

app.post("/organizations/new", requireLogin, (req, res) => {
  const userId = req.session.userId;
  const { name, description, visibility } = req.body;
  if (!name) {
    res.flash("error", "Name is required.");
    return res.redirect("/organizations/new");
  }
  const isPublic = visibility === "public" ? 1 : 0;
  const insertOrg = db.prepare(
    "INSERT INTO organizations (name, description, is_public, owner_id) VALUES (?,?,?,?)"
  );
  const info = insertOrg.run(name.trim(), description || "", isPublic, userId);

  const insertMember = db.prepare(
    "INSERT INTO org_members (org_id, user_id, role) VALUES (?,?,?)"
  );
  insertMember.run(info.lastInsertRowid, userId, "owner");

  res.redirect(`/organizations/${info.lastInsertRowid}`);
});

// Org show
// Org show
app.get("/organizations/:id", (req, res) => {
  const orgId = Number(req.params.id);
  const userId = req.session.userId || null;
  const org = getOrgById(orgId);
  if (!org) return res.status(404).send("Organization not found.");

  const membership = userId ? getOrgRole(orgId, userId) : null;

  // If org is private, require login + membership
  if (!membership && !org.is_public) {
    if (!userId) {
      // not logged in at all -> send to login
      return res.redirect("/login");
    }
    // logged in but not a member
    return res.status(403).send("You don't have access to this org.");
  }

  const perPage = 60;
  const rawPage = Number(req.query.page || 1);
  const page = !isNaN(rawPage) && rawPage > 0 ? rawPage : 1;

  // total files for pagination
  const totalRow = db
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM files
      WHERE org_id = ? AND is_deleted = 0
    `
    )
    .get(orgId);

  const totalFiles = totalRow ? totalRow.count : 0;
  const totalPages = totalFiles > 0 ? Math.ceil(totalFiles / perPage) : 1;
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const offset = (currentPage - 1) * perPage;

  const groups = db
    .prepare("SELECT * FROM groups WHERE org_id = ? ORDER BY name ASC")
    .all(orgId);

  const files = db
    .prepare(
      `
      SELECT f.*
      FROM files f
      WHERE f.org_id = ? AND f.is_deleted = 0
      ORDER BY f.created_at DESC
      LIMIT ? OFFSET ?
    `
    )
    .all(orgId, perPage, offset);

  // build map: fileId -> [groups...]
  let fileGroupsByFileId = {};
  if (files.length) {
    const fileIds = files.map(f => f.id);
    const placeholders = fileIds.map(() => "?").join(",");
    const fileGroupRows = db
      .prepare(
        `
        SELECT fg.file_id,
               g.id AS group_id,
               g.name,
               g.color_hex
        FROM file_groups fg
        JOIN groups g ON g.id = fg.group_id
        WHERE fg.file_id IN (${placeholders})
      `
      )
      .all(...fileIds);

    for (const row of fileGroupRows) {
      if (!fileGroupsByFileId[row.file_id]) {
        fileGroupsByFileId[row.file_id] = [];
      }
      fileGroupsByFileId[row.file_id].push({
        id: row.group_id,
        name: row.name,
        color_hex: row.color_hex
      });
    }
  }

  res.render("org-show", {
    org,
    groups,
    files,
    membership,
    fileGroupsByFileId,
    page: currentPage,
    totalPages,
    totalFiles,
    perPage
  });
});




// Create group
app.post("/organizations/:id/groups", requireLogin, (req, res) => {
  const orgId = Number(req.params.id);
  const userId = req.session.userId;
  if (!canEditOrg(orgId, userId)) {
    return res.status(403).send("No permission.");
  }
  const { name, color_hex } = req.body;
  if (!name || !color_hex) {
    res.flash("error", "Name and color required.");
    return res.redirect(`/organizations/${orgId}`);
  }
  db.prepare(
    "INSERT INTO groups (org_id, name, color_hex) VALUES (?,?,?)"
  ).run(orgId, name.trim(), color_hex.trim());
  res.redirect(`/organizations/${orgId}`);
});

// Invite/add member by username (simplified)
app.post("/organizations/:id/members", requireLogin, (req, res) => {
  const orgId = Number(req.params.id);
  const userId = req.session.userId;
  if (!canEditOrg(orgId, userId)) {
    return res.status(403).send("No permission.");
  }
  const { username, role } = req.body;
  const user = db
    .prepare("SELECT id FROM users WHERE username = ?")
    .get(username.trim());
  if (!user) {
    res.flash("error", "User not found.");
    return res.redirect(`/organizations/${orgId}`);
  }
  const r = ["owner", "editor", "viewer"].includes(role) ? role : "editor";
  try {
    db.prepare(
      "INSERT INTO org_members (org_id, user_id, role) VALUES (?,?,?)"
    ).run(orgId, user.id, r);
  } catch (e) {
    // already member
  }
  res.redirect(`/organizations/${orgId}`);
});

// Upload files (multi, started immediately via JS)
app.post(
  "/organizations/:id/files/upload",
  requireLogin,
  upload.array("files"),
  async (req, res) => {
    const orgId = Number(req.params.id);
    const userId = req.session.userId;

    if (!canEditOrg(orgId, userId)) {
      // Clean up temporary files if no permission
      (req.files || []).forEach(f => {
        fs.unlinkSync(f.path);
      });
      return res.status(403).json({ ok: false, error: "No permission." });
    }

    const files = req.files || [];
    const created = [];

    for (const file of files) {
      const isVideo = file.mimetype.startsWith("video/");
    let thumbPath;

    try {
    if (isVideo) {
        // Use a static placeholder for video thumbnails
        thumbPath = path.join("public", "img", "video-placeholder.png");
    } else {
        const thumbName =
        "thumb-" +
        path.basename(file.filename, path.extname(file.filename)) +
        ".jpg";
        thumbPath = path.join("uploads", "thumbs", thumbName);
        await createImageThumb(file.path, path.join(__dirname, thumbPath));
    }

    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    const stmt = db.prepare(
    `
    INSERT INTO files (
        org_id,
        uploader_id,
        original_name,
        display_name,
        mime_type,
        is_video,
        original_path,
        thumb_path,
        size_bytes,
        shoot_date,
        location_text
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `
    );
    const info = stmt.run(
    orgId,
    userId,
    file.originalname,
    file.originalname,
    file.mimetype,
    isVideo ? 1 : 0,
    path.join("uploads", "original", file.filename),
    thumbPath,
    file.size,
    today,
    ""
    );


    created.push({
        id: info.lastInsertRowid,
        display_name: file.originalname,
        thumb_url: "/" + thumbPath.replace(/\\/g, "/"),
        is_video: isVideo ? 1 : 0
    });
    } catch (err) {
    console.error("Thumb error", err);
    fs.unlinkSync(file.path);
    }

    }

    res.json({ ok: true, files: created });
  }
);

// Update file metadata (name + groups)
app.patch("/files/:id", requireLogin, (req, res) => {
  const fileId = Number(req.params.id);
  const userId = req.session.userId;

  const file = db
    .prepare("SELECT * FROM files WHERE id = ? AND is_deleted = 0")
    .get(fileId);
  if (!file) return res.status(404).json({ ok: false });

  if (!canEditOrg(file.org_id, userId)) {
    return res.status(403).json({ ok: false, error: "No permission" });
  }

  const body = req.body || {};
  const displayName =
    typeof body.display_name === "string" && body.display_name.trim()
      ? body.display_name.trim()
      : file.display_name;

  const shootDate =
    typeof body.shoot_date === "string" && body.shoot_date.trim()
      ? body.shoot_date.trim()
      : file.shoot_date || null;

  const locationText =
    typeof body.location === "string" ? body.location.trim() : file.location_text || "";

  db.prepare(
    `
    UPDATE files
    SET display_name = ?,
        shoot_date = ?,
        location_text = ?
    WHERE id = ?
  `
  ).run(displayName, shootDate, locationText, fileId);

  if (Array.isArray(body.groupIds)) {
    const groupIds = body.groupIds.map(id => Number(id)).filter(Boolean);
    db.prepare("DELETE FROM file_groups WHERE file_id = ?").run(fileId);
    const insertStmt = db.prepare(
      "INSERT INTO file_groups (file_id, group_id) VALUES (?, ?)"
    );
    const insertMany = db.transaction(ids => {
      for (const gid of ids) {
        insertStmt.run(fileId, gid);
      }
    });
    insertMany(groupIds);
  }

  return res.json({ ok: true });
});


// Delete file
// Delete file
app.delete("/files/:id", requireLogin, (req, res) => {
  const fileId = Number(req.params.id);
  const userId = req.session.userId;

  if (!fileId) {
    return res.status(400).json({ ok: false, error: "Invalid file id." });
  }

  const file = db
    .prepare("SELECT * FROM files WHERE id = ? AND is_deleted = 0")
    .get(fileId);

  if (!file) {
    return res.status(404).json({ ok: false, error: "File not found." });
  }

  // Permission check stays exactly like before
  if (!canEditOrg(file.org_id, userId)) {
    return res.status(403).json({ ok: false, error: "No permission." });
  }

  // Build absolute paths
  const originalPath = file.original_path
    ? path.join(__dirname, file.original_path)
    : null;
  const thumbPath = file.thumb_path
    ? path.join(__dirname, file.thumb_path)
    : null;

  const safeUnlink = fullPath => {
    if (!fullPath) return;
    try {
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
    } catch (err) {
      // If it's gone already, ignore; anything else log so you can see it in logs
      if (err.code !== "ENOENT") {
        console.error("Error deleting file on disk:", fullPath, err);
      }
    }
  };

  // Delete original file
  safeUnlink(originalPath);

  // Only delete thumbnail if it's not the shared placeholder in /public/img
  if (thumbPath && !file.thumb_path.startsWith("public")) {
    safeUnlink(thumbPath);
  }

  // Hard-delete the DB row so file_groups are removed via ON DELETE CASCADE
  db.prepare("DELETE FROM files WHERE id = ?").run(fileId);

  return res.json({ ok: true });
});


// Download original
app.get("/files/:id/download", (req, res) => {
  const fileId = Number(req.params.id);
  const file = db
    .prepare("SELECT * FROM files WHERE id = ? AND is_deleted = 0")
    .get(fileId);
  if (!file) return res.status(404).send("Not found");

  const org = getOrgById(file.org_id);
  const userId = req.session.userId || null;
  const membership = userId ? getOrgRole(file.org_id, userId) : null;
  if (!membership && !org.is_public) {
    return res.status(403).send("No access.");
  }

  res.download(file.original_path, file.original_name);
});


// ---- Live search APIs ----

// Search orgs
app.get("/api/orgs", (req, res) => {
  const q = String(req.query.q || "").trim();
  let rows;
  if (q) {
    rows = db
      .prepare(
        `
        SELECT o.*, u.username AS owner_name
        FROM organizations o
        JOIN users u ON o.owner_id = u.id
        WHERE (o.is_public = 1)
          AND (o.name LIKE ? OR IFNULL(o.description,'') LIKE ?)
        ORDER BY o.created_at DESC
        LIMIT 20
      `
      )
      .all(`%${q}%`, `%${q}%`);
  } else {
    rows = db
      .prepare(
        `
        SELECT o.*, u.username AS owner_name
        FROM organizations o
        JOIN users u ON o.owner_id = u.id
        WHERE o.is_public = 1
        ORDER BY o.created_at DESC
        LIMIT 20
      `
      )
      .all();
  }
  res.json({ orgs: rows });
});

// Search files within org
// Search files within org
app.get("/api/organizations/:id/files", (req, res) => {
  const orgId = Number(req.params.id);
  const q = String(req.query.q || "").trim();
  const groupId = req.query.group ? Number(req.query.group) : null;
  const userId = req.session.userId || null;

  const org = getOrgById(orgId);
  if (!org) {
    return res.status(404).json({
      ok: false,
      files: [],
      groups: [],
      canEdit: false,
      page: 1,
      totalPages: 1,
      total: 0
    });
  }

  const membership = userId ? getOrgRole(orgId, userId) : null;
  const canEdit =
    membership && (membership.role === "owner" || membership.role === "editor");

  // Private org: block non-members (whether logged in or not)
  if (!membership && !org.is_public) {
    return res.status(403).json({
      ok: false,
      files: [],
      groups: [],
      canEdit: false,
      page: 1,
      totalPages: 1,
      total: 0
    });
  }

  const perPageRaw = Number(req.query.perPage || 60);
  const perPage =
    !isNaN(perPageRaw) && perPageRaw > 0 ? Math.min(perPageRaw, 200) : 60;
  const pageRaw = Number(req.query.page || 1);
  let page = !isNaN(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  // ---------- WHERE + params ----------
  let whereSql = "WHERE f.org_id = ? AND f.is_deleted = 0";
  const params = [orgId];

  if (groupId) {
    whereSql +=
      " AND EXISTS (SELECT 1 FROM file_groups fg WHERE fg.file_id = f.id AND fg.group_id = ?)";
    params.push(groupId);
  }

  let like = null;
  if (q) {
    like = `%${q}%`;
    whereSql += `
      AND (
        f.display_name LIKE ?
        OR f.original_name LIKE ?
        OR EXISTS (
          SELECT 1
          FROM file_groups fg2
          JOIN groups g2 ON g2.id = fg2.group_id
          WHERE fg2.file_id = f.id
            AND g2.org_id = f.org_id
            AND g2.name LIKE ?
        )
      )
    `;
    params.push(like, like, like);
  }

  // ---------- total count ----------
  const countRow = db
    .prepare(`SELECT COUNT(*) AS count FROM files f ${whereSql}`)
    .get(...params);
  const total = countRow ? countRow.count : 0;
  const totalPages = total > 0 ? Math.ceil(total / perPage) : 1;

  if (page > totalPages) page = totalPages;
  if (page < 1) page = 1;
  const offset = (page - 1) * perPage;

  // ---------- page of files ----------
  const fileRows = db
    .prepare(
      `
      SELECT f.*
      FROM files f
      ${whereSql}
      ORDER BY f.created_at DESC
      LIMIT ? OFFSET ?
    `
    )
    .all(...params, perPage, offset);

  const fileIds = fileRows.map(f => f.id);
  const groupsByFileId = {};

  if (fileIds.length) {
    const placeholders = fileIds.map(() => "?").join(",");
    const fgRows = db
      .prepare(
        `
        SELECT fg.file_id,
               g.id AS group_id,
               g.name,
               g.color_hex
        FROM file_groups fg
        JOIN groups g ON g.id = fg.group_id
        WHERE fg.file_id IN (${placeholders})
      `
      )
      .all(...fileIds);

    for (const row of fgRows) {
      if (!groupsByFileId[row.file_id]) {
        groupsByFileId[row.file_id] = [];
      }
      groupsByFileId[row.file_id].push({
        id: row.group_id,
        name: row.name,
        color_hex: row.color_hex
      });
    }
  }

  // ---------- matching groups for the "Matching groups" row ----------
  let matchingGroups = [];
  if (q) {
    matchingGroups = db
      .prepare(
        `
        SELECT DISTINCT g.id, g.name, g.color_hex
        FROM groups g
        WHERE g.org_id = ? AND g.name LIKE ?
        ORDER BY g.name ASC
      `
      )
      .all(orgId, like);
  }

  res.json({
    ok: true,
    canEdit,
    page,
    totalPages,
    total,
    files: fileRows.map(f => ({
      id: f.id,
      display_name: f.display_name,
      thumb_url: "/" + f.thumb_path.replace(/\\/g, "/"),
      original_url: "/" + f.original_path.replace(/\\/g, "/"),
      is_video: !!f.is_video,
      shoot_date: f.shoot_date || "",
      location: f.location || "",
      groups: groupsByFileId[f.id] || []
    })),
    groups: matchingGroups
  });
});




app.get("/api/files/:id", (req, res) => {
  const fileId = Number(req.params.id);
  const file = db
    .prepare("SELECT * FROM files WHERE id = ? AND is_deleted = 0")
    .get(fileId);
  if (!file) return res.status(404).json({ ok: false });

  const org = getOrgById(file.org_id);
  const userId = req.session.userId || null;
  const membership = userId ? getOrgRole(file.org_id, userId) : null;
  if (!membership && !org.is_public) {
    return res.status(403).json({ ok: false });
  }

  const rows = db
    .prepare("SELECT group_id FROM file_groups WHERE file_id = ?")
    .all(fileId);
  const groupIds = rows.map(r => r.group_id);

  res.json({
  ok: true,
  file: {
    id: file.id,
    display_name: file.display_name,
    shoot_date: file.shoot_date,
    location_text: file.location_text
  },
  groupIds
});

});

app.post(
  "/files/:id/reupload",
  requireLogin,
  upload.single("file"),
  async (req, res) => {
    const fileId = Number(req.params.id);
    const userId = req.session.userId;
    const fileRow = db
      .prepare("SELECT * FROM files WHERE id = ? AND is_deleted = 0")
      .get(fileId);
    if (!fileRow) return res.status(404).json({ ok: false });

    if (!canEditOrg(fileRow.org_id, userId)) {
      if (req.file) {
        fs.unlink(req.file.path, () => {});
      }
      return res.status(403).json({ ok: false, error: "No permission." });
    }

    if (!req.file) {
      return res.status(400).json({ ok: false, error: "No file uploaded." });
    }

    const newFile = req.file;
    const isVideo = newFile.mimetype.startsWith("video/");

    // remove old files if you want
    // fs.unlink(fileRow.original_path, () => {});
    // fs.unlink(fileRow.thumb_path, () => {});

    let thumbPath;
    if (isVideo) {
      thumbPath = path.join("public", "img", "video-placeholder.png");
    } else {
      const thumbName =
        "thumb-" +
        path.basename(newFile.filename, path.extname(newFile.filename)) +
        ".jpg";
      thumbPath = path.join("uploads", "thumbs", thumbName);
      try {
        await createImageThumb(
          newFile.path,
          path.join(__dirname, thumbPath)
        );
      } catch (err) {
        console.error("Thumb error on reupload", err);
      }
    }

    db.prepare(
      `
      UPDATE files
      SET original_name = ?,
          mime_type = ?,
          is_video = ?,
          original_path = ?,
          thumb_path = ?,
          size_bytes = ?
      WHERE id = ?
    `
    ).run(
      newFile.originalname,
      newFile.mimetype,
      isVideo ? 1 : 0,
      path.join("uploads", "original", newFile.filename),
      thumbPath,
      newFile.size,
      fileId
    );

    res.json({ ok: true });
  }
);

app.get("/files/:id/view", (req, res) => {
  const fileId = Number(req.params.id);
  const file = db
    .prepare("SELECT * FROM files WHERE id = ? AND is_deleted = 0")
    .get(fileId);
  if (!file) return res.status(404).send("Not found");

  const org = getOrgById(file.org_id);
  const userId = req.session.userId || null;
  const membership = userId ? getOrgRole(file.org_id, userId) : null;
  if (!membership && !org.is_public) {
    return res.status(403).send("No access.");
  }

  if (!file.is_video) {
    return res.redirect(`/files/${fileId}/download`);
  }

  const originalUrl = "/" + file.original_path.replace(/\\/g, "/");

  // simple inline HTML response
  res.type("html").send(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>${file.display_name}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>
          body {
            margin: 0;
            background: #000;
            color: #fff;
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
          }
          .wrap {
            width: 100%;
            max-width: 960px;
            padding: 10px;
          }
          video {
            width: 100%;
            max-height: 80vh;
            background: #000;
          }
        </style>
      </head>
      <body>
        <div class="wrap">
          <video controls autoplay playsinline>
            <source src="${originalUrl}" type="${file.mime_type}" />
            Your browser cannot play this video.
          </video>
        </div>
      </body>
    </html>
  `);
});


app.listen(PORT, () => {
  console.log("RockImages running on http://localhost:" + PORT);
});


