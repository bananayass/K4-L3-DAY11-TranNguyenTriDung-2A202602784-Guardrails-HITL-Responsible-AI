"use strict";

const $ = (selector) => document.querySelector(selector);
const form = $("#chat-form");
const input = $("#message-input");
const log = $("#chat-log");
const sendButton = $("#send-button");
let sessionId = null;

function appendMessage(kind, label, text, result = "") {
  const article = document.createElement("article");
  article.className = `message ${kind}-message`;
  if (result) article.dataset.result = result;
  const role = document.createElement("span");
  role.className = "message-role";
  role.textContent = label;
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  article.append(role, paragraph);
  log.append(article);
  log.scrollTop = log.scrollHeight;
}

function setStatus(state, message) {
  const status = $("#server-status");
  status.dataset.state = state;
  status.querySelector("span").textContent = message;
}

function showDecision(data) {
  const box = $("#decision-box");
  const state = data.blocked ? "block" : "allow";
  box.dataset.state = state;
  $("#decision-mark").textContent = data.blocked ? "×" : "✓";
  $("#decision-title").textContent = data.blocked ? "Guardrail đã chặn câu hỏi" : "Đã qua các bước kiểm tra";
  $("#input-result").textContent = data.input || (data.blocked ? "Đã chặn" : "Đã qua");
  $("#input-result").dataset.state = data.blocked ? "block" : "allow";
  $("#model-result").textContent = data.model_called ? "OpenAI · đã gọi" : "Không gọi";
  $("#output-result").textContent = data.output || (data.model_called ? "Đã kiểm tra" : "Không chạy");
  $("#output-result").dataset.state = data.output_blocked ? "block" : data.model_called ? "allow" : "";
  $("#decision-explanation").textContent = data.reason || "Input đã qua CP2; câu trả lời OpenAI đã được lọc trước khi hiển thị.";
}

async function checkServer() {
  try {
    const response = await fetch("/api/status", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Backend chưa sẵn sàng.");
    setStatus(data.api_key_configured ? "ready" : "missing-key", data.api_key_configured ? "OPENAI ĐÃ SẴN SÀNG" : "THIẾU OPENAI API KEY");
    $("#model-label").textContent = data.model || "OPENAI";
    if (!data.api_key_configured) {
      $("#chat-error").textContent = "Backend chưa tìm thấy OPENAI_API_KEY trong file .env.";
      $("#chat-error").hidden = false;
    }
  } catch {
    setStatus("offline", "BACKEND CHƯA CHẠY");
    $("#model-label").textContent = "CHƯA KẾT NỐI";
    $("#chat-error").textContent = "Hãy chạy .venv/bin/python chat/server.py từ gốc repo, rồi tải lại trang.";
    $("#chat-error").hidden = false;
  }
}

async function sendMessage(message) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, session_id: sessionId }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Không gửi được câu hỏi.");
    error.status = response.status;
    error.detail = data.detail;
    throw error;
  }
  sessionId = data.session_id;
  return data;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = input.value.trim();
  if (!message || sendButton.disabled) return;

  $("#chat-error").hidden = true;
  appendMessage("user", "BẠN", message);
  input.value = "";
  $("#char-count").textContent = "0 / 2000 ký tự · Enter để gửi";
  sendButton.disabled = true;
  sendButton.innerHTML = 'Đang xử lý <span aria-hidden="true">…</span>';
  const pending = document.createElement("article");
  pending.className = "message assistant-message pending-message";
  pending.setAttribute("aria-live", "polite");
  pending.textContent = "Đang kiểm tra guardrail và chờ mô hình trả lời…";
  log.append(pending);
  log.scrollTop = log.scrollHeight;

  try {
    const data = await sendMessage(message);
    pending.remove();
    showDecision(data.guardrails);
    appendMessage("assistant", "VINBANK · OPENAI SAU GUARDRAIL", data.reply, data.guardrails.blocked ? "block" : "allow");
    if (data.guardrails.output_blocked) {
      appendMessage("result", "KIỂM TRA ĐẦU RA", "Phản hồi có nội dung nhạy cảm đã được lọc trước khi gửi đến bạn.", "block");
    }
  } catch (error) {
    pending.remove();
    $("#chat-error").textContent = error.message;
    $("#chat-error").hidden = false;
    if (error.detail) appendMessage("result", "LỖI MÔ HÌNH", error.detail, "block");
  } finally {
    sendButton.disabled = false;
    sendButton.innerHTML = 'Gửi câu hỏi <span aria-hidden="true">→</span>';
    input.focus();
  }
});

input.addEventListener("input", () => {
  $("#char-count").textContent = `${Array.from(input.value).length} / 2000 ký tự · Enter để gửi`;
});
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

$("#clear-button").addEventListener("click", async () => {
  if (sessionId) {
    try {
      await fetch("/api/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });
    } catch { /* The next message starts a fresh server session. */ }
  }
  sessionId = null;
  log.replaceChildren();
  appendMessage("assistant", "VINBANK · OPENAI SAU GUARDRAIL", "Cuộc chat mới đã sẵn sàng. Hãy nhập câu hỏi ngân hàng.");
  showDecision({ blocked: false, model_called: false, input: "Chưa chạy", output: "Chưa chạy", reason: "Mỗi câu trả lời sẽ hiển thị kết quả kiểm tra đầu vào và đầu ra." });
  $("#decision-box").dataset.state = "idle";
  $("#decision-mark").textContent = "—";
  $("#decision-title").textContent = "Đang chờ tin nhắn";
});

for (const button of document.querySelectorAll("[data-sample]")) {
  button.addEventListener("click", () => {
    input.value = button.dataset.sample;
    input.dispatchEvent(new Event("input"));
    input.focus();
  });
}

checkServer();
