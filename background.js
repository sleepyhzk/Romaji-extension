// Hai nguồn: "google" (miễn phí, không cần key) và "claude" (cần API key, romaji chuẩn hơn).
const MODEL = "claude-haiku-5-5";

const SYSTEM = [
  "Bạn dịch tiếng Việt sang tiếng Nhật tự nhiên, rồi viết cách đọc bằng romaji.",
  "Romaji phải là kiểu gõ được bằng bàn phím IME: chữ thường, không dấu gạch trên,",
  "trường âm viết theo kana (おう = ou, えい = ei), trợ từ は = ha, を = wo, へ = he,",
  "ん = n, cách nhau bằng dấu cách theo từ.",
  'Chỉ trả về đúng một JSON: {"romaji":"..."} và không thêm gì khác.'
].join(" ");

async function getCache() {
  const { cache } = await chrome.storage.local.get("cache");
  return cache || {};
}

// ---------- Google Dịch (miễn phí) ----------
function cleanRomaji(s) {
  const map = { "ā": "aa", "ī": "ii", "ū": "uu", "ē": "ee", "ō": "ou", "Ā": "aa", "Ī": "ii", "Ū": "uu", "Ē": "ee", "Ō": "ou" };
  return s.replace(/[āīūēōĀĪŪĒŌ]/g, c => map[c]).replace(/['’]/g, "").toLowerCase().trim();
}

async function translateGoogle(text) {
  const url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=vi&tl=ja&dt=t&dt=rm&q=" +
    encodeURIComponent(text);
  let res;
  try { res = await fetch(url); } catch (e) { throw new Error("Không kết nối được Google Dịch."); }
  if (res.status === 429) throw new Error("Google tạm chặn vì gọi quá nhiều, thử lại sau.");
  if (!res.ok) throw new Error("Google Dịch lỗi " + res.status);

  const data = await res.json();
  const segs = Array.isArray(data[0]) ? data[0] : [];
  const japanese = segs.filter(s => typeof s[0] === "string").map(s => s[0]).join("");
  // Đoạn chứa romaji của bản dịch: phần tử đầu là null, phần tử thứ 3 là chuỗi
  const ro = segs.filter(s => s[0] == null && typeof s[2] === "string").map(s => s[2]).join(" ");
  const romaji = cleanRomaji(ro) || japanese;
  if (!romaji) throw new Error("Không có kết quả.");
  return romaji;
}

// ---------- Claude (cần API key) ----------
async function translateClaude(text) {
  const { apiKey } = await chrome.storage.local.get("apiKey");
  if (!apiKey) throw new Error("Chưa có API key. Bấm icon extension để nhập, hoặc chuyển sang Google Dịch.");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 150,
      system: SYSTEM,
      messages: [{ role: "user", content: text }]
    })
  });
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401) throw new Error("API key không đúng.");
    const m = (data.error && data.error.message) || "";
    if (/credit balance/i.test(m)) throw new Error("Hết credit API. Nạp thêm ở Plans & Billing trong Console.");
    throw new Error(m || "Lỗi " + res.status);
  }
  const raw = data.content.map(b => b.text || "").join("").replace(/```json|```/g, "").trim();
  let romaji;
  try { romaji = JSON.parse(raw).romaji; } catch (e) { romaji = raw; }
  if (!romaji) throw new Error("Không có kết quả.");
  return romaji;
}

// ---------- Từ vựng của bạn (ưu tiên số 1) ----------
function norm(s) {
  return s.toLowerCase().replace(/[.,!?;:“”"()~〜～]/g, " ").replace(/\s+/g, " ").trim();
}

async function fromVocab(text) {
  const { vocab } = await chrome.storage.local.get("vocab");
  if (!vocab) return null;
  const get = k => (Object.prototype.hasOwnProperty.call(vocab, k) ? vocab[k] : null);
  const t = norm(text);
  const whole = get(t);
  if (whole) return whole;
  // Câu dài: ghép từ cụm dài nhất trước, chỉ nhận khi mọi từ đều có trong từ vựng
  const words = t.split(" ");
  const out = [];
  let i = 0;
  while (i < words.length) {
    let hit = null, len = 0;
    for (let n = Math.min(6, words.length - i); n >= 1; n--) {
      const r = get(words.slice(i, i + n).join(" "));
      if (r) { hit = r; len = n; break; }
    }
    if (!hit) return null;
    out.push(hit);
    i += len;
  }
  return out.join(" ");
}

// Chuẩn hóa romaji để gõ khớp đáp án: ん cuối từ phải gõ "nn", và bỏ khoảng trắng (tiếng Nhật viết liền)
function finish(r) {
  return r.trim().split(/\s+/).map(w => w.replace(/(?<!n)n$/, "nn")).join("");
}

async function translate(text) {
  const v = await fromVocab(text);
  if (v) return v;
  const { provider, vocabOnly } = await chrome.storage.local.get(["provider", "vocabOnly"]);
  if (vocabOnly) return null;
  const p = provider === "claude" ? "claude" : "google";
  const key = p + ":" + text.toLowerCase();
  const cache = await getCache();
  if (cache[key]) return cache[key];

  const romaji = p === "claude" ? await translateClaude(text) : await translateGoogle(text);

  const keys = Object.keys(cache);
  if (keys.length >= 200) delete cache[keys[0]];
  cache[key] = romaji;
  await chrome.storage.local.set({ cache });
  return romaji;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "romaji") {
    translate(msg.text)
      .then(r => (r ? finish(r) : r))
      .then(romaji => sendResponse(romaji ? { romaji } : { none: true }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
