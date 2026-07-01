// ═══════════════════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════════════════
const GAPI_CLIENT_ID =
  "214566412544-vn4darjbmf81nqi9o3u3ec2f92bm6hmn.apps.googleusercontent.com";
const DRIVE_FILE_NAME = "chi-tieu-data.json";

// ═══════════════════════════════════════════════════════════
//  CATEGORIES
// ═══════════════════════════════════════════════════════════
const CATEGORIES = [
  { key: "🍜 Ăn uống",   emoji: "🍜", label: "Ăn uống",   color: "#F85149" },
  { key: "🛵 Di chuyển", emoji: "🛵", label: "Di chuyển", color: "#D29922" },
  { key: "🛍️ Mua sắm",  emoji: "🛍️", label: "Mua sắm",  color: "#BC8CFF" },
  { key: "💡 Hóa đơn",  emoji: "💡", label: "Hóa đơn",  color: "#58A6FF" },
  { key: "💊 Sức khỏe", emoji: "💊", label: "Sức khỏe", color: "#3FB950" },
  { key: "📦 Khác",     emoji: "📦", label: "Khác",     color: "#8B949E" },
];

const INCOME_CATEGORIES = [
  { key: "💼 Lương",     emoji: "💼", label: "Lương",     color: "#3FB950" },
  { key: "💰 Thưởng",   emoji: "💰", label: "Thưởng",   color: "#D29922" },
  { key: "📈 Đầu tư",   emoji: "📈", label: "Đầu tư",   color: "#58A6FF" },
  { key: "🎁 Quà tặng", emoji: "🎁", label: "Quà tặng", color: "#BC8CFF" },
  { key: "💵 Khác",     emoji: "💵", label: "Khác",     color: "#8B949E" },
];

const catColor = (k, list = CATEGORIES) => (list.find(c => c.key === k) || {}).color || "#8B949E";
const catEmoji = (k, list = CATEGORIES) => (list.find(c => c.key === k) || {}).emoji || "📦";

// ═══════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════
let expenses     = JSON.parse(localStorage.getItem("expenses") || "[]");
let incomes      = JSON.parse(localStorage.getItem("incomes")  || "[]");
let activeFilter = "All";
let accessToken  = null;
let driveFileId  = null;
let fabOpen      = false;
let _editingId   = null;  // id đang sửa, null = đang thêm mới
let selectedMonth = null; // tháng đang xem trong trang Thống kê ("YYYY-MM"), gán ở INIT
let selectedYear  = null; // năm đang xem trong khối tổng hợp theo năm, gán ở INIT

// ═══════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════
window.addEventListener("load", () => {
  selectedMonth = thisMonthStr();
  selectedYear  = new Date().getFullYear();
  buildCatGrid("catGrid", CATEGORIES, "selectExpCat");
  buildCatGrid("incomeCatGrid", INCOME_CATEGORIES, "selectIncCat");
  setTodayDate("inputDate");
  setTodayDate("inputIncomeDate");
  renderAll();
  setupAmountSuggestions("inputAmount", "suggestions");
  setupAmountSuggestions("inputIncomeAmount", "incomeSuggestions");
  initTokenClient(); // Khởi tạo sớm nếu SDK đã load kịp
});

// ═══════════════════════════════════════════════════════════
//  FORMAT
// ═══════════════════════════════════════════════════════════
function fmt(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M₫";
  if (n >= 1_000)     return Math.round(n / 1_000) + "K₫";
  return n.toLocaleString("vi-VN") + "₫";
}

function fmtExact(n) {
  return n.toLocaleString("vi-VN") + "₫";
}

function fmtSuggest(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1) + "M₫";
  if (n >= 1_000)     return (n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1) + "K₫";
  return n.toLocaleString("vi-VN") + "₫";
}

const todayStr     = () => new Date().toISOString().split("T")[0];
const thisMonthStr = () => todayStr().slice(0, 7);

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ═══════════════════════════════════════════════════════════
//  SMART VND SUGGESTIONS
// ═══════════════════════════════════════════════════════════
function setupAmountSuggestions(inputId, suggestionsId) {
  const input = document.getElementById(inputId);
  const box   = document.getElementById(suggestionsId);
  if (!input || !box) return;

  input.addEventListener("input", () => {
    const raw = input.value.replace(/[^0-9]/g, "");
    box.innerHTML = "";
    if (!raw || raw === "0") return;

    const num = parseInt(raw, 10);
    const multipliers = [1_000, 10_000, 100_000, 1_000_000];
    const seen = new Set();
    const chips = [];

    for (const m of multipliers) {
      const val = num * m;
      if (val <= num) continue;
      if (val > 500_000_000) continue;
      const key = String(val);
      if (seen.has(key)) continue;
      seen.add(key);
      chips.push(val);
      if (chips.length >= 4) break;
    }

    chips.forEach(val => {
      const btn = document.createElement("button");
      btn.className = "suggestion-chip";
      btn.type = "button";
      btn.textContent = fmtSuggest(val);
      btn.addEventListener("click", () => {
        input.value = String(val);
        box.innerHTML = "";
        input.focus();
      });
      box.appendChild(btn);
    });
  });
}

// ═══════════════════════════════════════════════════════════
//  GOOGLE OAUTH
// ═══════════════════════════════════════════════════════════
let _tokenClient = null;
let _sdkReady = false;

// Gọi sớm từ onload để khởi tạo client trước khi user nhấn nút
function initTokenClient() {
  if (!GAPI_CLIENT_ID || GAPI_CLIENT_ID === "YOUR_GOOGLE_CLIENT_ID_HERE") return;
  if (!window.google || !window.google.accounts) return;
  if (_tokenClient) return;
  _tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GAPI_CLIENT_ID,
    scope: "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.appdata",
    callback: (res) => {
      if (res.error) {
        setSyncState("error", "Lỗi");
        showToast("Đăng nhập thất bại: " + res.error, "error");
        return;
      }
      accessToken = res.access_token;
      setTimeout(() => { accessToken = null; }, 3500 * 1000);
      setSyncState("syncing", "Đang tải…");
      syncFromDrive();
    },
  });
  _sdkReady = true;
}

// SDK có thể load sau window.load, dùng callback này để khởi tạo
window.onGoogleLibraryLoad = function () {
  initTokenClient();
};

function initOAuthFlow() {
  // Thử khởi tạo lại nếu chưa có (phòng trường hợp SDK load trễ)
  if (!_tokenClient) initTokenClient();

  if (!_tokenClient) {
    showToast("Không tải được Google SDK. Kiểm tra kết nối mạng.", "error");
    return;
  }
  // requestAccessToken phải được gọi trực tiếp trong user gesture (quan trọng với iOS Safari)
  closeSheets();
  _tokenClient.requestAccessToken();
}

function startLogin() { initOAuthFlow(); }

// ═══════════════════════════════════════════════════════════
//  GOOGLE DRIVE — SYNC với soft-delete
// ═══════════════════════════════════════════════════════════
async function driveRequest(method, url) {
  const res = await fetch(url, { method, headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(res.status);
  return res.json();
}

async function driveUpload(content) {
  const jsonStr = JSON.stringify(content);
  if (driveFileId) {
    const res = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${driveFileId}?uploadType=media`,
      { method: "PATCH", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: jsonStr }
    );
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }
  const metaRes = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: DRIVE_FILE_NAME, parents: ["appDataFolder"] }),
  });
  if (!metaRes.ok) throw new Error(await metaRes.text());
  const meta = await metaRes.json();
  driveFileId = meta.id;
  const contentRes = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${driveFileId}?uploadType=media`,
    { method: "PATCH", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: jsonStr }
  );
  if (!contentRes.ok) throw new Error(await contentRes.text());
  return contentRes.json();
}

// Merge theo last-write-wins từng record, giữ deletedAt để xóa lan truyền
function mergeRecords(remote, local) {
  const map = new Map();
  // Ưu tiên remote trước, rồi local override nếu updatedAt mới hơn
  [...remote, ...local].forEach(item => {
    const existing = map.get(item.id);
    if (!existing || (item.updatedAt || 0) >= (existing.updatedAt || 0)) {
      map.set(item.id, item);
    }
  });
  return Array.from(map.values()).sort((a, b) => b.id - a.id);
}

async function syncFromDrive() {
  try {
    const list = await driveRequest(
      "GET",
      `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name%3D'${DRIVE_FILE_NAME}'&fields=files(id)`
    );
    if (list.files && list.files.length > 0) {
      driveFileId = list.files[0].id;
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();

      if (Array.isArray(data.expenses)) {
        expenses = mergeRecords(data.expenses, expenses);
      }
      if (Array.isArray(data.incomes)) {
        incomes = mergeRecords(data.incomes, incomes);
      }
      saveLocal();
      renderAll();
      await driveUpload({ expenses, incomes });
    } else {
      await driveUpload({ expenses, incomes });
    }
    setSyncState("synced", "Đã lưu");
    showToast("☁️ Đã đồng bộ", "success");
  } catch (e) {
    console.error("syncFromDrive error:", e);
    setSyncState("error", "Lỗi");
    showToast("Lỗi đồng bộ: " + e.message, "error");
  }
}

async function syncToDrive() {
  if (!accessToken) { initOAuthFlow(); return; }
  setSyncState("syncing", "Đang lưu…");
  try {
    await driveUpload({ expenses, incomes });
    setSyncState("synced", "Đã lưu");
  } catch (e) {
    console.error("syncToDrive error:", e);
    setSyncState("error", "Lỗi");
    showToast("Không thể lưu: " + e.message, "error");
  }
}

function setSyncState(state, label) {
  const btn  = document.getElementById("syncBtn");
  const icon = document.getElementById("syncIcon");
  const lbl  = document.getElementById("syncLabel");
  if (!btn || !icon || !lbl) return;
  btn.className = `sync-btn ${state}`;
  lbl.textContent = label;
  icon.textContent = { synced: "✅", syncing: "🔄", error: "❌" }[state] || "☁️";
}

function handleSyncClick() {
  if (accessToken) { setSyncState("syncing", "Đang tải…"); syncFromDrive(); }
  else openAuthSheet();
}

function saveLocal() {
  localStorage.setItem("expenses", JSON.stringify(expenses));
  localStorage.setItem("incomes",  JSON.stringify(incomes));
}

// ═══════════════════════════════════════════════════════════
//  CRUD — EXPENSES
// ═══════════════════════════════════════════════════════════
function addExpense() {
  const raw      = document.getElementById("inputAmount").value.replace(/[^0-9]/g, "");
  const amount   = parseInt(raw, 10);
  const note     = document.getElementById("inputNote").value.trim() || "Chi tiêu";
  const date     = document.getElementById("inputDate").value;
  const selBtn   = document.querySelector("#catGrid .cat-btn.selected");
  const category = selBtn ? selBtn.dataset.cat : "📦 Khác";

  if (!amount || amount <= 0) { showToast("Nhập số tiền hợp lệ", "error"); return; }
  if (!date)                  { showToast("Chọn ngày", "error"); return; }

  if (_editingId !== null) {
    const idx = expenses.findIndex(e => e.id === _editingId);
    if (idx !== -1) {
      expenses[idx] = { ...expenses[idx], amount, note, date, category, updatedAt: Date.now() };
    }
    _editingId = null;
    document.getElementById("addSheetTitle").textContent = "💸 Thêm chi tiêu";
    document.getElementById("addSubmitBtn").textContent  = "Thêm chi tiêu";
  } else {
    expenses.unshift({ id: Date.now(), amount, note, date, category, updatedAt: Date.now() });
  }

  saveLocal();
  closeSheets();
  renderAll();
  showToast(_editingId !== null ? "✅ Đã cập nhật" : "✅ Đã thêm chi tiêu", "success");
  if (accessToken) syncToDrive();

  document.getElementById("inputAmount").value = "";
  document.getElementById("suggestions").innerHTML = "";
  document.getElementById("inputNote").value = "";
  setTodayDate("inputDate");
  buildCatGrid("catGrid", CATEGORIES, "selectExpCat");
}

function deleteExpense(id) {
  showConfirm("Xóa khoản chi tiêu này?", () => {
    const idx = expenses.findIndex(e => e.id === id);
    if (idx !== -1) {
      expenses[idx] = { ...expenses[idx], deletedAt: Date.now(), updatedAt: Date.now() };
    }
    saveLocal();
    renderAll();
    if (accessToken) syncToDrive();
    showToast("🗑️ Đã xóa", "success");
  });
}

function editExpense(id) {
  const item = expenses.find(e => e.id === id);
  if (!item) return;
  _editingId = id;
  document.getElementById("inputAmount").value = String(item.amount);
  document.getElementById("inputNote").value   = item.note;
  document.getElementById("inputDate").value   = item.date;
  document.getElementById("addSheetTitle").textContent = "✏️ Sửa chi tiêu";
  document.getElementById("addSubmitBtn").textContent  = "Lưu thay đổi";
  // Chọn đúng category
  document.querySelectorAll("#catGrid .cat-btn").forEach(b => {
    b.classList.toggle("selected", b.dataset.cat === item.category);
  });
  openAddSheet();
}

// ═══════════════════════════════════════════════════════════
//  CRUD — INCOME
// ═══════════════════════════════════════════════════════════
function addIncome() {
  const raw      = document.getElementById("inputIncomeAmount").value.replace(/[^0-9]/g, "");
  const amount   = parseInt(raw, 10);
  const note     = document.getElementById("inputIncomeNote").value.trim() || "Thu nhập";
  const date     = document.getElementById("inputIncomeDate").value;
  const selBtn   = document.querySelector("#incomeCatGrid .cat-btn.selected");
  const category = selBtn ? selBtn.dataset.cat : "💵 Khác";

  if (!amount || amount <= 0) { showToast("Nhập số tiền hợp lệ", "error"); return; }
  if (!date)                  { showToast("Chọn ngày", "error"); return; }

  if (_editingId !== null) {
    const idx = incomes.findIndex(e => e.id === _editingId);
    if (idx !== -1) {
      incomes[idx] = { ...incomes[idx], amount, note, date, category, updatedAt: Date.now() };
    }
    _editingId = null;
    document.getElementById("incomeSheetTitle").textContent = "💚 Thêm thu nhập";
    document.getElementById("incomeSubmitBtn").textContent  = "Thêm thu nhập";
  } else {
    incomes.unshift({ id: Date.now(), amount, note, date, category, updatedAt: Date.now() });
  }

  saveLocal();
  closeSheets();
  renderAll();
  showToast("✅ Đã lưu thu nhập", "success");
  if (accessToken) syncToDrive();

  document.getElementById("inputIncomeAmount").value = "";
  document.getElementById("incomeSuggestions").innerHTML = "";
  document.getElementById("inputIncomeNote").value = "";
  setTodayDate("inputIncomeDate");
  buildCatGrid("incomeCatGrid", INCOME_CATEGORIES, "selectIncCat");
}

function deleteIncome(id) {
  showConfirm("Xóa khoản thu nhập này?", () => {
    const idx = incomes.findIndex(e => e.id === id);
    if (idx !== -1) {
      incomes[idx] = { ...incomes[idx], deletedAt: Date.now(), updatedAt: Date.now() };
    }
    saveLocal();
    renderAll();
    if (accessToken) syncToDrive();
    showToast("🗑️ Đã xóa", "success");
  });
}

function editIncome(id) {
  const item = incomes.find(e => e.id === id);
  if (!item) return;
  _editingId = id;
  document.getElementById("inputIncomeAmount").value = String(item.amount);
  document.getElementById("inputIncomeNote").value   = item.note;
  document.getElementById("inputIncomeDate").value   = item.date;
  document.getElementById("incomeSheetTitle").textContent = "✏️ Sửa thu nhập";
  document.getElementById("incomeSubmitBtn").textContent  = "Lưu thay đổi";
  document.querySelectorAll("#incomeCatGrid .cat-btn").forEach(b => {
    b.classList.toggle("selected", b.dataset.cat === item.category);
  });
  openIncomeSheet();
}

// ═══════════════════════════════════════════════════════════
//  EXPORT CSV
// ═══════════════════════════════════════════════════════════
function exportCSV() {
  const rows = [["Ngày", "Loại", "Danh mục", "Ghi chú", "Số tiền"]];
  const activeExp = expenses.filter(e => !e.deletedAt);
  const activeInc = incomes.filter(e => !e.deletedAt);
  const all = [
    ...activeExp.map(e => [e.date, "Chi tiêu", e.category, e.note, e.amount]),
    ...activeInc.map(e => [e.date, "Thu nhập", e.category, e.note, e.amount]),
  ].sort((a, b) => b[0].localeCompare(a[0]));

  rows.push(...all);
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `chi-tieu-${todayStr()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("📥 Đã xuất CSV", "success");
}

// ═══════════════════════════════════════════════════════════
//  RENDER
// ═══════════════════════════════════════════════════════════
function renderAll() {
  renderSummary();
  renderCatBars();
  renderList();
}

function renderSummary() {
  const t = todayStr(), m = thisMonthStr();
  const activeExp = expenses.filter(e => !e.deletedAt);
  const activeInc = incomes.filter(e => !e.deletedAt);
  const td = activeExp.filter(e => e.date === t);
  const mo = activeExp.filter(e => e.date.startsWith(m));
  const moIncome = activeInc.filter(e => e.date.startsWith(m));

  const monthExpTotal = mo.reduce((s, e) => s + e.amount, 0);
  const monthIncTotal = moIncome.reduce((s, e) => s + e.amount, 0);
  const balance       = monthIncTotal - monthExpTotal;

  setText("todayTotal",  fmt(td.reduce((s, e) => s + e.amount, 0)));
  setText("todayCount",  `${td.length} khoản`);
  setText("monthTotal",  fmt(monthExpTotal));
  setText("monthCount",  `${mo.length} khoản`);
  setText("monthIncome", fmt(monthIncTotal));
  setText("incomeCount", `${moIncome.length} khoản`);

  const balEl = document.getElementById("balanceAmount");
  if (balEl) {
    balEl.textContent = (balance >= 0 ? "+" : "") + fmt(Math.abs(balance));
    balEl.className   = "amount " + (balance >= 0 ? "balance-pos" : "balance-neg");
  }

  const rate = monthIncTotal > 0 ? Math.round((balance / monthIncTotal) * 100) : null;
  setText("savingsRate",  rate !== null ? `Tiết kiệm ${rate}% thu nhập` : "Chưa có thu nhập tháng này");
  setText("savingsBadge", rate === null ? "💡" : rate >= 30 ? "🌟" : rate >= 10 ? "👍" : "⚠️");
}

function renderCatBars() {
  const m     = thisMonthStr();
  const items = expenses.filter(e => !e.deletedAt && e.date.startsWith(m));
  const el    = document.getElementById("catSection");
  if (!el) return;
  if (!items.length) { el.style.display = "none"; return; }
  el.style.display = "";
  const totals = {};
  items.forEach(e => { totals[e.category] = (totals[e.category] || 0) + e.amount; });
  const grand = items.reduce((s, e) => s + e.amount, 0);
  const max   = Math.max(...Object.values(totals));
  document.getElementById("catBars").innerHTML = Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([cat, amt]) => `
      <div class="cat-row">
        <span class="cat-label">${cat}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${((amt/max)*100).toFixed(0)}%;background:${catColor(cat)}"></div></div>
        <span class="cat-pct">${((amt/grand)*100).toFixed(0)}%</span>
      </div>`)
    .join("");
}

function renderList() {
  const activeExp = expenses.filter(e => !e.deletedAt);
  const activeInc = incomes.filter(e => !e.deletedAt);
  const all = [
    ...activeExp.map(e => ({ ...e, kind: "expense" })),
    ...activeInc.map(e  => ({ ...e, kind: "income"  })),
  ];
  const filtered = activeFilter === "All"        ? all
    : activeFilter === "__income__"              ? all.filter(e => e.kind === "income")
    : all.filter(e => e.kind === "expense" && e.category === activeFilter);

  const el = document.getElementById("expenseList");
  if (!filtered.length) {
    el.innerHTML = `<div class="empty-state"><div class="icon">🪙</div><p>Chưa có giao dịch nào.<br>Nhấn <b>＋</b> để thêm!</p></div>`;
    return;
  }
  const groups = {};
  filtered.forEach(e => { (groups[e.date] = groups[e.date] || []).push(e); });

  el.innerHTML = Object.entries(groups)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, items]) => {
      const netExp = items.filter(e => e.kind === "expense").reduce((s, e) => s + e.amount, 0);
      const netInc = items.filter(e => e.kind === "income").reduce((s, e)  => s + e.amount, 0);
      const daySummary = netInc > 0
        ? `<span style="color:var(--green)">+${fmt(netInc)}</span>${netExp > 0 ? ` <span style="color:var(--red)">-${fmt(netExp)}</span>` : ""}`
        : `<span style="color:var(--red)">-${fmt(netExp)}</span>`;
      return `<div class="day-group">
        <div class="day-label"><span>${fmtDate(date)}</span><span>${daySummary}</span></div>
        ${items.map(e => {
          const id  = parseInt(e.id, 10);  // đảm bảo luôn là số nguyên trong onclick
          const cat = escHtml(e.category);
          return e.kind === "income" ? `
          <div class="expense-item income-item">
            <span class="exp-icon">${catEmoji(e.category, INCOME_CATEGORIES)}</span>
            <div class="exp-info">
              <div class="exp-note">${escHtml(e.note)}</div>
              <div class="exp-meta">${cat}</div>
            </div>
            <span class="exp-amount income-amt">+${fmtExact(e.amount)}</span>
            <button class="edit-btn" onclick="editIncome(${id})" aria-label="Sửa">✏️</button>
            <button class="del-btn" onclick="deleteIncome(${id})" aria-label="Xóa">✕</button>
          </div>` : `
          <div class="expense-item">
            <span class="exp-icon">${catEmoji(e.category)}</span>
            <div class="exp-info">
              <div class="exp-note">${escHtml(e.note)}</div>
              <div class="exp-meta">${cat}</div>
            </div>
            <span class="exp-amount">-${fmtExact(e.amount)}</span>
            <button class="edit-btn" onclick="editExpense(${id})" aria-label="Sửa">✏️</button>
            <button class="del-btn" onclick="deleteExpense(${id})" aria-label="Xóa">✕</button>
          </div>`;
        }).join("")}
      </div>`;
    }).join("");
}

function escHtml(s) {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function fmtDate(d) {
  const t = todayStr();
  const y = new Date(Date.now() - 86400000).toISOString().split("T")[0];
  if (d === t) return "Hôm nay";
  if (d === y) return "Hôm qua";
  const dt = new Date(d + "T00:00:00");
  return `${dt.getDate()} tháng ${dt.getMonth() + 1}`;
}

// ═══════════════════════════════════════════════════════════
//  STATS
// ═══════════════════════════════════════════════════════════
function changeStatsMonth(delta) {
  const [y, mo] = selectedMonth.split("-").map(Number);
  const d = new Date(y, mo - 1 + delta, 1);
  selectedMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  renderStats();
}

function fmtMonthLabel(m) {
  const [y, mo] = m.split("-").map(Number);
  return `Tháng ${mo}/${y}`;
}

function changeStatsYear(delta) {
  selectedYear += delta;
  renderStats();
}

function renderStats() {
  const m         = selectedMonth;
  const isCurrentMonth = m === thisMonthStr();
  const activeExp = expenses.filter(e => !e.deletedAt);
  const activeInc = incomes.filter(e => !e.deletedAt);
  const moExp     = activeExp.filter(e => e.date.startsWith(m));
  const moInc     = activeInc.filter(e => e.date.startsWith(m));
  const grand     = moExp.reduce((s, e) => s + e.amount, 0);
  const totalInc  = moInc.reduce((s, e) => s + e.amount, 0);
  const balance   = totalInc - grand;
  const [selY, selMo] = m.split("-").map(Number);
  const daysInMonth = new Date(selY, selMo, 0).getDate();
  const today     = isCurrentMonth ? new Date().getDate() : daysInMonth;
  const avgPerDay = today > 0 ? Math.round(grand / today) : 0;

  const totals = {};
  moExp.forEach(e => { totals[e.category] = (totals[e.category] || 0) + e.amount; });
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const topCat = sorted[0];

  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().split("T")[0];
    last7.push({
      d,
      exp: activeExp.filter(e => e.date === d).reduce((s, e) => s + e.amount, 0),
      inc: activeInc.filter(e => e.date === d).reduce((s, e) => s + e.amount, 0),
    });
  }
  const daysWithData = new Set(moExp.map(e => e.date)).size;
  const savingsRate  = totalInc > 0 ? Math.round((balance / totalInc) * 100) : null;
  const spendPct     = totalInc > 0 ? Math.min(100, Math.round((grand / totalInc) * 100)) : null;

  const last7sum = last7.reduce((s, x) => s + x.exp, 0);
  const prev7 = [];
  for (let i = 13; i >= 7; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().split("T")[0];
    prev7.push(activeExp.filter(e => e.date === d).reduce((s, e) => s + e.amount, 0));
  }
  const prev7sum = prev7.reduce((a, b) => a + b, 0);
  const trend = prev7sum > 0
    ? Math.round(((last7sum - prev7sum) / prev7sum) * 100)
    : null;
  const trendText = trend === null ? "—"
    : trend > 0  ? `↑ ${trend}% so với tuần trước`
    : trend < 0  ? `↓ ${Math.abs(trend)}% so với tuần trước`
    : "= Bằng tuần trước";
  const trendColor = trend === null ? "var(--muted)"
    : trend > 0 ? "var(--red)" : trend < 0 ? "var(--green)" : "var(--blue)";

  const yr = selectedYear;
  const yPrefix = String(yr);
  const yExp = activeExp.filter(e => e.date.startsWith(yPrefix));
  const yInc = activeInc.filter(e => e.date.startsWith(yPrefix));
  const monthRows = [];
  for (let i = 0; i < 12; i++) {
    const mm = String(i + 1).padStart(2, "0");
    const prefix = `${yPrefix}-${mm}`;
    const mExp = yExp.filter(e => e.date.startsWith(prefix)).reduce((s, e) => s + e.amount, 0);
    const mInc = yInc.filter(e => e.date.startsWith(prefix)).reduce((s, e) => s + e.amount, 0);
    monthRows.push({ month: i + 1, exp: mExp, inc: mInc, balance: mInc - mExp });
  }
  const yearExpTotal = monthRows.reduce((s, r) => s + r.exp, 0);
  const yearIncTotal = monthRows.reduce((s, r) => s + r.inc, 0);
  const yearBalance  = yearIncTotal - yearExpTotal;
  const hasYearData  = yearExpTotal > 0 || yearIncTotal > 0;
  const isCurrentYear = yr === new Date().getFullYear();

  document.getElementById("statsContent").innerHTML = `
    <div class="stats-header">
      <div class="stats-title">📊 Phân tích chi tiêu</div>
      <button class="export-btn" onclick="exportCSV()">📥 Xuất CSV</button>
    </div>

    <div class="month-switcher">
      <button class="month-nav-btn" onclick="changeStatsMonth(-1)" aria-label="Tháng trước">◀</button>
      <span class="month-label">${fmtMonthLabel(m)}${isCurrentMonth ? " (hiện tại)" : ""}</span>
      <button class="month-nav-btn" onclick="changeStatsMonth(1)" aria-label="Tháng sau" ${isCurrentMonth ? "disabled" : ""}>▶</button>
    </div>

    <div class="insight-grid">
      <div class="insight-card">
        <div class="i-label">Thu nhập T.${selMo}</div>
        <div class="i-value" style="color:var(--green)">${fmt(totalInc)}</div>
        <div class="i-sub">${moInc.length} khoản</div>
      </div>
      <div class="insight-card">
        <div class="i-label">Chi tiêu T.${selMo}</div>
        <div class="i-value" style="color:var(--red)">${fmt(grand)}</div>
        <div class="i-sub">${moExp.length} giao dịch</div>
      </div>
      <div class="insight-card">
        <div class="i-label">Còn lại</div>
        <div class="i-value" style="color:${balance >= 0 ? "var(--green)" : "var(--red)"}">
          ${balance >= 0 ? "+" : ""}${fmt(Math.abs(balance))}
        </div>
        <div class="i-sub">${savingsRate !== null ? `Tiết kiệm ${savingsRate}%` : "Chưa có thu nhập"}</div>
      </div>
      <div class="insight-card">
        <div class="i-label">Trung bình/ngày</div>
        <div class="i-value" style="color:var(--yellow)">${fmt(avgPerDay)}</div>
        <div class="i-sub">${daysWithData} ngày chi tiêu</div>
      </div>
    </div>

    ${totalInc > 0 ? `
    <div class="stat-block">
      <div class="block-label">Tỉ lệ chi tiêu / thu nhập</div>
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-bottom:6px">
        <span>Chi: ${fmt(grand)}</span><span>Thu: ${fmt(totalInc)}</span>
      </div>
      <div class="behavior-bar">
        <div class="behavior-fill" style="width:${spendPct}%;background:${spendPct > 90 ? "var(--red)" : spendPct > 70 ? "var(--yellow)" : "var(--green)"}"></div>
      </div>
      <div style="font-size:12px;color:var(--muted);text-align:right">${spendPct}% đã chi</div>
    </div>` : ""}

    ${isCurrentMonth ? `
    <div class="stat-block">
      <div class="block-label">7 ngày gần nhất</div>
      <div class="chart-box" style="height:160px">
        <canvas id="chartLast7"></canvas>
      </div>
    </div>

    <div class="stat-block">
      <div class="block-label">Xu hướng chi tiêu</div>
      <div class="stat-row">
        <div class="sr-left">📅 Tổng 7 ngày qua</div>
        <div class="sr-right">${fmt(last7sum)}</div>
      </div>
      <div class="stat-row">
        <div class="sr-left">📈 So sánh</div>
        <div class="sr-right" style="color:${trendColor};font-size:13px">${trendText}</div>
      </div>
    </div>` : ""}

    <div class="stat-block">
      <div class="block-label">Danh mục ${fmtMonthLabel(m).toLowerCase()}</div>
      ${sorted.length === 0
        ? '<p style="color:var(--muted);font-size:13px">Chưa có dữ liệu</p>'
        : `<div class="chart-box" style="height:200px">
        <canvas id="chartCategory"></canvas>
      </div>` +
        sorted.map(([cat, amt]) => `
          <div class="stat-row">
            <div class="sr-left">${catEmoji(cat)} ${escHtml(cat)}</div>
            <div class="sr-right" style="display:flex;flex-direction:column;align-items:flex-end;gap:2px">
              <span>${fmt(amt)}</span>
              <span style="font-size:11px;color:var(--muted)">${grand > 0 ? ((amt/grand)*100).toFixed(0) : 0}%</span>
            </div>
          </div>`).join("") +
          `<div class="stat-row" style="font-weight:700">
            <div class="sr-left" style="color:var(--text)">Tổng chi</div>
            <div class="sr-right">${fmt(grand)}</div>
          </div>`}
    </div>

    <div class="stat-block">
      <div class="block-label">Tổng quan ${fmtMonthLabel(m).toLowerCase()}</div>
      <div class="stat-row">
        <div class="sr-left">📅 Ngày có chi tiêu</div>
        <div class="sr-right" style="color:var(--blue)">${daysWithData} ngày</div>
      </div>
      <div class="stat-row">
        <div class="sr-left">🔢 Số giao dịch</div>
        <div class="sr-right" style="color:var(--blue)">${moExp.length}</div>
      </div>
      ${topCat ? `
      <div class="stat-row">
        <div class="sr-left">🏆 Chi nhiều nhất</div>
        <div class="sr-right" style="color:var(--purple)">${escHtml(topCat[0].split(" ").slice(1).join(" "))}</div>
      </div>` : ""}
      <div class="stat-row">
        <div class="sr-left">📈 TB/ngày</div>
        <div class="sr-right" style="color:var(--yellow)">${fmt(avgPerDay)}</div>
      </div>
    </div>

    <div class="stat-block">
      <div class="block-label">Tổng hợp theo năm</div>
      <div class="year-switcher">
        <button class="month-nav-btn" onclick="changeStatsYear(-1)" aria-label="Năm trước">◀</button>
        <span class="month-label">Năm ${yr}${isCurrentYear ? " (hiện tại)" : ""}</span>
        <button class="month-nav-btn" onclick="changeStatsYear(1)" aria-label="Năm sau" ${isCurrentYear ? "disabled" : ""}>▶</button>
      </div>
      ${!hasYearData ? '<p style="color:var(--muted);font-size:13px">Chưa có dữ liệu năm này</p>' : `
      <div class="chart-box" style="height:180px;margin-bottom:12px">
        <canvas id="chartYear"></canvas>
      </div>
      <div class="year-table">
        <div class="year-row year-head">
          <span>Tháng</span><span>Thu</span><span>Chi</span><span>Còn lại</span>
        </div>
        ${monthRows.filter(r => r.inc > 0 || r.exp > 0).map(r => `
        <div class="year-row">
          <span>Th${r.month}</span>
          <span style="color:var(--green)">${r.inc > 0 ? "+" + fmt(r.inc) : "—"}</span>
          <span style="color:var(--red)">${r.exp > 0 ? "-" + fmt(r.exp) : "—"}</span>
          <span style="color:${r.balance >= 0 ? "var(--green)" : "var(--red)"}">${r.balance >= 0 ? "+" : ""}${fmt(Math.abs(r.balance))}</span>
        </div>`).join("")}
        <div class="year-row year-total">
          <span>Tổng</span>
          <span style="color:var(--green)">+${fmt(yearIncTotal)}</span>
          <span style="color:var(--red)">-${fmt(yearExpTotal)}</span>
          <span style="color:${yearBalance >= 0 ? "var(--green)" : "var(--red)"}">${yearBalance >= 0 ? "+" : ""}${fmt(Math.abs(yearBalance))}</span>
        </div>
      </div>`}
    </div>
  `;

  renderStatsCharts({ sorted, grand, last7, monthRows, isCurrentMonth, hasYearData });
}

// ═══════════════════════════════════════════════════════════
//  STATS CHARTS (Chart.js)
// ═══════════════════════════════════════════════════════════
let _charts = {};

function destroyChart(key) {
  if (_charts[key]) {
    _charts[key].destroy();
    delete _charts[key];
  }
}

function renderStatsCharts({ sorted, grand, last7, monthRows, isCurrentMonth, hasYearData }) {
  ["chartCategory", "chartLast7", "chartYear"].forEach(destroyChart);
  if (typeof Chart === "undefined") return;

  const mutedColor = "#8b949e";
  const gridColor  = "rgba(139,148,158,0.15)";
  Chart.defaults.color = mutedColor;
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;

  if (sorted.length > 0) {
    const ctx = document.getElementById("chartCategory");
    if (ctx) {
      _charts.chartCategory = new Chart(ctx, {
        type: "doughnut",
        data: {
          labels: sorted.map(([cat]) => cat),
          datasets: [{
            data: sorted.map(([, amt]) => amt),
            backgroundColor: sorted.map(([cat]) => catColor(cat)),
            borderColor: "#1c2230",
            borderWidth: 2,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: "62%",
          plugins: {
            legend: { position: "bottom", labels: { boxWidth: 10, padding: 10, font: { size: 11 } } },
            tooltip: {
              callbacks: {
                label: (item) => ` ${item.label}: ${fmtExact(item.raw)} (${grand > 0 ? ((item.raw / grand) * 100).toFixed(0) : 0}%)`,
              },
            },
          },
        },
      });
    }
  }

  if (isCurrentMonth) {
    const ctx = document.getElementById("chartLast7");
    if (ctx) {
      _charts.chartLast7 = new Chart(ctx, {
        type: "bar",
        data: {
          labels: last7.map(({ d }) => new Date(d + "T00:00:00").getDate()),
          datasets: [
            { label: "Thu", data: last7.map(x => x.inc), backgroundColor: "#3fb950", borderRadius: 4 },
            { label: "Chi", data: last7.map(x => x.exp), backgroundColor: "#f85149", borderRadius: 4 },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: "bottom", labels: { boxWidth: 10, padding: 10, font: { size: 11 } } },
            tooltip: { callbacks: { label: (item) => ` ${item.dataset.label}: ${fmtExact(item.raw)}` } },
          },
          scales: {
            x: { grid: { display: false } },
            y: { grid: { color: gridColor }, ticks: { callback: (v) => fmt(v) } },
          },
        },
      });
    }
  }

  if (hasYearData) {
    const ctx = document.getElementById("chartYear");
    if (ctx) {
      const withData = monthRows.filter((r, i) => i <= monthRows.findLastIndex(x => x.inc > 0 || x.exp > 0));
      _charts.chartYear = new Chart(ctx, {
        type: "line",
        data: {
          labels: withData.map(r => `Th${r.month}`),
          datasets: [
            { label: "Thu", data: withData.map(r => r.inc), borderColor: "#3fb950", backgroundColor: "rgba(63,185,80,0.15)", tension: 0.3, fill: true },
            { label: "Chi", data: withData.map(r => r.exp), borderColor: "#f85149", backgroundColor: "rgba(248,81,73,0.15)", tension: 0.3, fill: true },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: "bottom", labels: { boxWidth: 10, padding: 10, font: { size: 11 } } },
            tooltip: { callbacks: { label: (item) => ` ${item.dataset.label}: ${fmtExact(item.raw)}` } },
          },
          scales: {
            x: { grid: { display: false } },
            y: { grid: { color: gridColor }, ticks: { callback: (v) => fmt(v) } },
          },
        },
      });
    }
  }
}

// ═══════════════════════════════════════════════════════════
//  NAVIGATION
// ═══════════════════════════════════════════════════════════
function showPage(page) {
  document.getElementById("pageHome").classList.toggle("hidden",  page !== "home");
  document.getElementById("pageStats").classList.toggle("hidden", page !== "stats");
  document.getElementById("navHome").classList.toggle("active",   page === "home");
  document.getElementById("navStats").classList.toggle("active",  page === "stats");
  if (page === "stats") renderStats();
}

// ═══════════════════════════════════════════════════════════
//  FAB MENU
// ═══════════════════════════════════════════════════════════
function toggleFab() {
  fabOpen = !fabOpen;
  document.getElementById("fabMenu").classList.toggle("open", fabOpen);
  document.getElementById("overlay").classList.toggle("open", fabOpen);
  document.getElementById("fabBtn").textContent = fabOpen ? "✕" : "＋";
}

function closeFab() {
  fabOpen = false;
  document.getElementById("fabMenu").classList.remove("open");
  document.getElementById("fabBtn").textContent = "＋";
}

// ═══════════════════════════════════════════════════════════
//  SHEET CONTROLS
// ═══════════════════════════════════════════════════════════
function openAddSheet() {
  closeFab();
  document.getElementById("overlay").classList.add("open");
  document.getElementById("addSheet").classList.add("open");
  document.getElementById("inputAmount").focus();
}

function openIncomeSheet() {
  closeFab();
  document.getElementById("overlay").classList.add("open");
  document.getElementById("incomeSheet").classList.add("open");
  document.getElementById("inputIncomeAmount").focus();
}

function openAuthSheet() {
  document.getElementById("overlay").classList.add("open");
  document.getElementById("authSheet").classList.add("open");
}

function handleOverlayClick(e) {
  if (e.target === document.getElementById("overlay")) closeSheets();
}

function closeSheets() {
  // Reset trạng thái edit khi đóng sheet
  if (_editingId !== null) {
    _editingId = null;
    document.getElementById("addSheetTitle").textContent    = "💸 Thêm chi tiêu";
    document.getElementById("addSubmitBtn").textContent     = "Thêm chi tiêu";
    document.getElementById("incomeSheetTitle").textContent = "💚 Thêm thu nhập";
    document.getElementById("incomeSubmitBtn").textContent  = "Thêm thu nhập";
  }
  closeFab();
  document.getElementById("overlay").classList.remove("open");
  document.querySelectorAll(".sheet").forEach(s => s.classList.remove("open"));
}

// ═══════════════════════════════════════════════════════════
//  FILTER
// ═══════════════════════════════════════════════════════════
function setFilter(cat, el) {
  activeFilter = cat;
  document.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
  el.classList.add("active");
  renderList();
}

// ═══════════════════════════════════════════════════════════
//  CAT GRID BUILDER
// ═══════════════════════════════════════════════════════════
function buildCatGrid(gridId, cats, selectFn) {
  document.getElementById(gridId).innerHTML = cats.map(c => `
    <button class="cat-btn" data-cat="${c.key}" onclick="${selectFn}(this)">
      <span class="emoji">${c.emoji}</span>${c.label}
    </button>`).join("");
  const first = document.querySelector(`#${gridId} .cat-btn`);
  if (first) first.classList.add("selected");
}

function selectExpCat(el) {
  document.querySelectorAll("#catGrid .cat-btn").forEach(b => b.classList.remove("selected"));
  el.classList.add("selected");
}

function selectIncCat(el) {
  document.querySelectorAll("#incomeCatGrid .cat-btn").forEach(b => b.classList.remove("selected"));
  el.classList.add("selected");
}

// ═══════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════
function setTodayDate(id) {
  const el = document.getElementById(id);
  if (el) el.value = todayStr();
}

let toastTimer;
function showToast(msg, type) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2500);
}

// ═══════════════════════════════════════════════════════════
//  CUSTOM CONFIRM DIALOG
// ═══════════════════════════════════════════════════════════
let _confirmCallback = null;

function showConfirm(message, onOk) {
  _confirmCallback = onOk;
  document.getElementById("confirmMsg").textContent = message;
  document.getElementById("confirmDialog").classList.add("open");
}

function confirmOk() {
  document.getElementById("confirmDialog").classList.remove("open");
  if (_confirmCallback) { _confirmCallback(); _confirmCallback = null; }
}

function confirmCancel() {
  document.getElementById("confirmDialog").classList.remove("open");
  _confirmCallback = null;
}
