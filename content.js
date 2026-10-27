(() => {
  if (window.__romajiPopupLoaded) return;
  window.__romajiPopupLoaded = true;

  const host = document.createElement("div");
  host.style.cssText = "all:initial;position:absolute;top:0;left:0;z-index:2147483647;";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
    <style>
      #pop{position:absolute;display:none;width:max-content;max-width:260px;background:#1f6fa3;color:#fff;
        font:600 13px/1 system-ui,-apple-system,"Segoe UI",sans-serif;
        padding:6px 10px;border-radius:7px;box-shadow:0 4px 14px rgba(0,0,0,.3);
        white-space:nowrap;user-select:none;-webkit-user-select:none;}
      #pop::before{content:"";position:absolute;top:-4px;left:var(--ax,12px);
        width:8px;height:8px;background:inherit;transform:rotate(45deg);border-radius:1px;}
      #pop.done{background:#1a9d5b}
      #pop.err{background:#c0392b;white-space:normal;line-height:1.4;font-weight:500}
    </style>
    <div id="pop"></div>`;
  const pop = root.getElementById("pop");
  document.documentElement.appendChild(host);

  let hidden = false;           // chế độ ẩn popup
  let cur = null;               // romaji đã có
  let err = null;               // lỗi (nếu có)
  let pending = false;          // đang chờ kết quả
  let copyWhenReady = false;    // đã nhấn chuột phải trong lúc chờ
  let armed = false;            // đang có vùng bôi đen hợp lệ
  let anchor = null;            // vị trí hiện popup (tọa độ trang)
  let reqId = 0;

  chrome.storage.local.get("hidePopup").then(d => { hidden = !!d.hidePopup; });
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === "local" && c.hidePopup) hidden = !!c.hidePopup.newValue;
  });

  const visible = () => pop.style.display === "block";
  const hide = () => {
    pop.style.display = "none";
    cur = null; err = null; pending = false; copyWhenReady = false; armed = false;
    reqId++;
  };

  function place(a) {
    pop.style.display = "block";
    const w = pop.offsetWidth, vw = document.documentElement.clientWidth;
    const left = Math.max(8 + window.scrollX, Math.min(a.cx - w / 2, window.scrollX + vw - w - 8));
    pop.style.left = left + "px";
    pop.style.top = a.bottom + 8 + "px";
    pop.style.setProperty("--ax", Math.max(6, Math.min(a.cx - left - 4, w - 14)) + "px");
  }

  function show(text, a, cls) {
    pop.className = cls || "";
    pop.textContent = text;
    place(a);
  }

  function copy(text) {
    const done = () => {
      if (hidden) return; // chế độ ẩn: chép im lặng, không hiện gì
      show("Đã chép", anchor, "done");
      setTimeout(() => { if (cur === text) show(text, anchor); }, 900);
    };
    navigator.clipboard.writeText(text).then(done).catch(() => {
      const t = document.createElement("textarea");
      t.value = text;
      document.body.appendChild(t);
      t.select();
      try { document.execCommand("copy"); } catch (e) {}
      t.remove();
      done();
    });
  }

  function handleSelection() {
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : "";
    if (!text || text.length > 100 || !sel.rangeCount) return hide();
    const r = sel.getRangeAt(0).getBoundingClientRect();
    if (!r.width && !r.height) return hide();

    anchor = { cx: r.left + r.width / 2 + window.scrollX, bottom: r.bottom + window.scrollY };
    cur = null; err = null; pending = true; copyWhenReady = false; armed = true;
    const id = ++reqId;
    if (hidden) pop.style.display = "none"; else show("…", anchor);

    const finish = resp => {
      if (id !== reqId) return;
      pending = false;
      if (chrome.runtime.lastError || !resp) err = "Tải lại trang rồi thử lại";
      else if (resp.none) return hide();
      else if (resp.error) err = resp.error;
      else cur = resp.romaji;

      if (err) { if (!hidden || copyWhenReady) show(err, anchor, "err"); return; }
      if (copyWhenReady) { copyWhenReady = false; copy(cur); return; }
      if (!hidden) show(cur, anchor);
    };
    try {
      chrome.runtime.sendMessage({ type: "romaji", text }, finish);
    } catch (e) {
      pending = false;
      err = "Tải lại trang rồi thử lại";
      if (!hidden) show(err, anchor, "err");
    }
  }

  document.addEventListener("mouseup", e => {
    if (e.button !== 0 || e.composedPath().includes(host)) return;
    setTimeout(handleSelection, 0);
  }, true);

  document.addEventListener("mousedown", e => {
    if (e.button === 0) hide();
  }, true);

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") hide();
  }, true);

  // Nhấn chuột phải 1 lần để chép romaji (chặn menu chuột phải khi đang có từ được tra)
  document.addEventListener("contextmenu", e => {
    if (hidden) {
      const s = window.getSelection();
      if (!armed || !s || !s.toString().trim()) return;
    } else if (!cur || !visible()) {
      return;
    }
    e.preventDefault();
    if (cur) copy(cur);
    else if (pending) copyWhenReady = true;
    else if (err) show(err, anchor, "err");
  }, true);
})();
