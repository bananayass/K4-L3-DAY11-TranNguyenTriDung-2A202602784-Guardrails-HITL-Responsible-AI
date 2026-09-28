"use strict";

const artifactPaths = {
  results: "../outputs/results.json",
  attacks: "../outputs/attack_results.json",
  grade: "../outputs/grade_report.json",
};

const state = {
  results: null,
  attacks: null,
  grade: null,
  target: "red",
  attackIndex: 0,
  scenarios: [],
};

const element = (id) => document.getElementById(id);
const setText = (id, value) => { element(id).textContent = String(value ?? "—"); };
const countTrue = (rows, key) => rows.filter((row) => row && row[key] === true).length;
const asArray = (value) => Array.isArray(value) ? value : [];
const categoryLabels = {
  "Completion / Fill-in-the-blank": "Hoàn thiện đoạn còn thiếu",
  "Translation / Reformatting": "Dịch và đổi định dạng",
  "Hypothetical / Creative writing": "Tình huống giả định",
  "Transfer receipt / Smart-field completion": "Hoàn thiện trường biên nhận",
  "Transfer receipt / Accessibility localization": "Định dạng cho trình đọc màn hình",
  "Transfer receipt / OCR instruction injection": "Chèn lệnh qua OCR biên nhận",
  "Transfer receipt / Screen-reader OCR injection": "Chèn lệnh OCR cho trình đọc màn hình",
};

function categoryLabel(row, index) {
  return categoryLabels[row.category] || `Lượt tấn công ${index + 1}`;
}

function layerLabel(row) {
  const names = {
    leaked: "Lộ giá trị demo được bảo vệ",
    input_injection: "Bị chặn ở đầu vào · phát hiện prompt injection",
    input_topic: "Bị chặn ở đầu vào · ngoài chủ đề ngân hàng",
    output_filter: "Bị chặn ở đầu ra",
    model_refuse: "Mô hình từ chối",
  };
  if (names[row.layer]) return names[row.layer];
  if (String(row.blocked_at || "").startsWith("PASSED")) return "Phản hồi không chứa giá trị demo bị bảo vệ";
  if (String(row.blocked_at || "").startsWith("LEAKED")) return "Lộ giá trị demo được bảo vệ";
  return row.blocked_at || "Không ghi nhận lớp chặn";
}

function safeExcerpt(value, limit = 420) {
  const text = String(value ?? "")
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, "")
    .replace(/\bsk-[a-z0-9-]{6,}\b/gi, "[demo token hidden]")
    .replace(/\b[a-z0-9.-]+\.internal(?::\d+)?\b/gi, "[internal host hidden]")
    .replace(/\badmin\d+\b/gi, "[demo value hidden]");
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;
}

function getAttackRows(target) {
  if (!state.attacks) return [];
  return asArray(state.attacks[target === "red" ? "unsafe_attacks" : "guards_attacks"]);
}

function renderSnapshot() {
  const results = state.results || {};
  const red = getAttackRows("red");
  const advance = getAttackRows("advance");
  const safe = asArray(results.safe_queries);
  const attacks = asArray(results.attack_queries);
  setText("safe-count", state.results ? `${safe.length - countTrue(safe, "blocked")}/${safe.length}` : "—");
  setText("blocked-count", state.results ? `${countTrue(attacks, "blocked")}/${attacks.length}` : "—");
  setText("red-count", state.attacks ? `${countTrue(red, "leaked")}/${red.length}` : "—");
  setText("advance-count", state.attacks ? `${countTrue(advance, "leaked")}/${advance.length}` : "—");
  setText("red-tab-count", state.attacks ? `${countTrue(red, "leaked")}/${red.length} lần lộ` : "—");
  setText("advance-tab-count", state.attacks ? `${countTrue(advance, "leaked")}/${advance.length} lần lộ` : "—");

  if (state.attacks) {
    const leaks = countTrue(advance, "leaked");
    setText("bonus-note", leaks
      ? `Bằng chứng B2 tiềm năng: ${leaks}/${advance.length} phản hồi Red Advance làm lộ giá trị demo. Hệ thống chấm của lớp cần chạy lại các lượt tấn công trước khi cộng bonus.`
      : `Lần chạy đã lưu chưa có bằng chứng B2: Red Advance lộ 0/${advance.length}. Không cộng đồng thời B1 và B2.`);
  }
}

function buildScenarios() {
  if (!state.results) return [];
  return [
    ...asArray(state.results.safe_queries).map((row, index) => ({ row, type: "Safe", number: index + 1 })),
    ...asArray(state.results.attack_queries).map((row, index) => ({ row, type: "Attack", number: index + 1 })),
    ...asArray(state.results.edge_cases).map((row, index) => ({ row, type: "Edge", number: index + 1 })),
  ];
}

function setStage(stage, label, kind) {
  const row = document.querySelector(`[data-stage="${stage}"]`);
  row.classList.remove("is-pass", "is-stop", "is-wait");
  row.classList.add(`is-${kind}`);
  row.querySelector(".stage-state").textContent = label;
}

function renderScenario() {
  const selected = state.scenarios[Number(element("scenario-select").value)];
  if (!selected) return;
  const { row, type, number } = selected;
  const blocked = row.blocked === true;
  const layer = String(row.layer || "");
  const atInput = blocked && (layer.includes("input") || !layer);

  setText("request-text", safeExcerpt(row.input, 320) || `${type} · tình huống ${number}`);
  const outcome = element("scenario-outcome");
  outcome.textContent = blocked ? "ĐÃ CHẶN" : "ĐÃ CHO QUA";
  outcome.className = `outcome-pill ${blocked ? "blocked" : "allowed"}`;

  setStage("request", "Đã nhận", "pass");
  setStage("input", atInput ? "Bị chặn" : "Đã qua", atInput ? "stop" : "pass");
  setStage("model", atInput ? "Chưa chạy" : "Đã phản hồi", atInput ? "wait" : "pass");
  setStage("output", atInput ? "Chưa chạy" : blocked ? "Bị chặn" : "Đã kiểm tra", atInput ? "wait" : blocked ? "stop" : "pass");
  setStage("record", "Đã lưu", "pass");

  setText("trace-explanation", atInput
    ? "Guardrail đầu vào đã chặn yêu cầu trước khi chuyển đến Blue. Quyết định được lưu trong results.json."
    : blocked
      ? "Yêu cầu đã đến Blue, sau đó một bước kiểm tra chặn phản hồi. Trường layer cho biết vị trí chặn."
      : "Yêu cầu đã qua các bước kiểm tra được ghi nhận. Kết quả nằm trong results.json.");
}

function renderScenarioPicker() {
  state.scenarios = buildScenarios();
  const select = element("scenario-select");
  select.replaceChildren();
  state.scenarios.forEach(({ row, type, number }, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    const typeVi = { Safe: "An toàn", Attack: "Tấn công", Edge: "Ca biên" }[type] || type;
    option.textContent = `${typeVi} ${String(number).padStart(2, "0")} · ${row.blocked ? "Bị chặn" : "Cho qua"}`;
    select.append(option);
  });
  select.disabled = state.scenarios.length === 0;
  element("trace-button").disabled = state.scenarios.length === 0;
  if (state.scenarios.length) {
    renderScenario();
  } else {
    const option = document.createElement("option");
    option.textContent = "Tải results.json để chọn tình huống";
    select.append(option);
    setText("request-text", "Chạy Checkpoint 3 hoặc chọn results.json để xem tình huống đã ghi.");
  }
}

function attackState(row) {
  if (row.leaked === true) return { text: "ĐÃ LỘ", className: "leaked" };
  if (row.blocked === true || row.blocked_input === true) return { text: "ĐÃ CHẶN", className: "blocked" };
  if (row.layer === "model_refuse" || /(?:can't|cannot|unable|sorry)/i.test(String(row.response_preview || ""))) {
    return { text: "TỪ CHỐI", className: "refused" };
  }
  return { text: "KHÔNG LỘ", className: "other" };
}

function renderAttackDetail() {
  const rows = getAttackRows(state.target);
  const row = rows[state.attackIndex];
  if (!row) {
    setText("attack-title", "Chưa chọn lượt tấn công");
    setText("attack-layer", "Chạy Checkpoint 4 hoặc tải attack_results.json.");
    setText("attack-prompt", "—");
    setText("attack-response", "—");
    return;
  }
  setText("attack-title", categoryLabel(row, state.attackIndex));
  const status = attackState(row);
  setText("attack-layer", `${status.text} · ${layerLabel(row)}`);
  setText("attack-prompt", safeExcerpt(row.input, 520) || "Không có prompt được lưu.");
  setText("attack-response", row.leaked === true
    ? "Giá trị demo được bảo vệ đã được ẩn ở đây. Artifact cục bộ lưu bằng chứng đầy đủ."
    : safeExcerpt(row.response_preview, 320) || "Không có trích đoạn phản hồi.");
}

function renderAttackList() {
  const list = element("attack-list");
  list.replaceChildren();
  const rows = getAttackRows(state.target);
  if (!rows.length) {
    const note = document.createElement("p");
    note.className = "empty-note";
    note.textContent = "Chạy Checkpoint 4 hoặc chọn attack_results.json để nạp danh sách.";
    list.append(note);
    renderAttackDetail();
    return;
  }
  state.attackIndex = Math.min(state.attackIndex, rows.length - 1);
  rows.forEach((row, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `attack-row${index === state.attackIndex ? " active" : ""}`;
    button.style.setProperty("--row-index", String(index));
    button.setAttribute("aria-pressed", String(index === state.attackIndex));
    const number = document.createElement("span");
    number.className = "attack-number";
    number.textContent = String(index + 1).padStart(2, "0");
    const name = document.createElement("span");
    name.className = "attack-name";
    name.textContent = categoryLabel(row, index);
    const badge = document.createElement("span");
    const status = attackState(row);
    badge.className = `attack-state ${status.className}`;
    badge.textContent = status.text;
    button.append(number, name, badge);
    button.addEventListener("click", () => {
      state.attackIndex = index;
      renderAttackList();
    });
    list.append(button);
  });
  renderAttackDetail();
}

function selectTarget(target) {
  state.target = target;
  state.attackIndex = 0;
  for (const tab of document.querySelectorAll(".agent-tab")) {
    const active = tab.dataset.target === target;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  }
  const panel = element("attack-panel");
  panel.setAttribute("aria-labelledby", target === "red" ? "tab-red" : "tab-advance");
  panel.classList.remove("panel-enter");
  void panel.offsetWidth;
  panel.classList.add("panel-enter");
  renderAttackList();
}

function renderReport() {
  const report = state.grade;
  setText("file-results", state.results ? "ĐÃ CÓ" : "THIẾU");
  setText("file-attacks", state.attacks ? "ĐÃ CÓ" : "THIẾU");
  setText("file-grade", report ? "ĐÃ CÓ" : "THIẾU");
  setText("provider-model", state.attacks ? `${state.attacks.llm_provider || "Chưa rõ"}:${state.attacks.llm_model || "Chưa rõ"}` : "—");
  setText("blue-model", state.results?.blue_model_used || "—");
  if (!report) {
    setText("report-status", "Chưa tải báo cáo chấm");
    setText("report-date", "—");
    return;
  }
  setText("report-status", report.technical_failure === false ? "Đã hoàn tất kiểm tra kỹ thuật" : "Có lỗi kỹ thuật được ghi nhận");
  const date = new Date(report.generated_at);
  setText("report-date", Number.isNaN(date.getTime()) ? "Chưa rõ" : date.toLocaleString("vi-VN"));
}

function renderAll(message) {
  renderSnapshot();
  renderScenarioPicker();
  renderAttackList();
  renderReport();
  const loaded = [state.results, state.attacks, state.grade].filter(Boolean).length;
  setText("load-status", message || (loaded ? `Đã tải ${loaded}/3 tệp artifact` : "Chưa có artifact. Hãy chọn các tệp JSON bên dưới."));
}

async function loadFromServer() {
  setText("load-status", "Đang tải artifact cục bộ…");
  const keys = Object.keys(artifactPaths);
  const responses = await Promise.allSettled(keys.map(async (key) => {
    const response = await fetch(artifactPaths[key], { cache: "no-store" });
    if (!response.ok) throw new Error(`${response.status}`);
    return response.json();
  }));
  responses.forEach((response, index) => {
    if (response.status === "fulfilled") state[keys[index]] = response.value;
  });
  const loaded = [state.results, state.attacks, state.grade].filter(Boolean).length;
  renderAll(loaded ? `Đã tải ${loaded}/3 tệp artifact` : "Mở qua máy chủ cục bộ hoặc chọn các tệp JSON bên dưới.");
}

async function loadSelectedFiles(files) {
  const names = {
    "results.json": "results",
    "attack_results.json": "attacks",
    "grade_report.json": "grade",
  };
  let imported = 0;
  let invalid = 0;
  for (const file of files) {
    const key = names[file.name];
    if (!key) continue;
    try {
      state[key] = JSON.parse(await file.text());
      imported += 1;
    } catch {
      invalid += 1;
    }
  }
  renderAll(invalid ? `Đã tải ${imported} tệp; không đọc được ${invalid} tệp JSON.` : `Đã tải ${imported} tệp artifact được chọn.`);
}

element("trace-button").addEventListener("click", renderScenario);
element("scenario-select").addEventListener("change", renderScenario);
element("reload-button").addEventListener("click", loadFromServer);
element("import-button").addEventListener("click", () => element("artifact-files").click());
element("artifact-files").addEventListener("change", (event) => loadSelectedFiles(event.target.files));
for (const tab of document.querySelectorAll(".agent-tab")) {
  tab.addEventListener("click", () => selectTarget(tab.dataset.target));
  tab.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = tab.dataset.target === "red" ? "advance" : "red";
    selectTarget(next);
    element(next === "red" ? "tab-red" : "tab-advance").focus();
  });
}

function initSectionMotion() {
  const sections = [...document.querySelectorAll(".reveal-on-scroll")];
  const canAnimate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches && "IntersectionObserver" in window;
  if (!canAnimate) {
    sections.forEach((section) => section.classList.add("is-visible"));
  } else {
    document.documentElement.classList.add("reveal-ready");
    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        revealObserver.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    sections.forEach((section) => revealObserver.observe(section));
  }

  if (!("IntersectionObserver" in window)) return;

  const navLinks = [...document.querySelectorAll('.site-nav a[href^="#"]')];
  const navObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      navLinks.forEach((link) => {
        if (link.getAttribute("href") === `#${entry.target.id}`) link.setAttribute("aria-current", "location");
        else link.removeAttribute("aria-current");
      });
    }
  }, { rootMargin: "-24% 0px -64% 0px", threshold: 0 });
  ["trace", "attacks", "evidence"].forEach((id) => {
    const section = element(id);
    if (section) navObserver.observe(section);
  });
}

initSectionMotion();
loadFromServer();
