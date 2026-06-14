// ═══════════════════════════════════════════════════════════
//  CONFIG
//  ⚠️  Client ID chỉ hoạt động trên domain đã đăng ký trong
//     Google Cloud Console > Authorized JavaScript origins
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

const catColor  = (k, list = CATEGORIES) => (list.find(c => c.key === k) || {}).color || "#8B949E";
const catEmoji  = (k, list = CATEGORIES) => (list.find(c => c.key === k) || {}).emoji || "📦";

// ═══════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════
let expenses    = JSON.parse(localStorage.getItem("expenses") || "[]");
let incomes     = JSON.parse(localStorage.getItem("incomes")  || "[]");
let activeFilter = "All";
let accessToken  = null;
let driveFileId  = null;
let fabOpen      = false;

// ═══════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════
window.addEventListener("load", () => {
  buildCatGrid("catGrid", CATEGORIES, "selectExpCat");
  buildCatGrid("incomeCatGrid", INCOME_CATEGORIES, "selectIncCat");
  setTodayDate("inputDate");
  setTodayDate("inputIncomeDate");
  renderAll();
  setupAmountSuggestions("inputAmount", "suggestions");
  setupAmountSuggestions("inputIncomeAmount", "incomeSuggestions");
});

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
    // Generate candidates: num * 1k, num * 10k, num * 100k, num * 1M
    // Only show if candidate > num (avoids suggesting the same value)
    const multipliers = [1_000, 10_000, 100_000, 1_000_000];
    const seen = new Set();
    const chips = [];

    for (const m of multipliers) {
      const val = num * m;
      if (val <= num) continue;
      if (val > 500_000_000) continue; // cap at 500M₫
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

function fmtSuggest(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1) + "M₫";
  if (n >= 1_000)     return (n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1) + "K₫";
  return n.toLocaleString("vi-VN") + "₫";
}

// ═══════════════════════════════════════════════════════════
//  GOOGLE OAUTH
// ═══════════════════════════════════════════════════════════
function initOAuthFlow() {
  if (!GAPI_CLIENT_ID || GAPI_CLIENT_ID === "YOUR_GOOGLE_CLIENT_ID_HERE") {
    showToast("Cần cài Google Client ID trước", "error");
    return;
  }
  if (!window.google || !window.google.accounts) {
    showToast("Google SDK chưa tải xong, thử lại sau", "error");
    return;
  }
  closeSheets();
  const client = google.accounts.oauth2.initTokenClient({
    client_id: GAPI_CLIENT_ID,
    scope: "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.appdata",
    callback: (res) => {
      if (res.error) {
        setSyncState("error", "Lỗi");
        showToast("Đăng nhập thất bại: " + res.error, "error");
        return;
      }
      accessToken = res.access_token;
      setSyncState("syncing", "Đang tải…");
      syncFromDrive();
    },
  });
  client.requestAccessToken();
}

function startLogin() { initOAuthFlow(); }

// ═══════════════════════════════════════════════════════════
//  GOOGLE DRIVE
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

      if (Array.isArray(data.expenses) && data.expenses.length > 0) {
        const merged = [...data.expenses];
        expenses.forEach(local => { if (!merged.find(d => d.id === local.id)) merged.push(local); });
        merged.sort((a, b) => b.id - a.id);
        expenses = merged;
      }
      if (Array.isArray(data.incomes) && data.incomes.length > 0) {
        const merged = [...data.incomes];
        incomes.forEach(local => { if (!merged.find(d => d.id === local.id)) merged.push(local); });
        merged.sort((a, b) => b.id - a.id);
        incomes = merged;
      }
      localStorage.setItem("expenses", JSON.stringify(expenses));
      localStorage.setItem("incomes",  JSON.stringify(incomes));
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

  expenses.unshift({ id: Date.now(), amount, note, date, category });
  localStorage.setItem("expenses", JSON.stringify(expenses));
  closeSheets();
  renderAll();
  showToast("✅ Đã thêm chi tiêu", "success");
  if (accessToken) syncToDrive();

  document.getElementById("inputAmount").value = "";
  document.getElementById("suggestions").innerHTML = "";
  document.getElementById("inputNote").value = "";
  setTodayDate("inputDate");
}

function deleteExpense(id) {
  showConfirm("Xóa khoản chi tiêu này?", () => {
    expenses = expenses.filter(e => e.id !== id);
    localStorage.setItem("expenses", JSON.stringify(expenses));
    renderAll();
    if (accessToken) syncToDrive();
    showToast("🗑️ Đã xóa", "success");
  });
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

  incomes.unshift({ id: Date.now(), amount, note, date, category });
  localStorage.setItem("incomes", JSON.stringify(incomes));
  closeSheets();
  renderAll();
  showToast("✅ Đã thêm thu nhập", "success");
  if (accessToken) syncToDrive();

  document.getElementById("inputIncomeAmount").value = "";
  document.getElementById("incomeSuggestions").innerHTML = "";
  document.getElementById("inputIncomeNote").value = "";
  setTodayDate("inputIncomeDate");
}

function deleteIncome(id) {
  showConfirm("Xóa khoản thu nhập này?", () => {
    incomes = incomes.filter(e => e.id !== id);
    localStorage.setItem("incomes", JSON.stringify(incomes));
    renderAll();
    if (accessToken) syncToDrive();
    showToast("🗑️ Đã xóa", "success");
  });
}

// ═══════════════════════════════════════════════════════════
//  RENDER
// ═══════════════════════════════════════════════════════════
function fmt(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M₫";
  if (n >= 1_000)     return Math.round(n / 1_000) + "K₫";
  return n.toLocaleString("vi-VN") + "₫";
}
const todayStr     = () => new Date().toISOString().split("T")[0];
const thisMonthStr = () => todayStr().slice(0, 7);

function renderAll() {
  renderSummary();
  renderCatBars();
  renderList();
}

function renderSummary() {
  const t = todayStr(), m = thisMonthStr();
  const td = expenses.filter(e => e.date === t);
  const mo = expenses.filter(e => e.date.startsWith(m));
  const moIncome = incomes.filter(e => e.date.startsWith(m));

  const monthExpTotal  = mo.reduce((s, e) => s + e.amount, 0);
  const monthIncTotal  = moIncome.reduce((s, e) => s + e.amount, 0);
  const balance        = monthIncTotal - monthExpTotal;

  document.getElementById("todayTotal").textContent  = fmt(td.reduce((s, e) => s + e.amount, 0));
  document.getElementById("todayCount").textContent  = `${td.length} khoản`;
  document.getElementById("monthTotal").textContent  = fmt(monthExpTotal);
  document.getElementById("monthCount").textContent  = `${mo.length} khoản`;
  document.getElementById("monthIncome").textContent = fmt(monthIncTotal);
  document.getElementById("incomeCount").textContent = `${moIncome.length} khoản`;

  const balEl = document.getElementById("balanceAmount");
  balEl.textContent = (balance >= 0 ? "+" : "") + fmt(Math.abs(balance));
  balEl.className   = "amount " + (balance >= 0 ? "balance-pos" : "balance-neg");

  const rate = monthIncTotal > 0 ? Math.round((balance / monthIncTotal) * 100) : null;
  document.getElementById("savingsRate").textContent =
    rate !== null ? `Tiết kiệm ${rate}% thu nhập` : "Chưa có thu nhập tháng này";
  document.getElementById("savingsBadge").textContent =
    rate === null ? "💡" : rate >= 30 ? "🌟" : rate >= 10 ? "👍" : "⚠️";
}

function renderCatBars() {
  const m     = thisMonthStr();
  const items = expenses.filter(e => e.date.startsWith(m));
  if (!items.length) { document.getElementById("catSection").style.display = "none"; return; }
  document.getElementById("catSection").style.display = "";
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
  // Merge expenses + incomes into a unified list
  const all = [
    ...expenses.map(e => ({ ...e, kind: "expense" })),
    ...incomes.map(e  => ({ ...e, kind: "income"  })),
  ];
  const filtered = activeFilter === "All"      ? all
    : activeFilter === "__income__"            ? all.filter(e => e.kind === "income")
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
        ${items.map(e => e.kind === "income" ? `
          <div class="expense-item income-item">
            <span class="exp-icon">${catEmoji(e.category, INCOME_CATEGORIES)}</span>
            <div class="exp-info">
              <div class="exp-note">${escHtml(e.note)}</div>
              <div class="exp-meta">${e.category}</div>
            </div>
            <span class="exp-amount income-amt">+${fmt(e.amount)}</span>
            <button class="del-btn" onclick="deleteIncome(${e.id})" aria-label="Xóa">✕</button>
          </div>` : `
          <div class="expense-item">
            <span class="exp-icon">${catEmoji(e.category)}</span>
            <div class="exp-info">
              <div class="exp-note">${escHtml(e.note)}</div>
              <div class="exp-meta">${e.category}</div>
            </div>
            <span class="exp-amount">-${fmt(e.amount)}</span>
            <button class="del-btn" onclick="deleteExpense(${e.id})" aria-label="Xóa">✕</button>
          </div>`).join("")}
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
//  STATS + BEHAVIOR ANALYSIS
// ═══════════════════════════════════════════════════════════
function renderStats() {
  const m         = thisMonthStr();
  const moExp     = expenses.filter(e => e.date.startsWith(m));
  const moInc     = incomes.filter(e => e.date.startsWith(m));
  const grand     = moExp.reduce((s, e) => s + e.amount, 0);
  const totalInc  = moInc.reduce((s, e) => s + e.amount, 0);
  const balance   = totalInc - grand;
  const today     = new Date().getDate();
  const avgPerDay = today > 0 ? Math.round(grand / today) : 0;

  const totals = {};
  moExp.forEach(e => { totals[e.category] = (totals[e.category] || 0) + e.amount; });
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const topCat = sorted[0];

  // 7-day bar chart data
  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().split("T")[0];
    last7.push({
      d,
      exp: expenses.filter(e => e.date === d).reduce((s, e) => s + e.amount, 0),
      inc: incomes.filter(e => e.date === d).reduce((s, e) => s + e.amount, 0),
    });
  }
  const maxDay = Math.max(...last7.map(x => Math.max(x.exp, x.inc)), 1);

  // Behavior insights
  const daysWithData = new Set(moExp.map(e => e.date)).size;
  const savingsRate  = totalInc > 0 ? Math.round((balance / totalInc) * 100) : null;
  const spendPct     = totalInc > 0 ? Math.min(100, Math.round((grand / totalInc) * 100)) : null;

  // Spending velocity: compare last 7d avg vs prior 7d avg
  const last7sum  = last7.reduce((s, x) => s + x.exp, 0);
  const prev7 = [];
  for (let i = 13; i >= 7; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().split("T")[0];
    prev7.push(expenses.filter(e => e.date === d).reduce((s, e) => s + e.amount, 0));
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

  document.getElementById("statsContent").innerHTML = `
    <div class="stats-title">📊 Phân tích chi tiêu</div>

    <!-- Insight grid -->
    <div class="insight-grid">
      <div class="insight-card">
        <div class="i-label">Thu nhập T.này</div>
        <div class="i-value" style="color:var(--green)">${fmt(totalInc)}</div>
        <div class="i-sub">${moInc.length} khoản</div>
      </div>
      <div class="insight-card">
        <div class="i-label">Chi tiêu T.này</div>
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

    <!-- Spending vs Income bar -->
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

    <!-- 7-day chart -->
    <div class="stat-block">
      <div class="block-label">7 ngày gần nhất</div>
      <div style="display:flex;align-items:flex-end;gap:5px;height:80px;margin-bottom:8px">
        ${last7.map(({ d, exp, inc }) => `
          <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px">
            <div style="flex:1;width:100%;position:relative;display:flex;align-items:flex-end;gap:2px">
              ${inc > 0 ? `<div style="flex:1;background:var(--green);opacity:0.7;border-radius:3px 3px 0 0;height:${((inc/maxDay)*100).toFixed(0)}%"></div>` : `<div style="flex:1"></div>`}
              ${exp > 0 ? `<div style="flex:1;background:var(--red);opacity:0.85;border-radius:3px 3px 0 0;height:${((exp/maxDay)*100).toFixed(0)}%"></div>` : `<div style="flex:1"></div>`}
            </div>
            <span style="font-size:10px;color:var(--muted)">${new Date(d+"T00:00:00").getDate()}</span>
          </div>`).join("")}
      </div>
      <div style="display:flex;gap:12px;font-size:11px;color:var(--muted)">
        <span><span style="display:inline-block;width:8px;height:8px;background:var(--green);border-radius:2px;margin-right:3px"></span>Thu</span>
        <span><span style="display:inline-block;width:8px;height:8px;background:var(--red);border-radius:2px;margin-right:3px"></span>Chi</span>
      </div>
    </div>

    <!-- Trend -->
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
    </div>

    <!-- Category breakdown -->
    <div class="stat-block">
      <div class="block-label">Danh mục tháng này</div>
      ${sorted.length === 0
        ? '<p style="color:var(--muted);font-size:13px">Chưa có dữ liệu</p>'
        : sorted.map(([cat, amt]) => `
          <div class="stat-row">
            <div class="sr-left">${catEmoji(cat)} ${cat}</div>
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

    <!-- Overview -->
    <div class="stat-block">
      <div class="block-label">Tổng quan tháng này</div>
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
        <div class="sr-right" style="color:var(--purple)">${topCat[0].split(" ").slice(1).join(" ")}</div>
      </div>` : ""}
      <div class="stat-row">
        <div class="sr-left">📈 TB/ngày</div>
        <div class="sr-right" style="color:var(--yellow)">${fmt(avgPerDay)}</div>
      </div>
    </div>
  `;
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
//  CUSTOM CONFIRM DIALOG (replaces native confirm() which
//  can be blocked or visually covered on mobile browsers)
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
