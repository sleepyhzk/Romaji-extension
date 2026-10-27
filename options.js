const $ = id => document.getElementById(id);
const radios = [...document.querySelectorAll('input[name="p"]')];

function norm(s) {
  return s.toLowerCase().replace(/[.,!?;:“”"()~〜～]/g, " ").replace(/\s+/g, " ").trim();
}

function parseVocab(text) {
  const map = {};
  let n = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\t|=|\||;|,/).map(x => x.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    const romaji = parts[parts.length - 1];
    for (const vi of parts[0].split("/")) {
      const key = norm(vi);
      if (key) { map[key] = romaji; n++; }
    }
  }
  return { map, n };
}

function sync() {
  $("keybox").style.display = radios.find(r => r.checked).value === "claude" ? "block" : "none";
}
function count() {
  $("cnt").textContent = parseVocab($("v").value).n + " từ";
}
radios.forEach(r => r.addEventListener("change", sync));
$("v").addEventListener("input", count);

chrome.storage.local.get(["apiKey", "provider", "vocabText", "vocabOnly", "hidePopup"]).then(d => {
  if (d.apiKey) $("k").value = d.apiKey;
  if (d.vocabText) $("v").value = d.vocabText;
  $("vo").checked = !!d.vocabOnly;
  $("hp").checked = !!d.hidePopup;
  radios.forEach(r => (r.checked = r.value === (d.provider === "claude" ? "claude" : "google")));
  sync();
  count();
});

$("imp").addEventListener("click", () => $("f").click());
$("f").addEventListener("change", () => {
  const file = $("f").files[0];
  if (!file) return;
  const rd = new FileReader();
  rd.onload = () => {
    const cur = $("v").value.trim();
    $("v").value = (cur ? cur + "\n" : "") + String(rd.result).trim();
    count();
  };
  rd.readAsText(file, "UTF-8");
  $("f").value = "";
});

$("s").addEventListener("click", async () => {
  const { map, n } = parseVocab($("v").value);
  await chrome.storage.local.set({
    apiKey: $("k").value.trim(),
    provider: radios.find(r => r.checked).value,
    vocab: map,
    vocabText: $("v").value,
    vocabOnly: $("vo").checked,
    hidePopup: $("hp").checked
  });
  $("st").textContent = "Đã lưu " + n + " từ";
  setTimeout(() => ($("st").textContent = ""), 2000);
});
