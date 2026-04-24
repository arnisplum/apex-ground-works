(function () {
  var DEFAULT_TO = "quotes@apexgroundworks.com";
  var QUOTE_DRAFT_STORAGE_KEY = "apex_quote_draft_v1";
  var QUOTE_SUBMIT_RESULT_KEY = "apex_quote_submit_result_v1";
  var QUOTE_PREVIEW_PAGE = "quote-preview.html";

  function getQuoteSubmitUrl() {
    var b = document.body;
    if (!b) return "";
    var u = b.getAttribute("data-quote-submit-url");
    return typeof u === "string" ? u.trim() : "";
  }

  function getSupabaseConfig() {
    var b = document.body;
    if (!b) return { url: "", anonKey: "" };
    var submitUrl = getQuoteSubmitUrl();
    // Derive base URL from submit URL (strip path after the TLD)
    var baseUrl = "";
    if (submitUrl) {
      var m = submitUrl.match(/^(https?:\/\/[^/]+)/);
      if (m) baseUrl = m[1];
    }
    var anonKey = (b.getAttribute("data-supabase-anon-key") || "").trim();
    return { url: baseUrl, anonKey: anonKey };
  }

  function sanitizeStorageFilename(name) {
    // Replace characters that could cause issues in storage paths
    return String(name)
      .replace(/[^\w.\-]/g, "_")
      .slice(0, 200) || "file";
  }

  function uploadFileToStorage(file, pendingId, supabaseUrl, anonKey) {
    var safeName = sanitizeStorageFilename(file.name);
    var storagePath = pendingId + "/" + safeName;
    var uploadUrl = supabaseUrl + "/storage/v1/object/quote-attachments/" + storagePath;
    return fetch(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + anonKey,
        "Content-Type": file.type || "application/octet-stream",
        "x-upsert": "true",
      },
      body: file,
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          throw new Error("Upload failed (" + res.status + "): " + file.name + " — " + t);
        });
      }
      return storagePath;
    });
  }

  function uploadFilesWithProgress(files, pendingId, supabaseUrl, anonKey, onProgress) {
    var total = files.length;
    var done = 0;
    if (total === 0) return Promise.resolve([]);
    var paths = new Array(total).fill(null);
    var uploads = Array.from(files).map(function (file, idx) {
      return uploadFileToStorage(file, pendingId, supabaseUrl, anonKey).then(function (path) {
        paths[idx] = path;
        done += 1;
        if (onProgress) onProgress(done, total);
        return path;
      });
    });
    return Promise.all(uploads).then(function () {
      return paths.filter(Boolean);
    });
  }

  function draftToSubmitPayload(draft) {
    if (!draft || typeof draft !== "object") return null;
    var attachments = Array.isArray(draft.attachments) ? draft.attachments : [];
    var storagePaths = Array.isArray(draft.attachment_paths) ? draft.attachment_paths : [];
    // Build manifest: merge filenames with storage paths when available
    var manifest = attachments.map(function (name, idx) {
      var entry = { name: String(name) };
      if (storagePaths[idx]) entry.storage_path = String(storagePaths[idx]);
      return entry;
    });
    return {
      customer_name: String(draft.Name || "").trim(),
      customer_email: String(draft.Email || "").trim(),
      customer_phone: String(draft.Phone || "").trim(),
      project_address: String(draft["Project address"] || "").trim(),
      project_description: String(draft["Project description"] || "").trim(),
      project_type: String(draft["Project type"] || "").trim(),
      timing: String(draft["Timing"] || "").trim(),
      attachment_manifest: manifest,
    };
  }

  function parseQuoteSubmitResultFromStorage() {
    try {
      var raw = sessionStorage.getItem(QUOTE_SUBMIT_RESULT_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || typeof o !== "object") return null;
      return o;
    } catch (e) {
      return null;
    }
  }

  function openMailtoForDraft(rootEl, draft) {
    var body = quoteDraftToBodyString(draft);
    if (!body.trim()) return;
    var to = (rootEl && rootEl.getAttribute("data-mailto-to")) || DEFAULT_TO;
    var subject =
      (rootEl && rootEl.getAttribute("data-mailto-subject")) || "Apex Ground Works";
    var url =
      "mailto:" +
      encodeURIComponent(to) +
      "?subject=" +
      encodeURIComponent(subject) +
      "&body=" +
      encodeURIComponent(body);
    window.location.href = url;
  }

  function buildMailtoBodyFromFormData(form) {
    var fd = new FormData(form);
    var lines = [];
    fd.forEach(function (value, key) {
      if (typeof value === "string" && value.trim()) {
        lines.push(key + ": " + value.trim());
      }
    });
    form.querySelectorAll('input[type="file"]').forEach(function (input) {
      if (!input.files || !input.files.length) return;
      var maxF = parseInt(input.getAttribute("data-max-files") || "10", 10);
      if (!Number.isFinite(maxF) || maxF < 1) maxF = 10;
      var names = Array.from(input.files)
        .slice(0, maxF)
        .map(function (f) {
          return f.name;
        })
        .join(", ");
      lines.push(
        "Attachments (add these files in your email before sending): " + names
      );
    });
    return lines.join("\n");
  }

  function formToQuoteDraft(form) {
    var fd = new FormData(form);
    var draft = { attachments: [] };
    fd.forEach(function (value, key) {
      if (typeof value === "string") {
        draft[key] = value;
      }
    });
    form.querySelectorAll('input[type="file"]').forEach(function (input) {
      if (!input.files || !input.files.length) return;
      var maxF = parseInt(input.getAttribute("data-max-files") || "10", 10);
      if (!Number.isFinite(maxF) || maxF < 1) maxF = 10;
      Array.from(input.files)
        .slice(0, maxF)
        .forEach(function (f) {
          draft.attachments.push(f.name);
        });
    });
    return draft;
  }

  var QUOTE_MAILTO_FIELD_ORDER = [
    "Name",
    "Project address",
    "Phone",
    "Email",
    "Project description",
    "Project type",
    "Timing",
  ];

  function quoteDraftToBodyString(draft) {
    if (!draft || typeof draft !== "object") return "";
    var lines = [];
    QUOTE_MAILTO_FIELD_ORDER.forEach(function (key) {
      var v = draft[key];
      if (typeof v === "string" && v.trim()) {
        lines.push(key + ": " + v.trim());
      }
    });
    var att = draft.attachments;
    if (Array.isArray(att) && att.length) {
      lines.push(
        "Attachments (add these files in your email before sending): " + att.join(", ")
      );
    }
    return lines.join("\n");
  }

  function parseQuoteDraftFromStorage() {
    try {
      var raw = sessionStorage.getItem(QUOTE_DRAFT_STORAGE_KEY);
      if (!raw) return null;
      var draft = JSON.parse(raw);
      if (!draft || typeof draft !== "object") return null;
      if (!Array.isArray(draft.attachments)) draft.attachments = [];
      return draft;
    } catch (e) {
      return null;
    }
  }

  function quoteDraftLooksComplete(draft) {
    if (!draft) return false;
    return (
      String(draft.Name || "").trim() &&
      String(draft["Project address"] || "").trim() &&
      String(draft.Email || "").trim() &&
      String(draft["Project description"] || "").trim()
    );
  }

  function classifyAttachmentFile(file) {
    if (file.type.indexOf("image/") === 0) return "image";
    if (file.type.indexOf("video/") === 0) return "video";
    if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return "pdf";
    return "other";
  }

  function updateQuoteAttachmentUi(fileList) {
    var files = fileList ? Array.from(fileList) : [];
    var img = 0;
    var vid = 0;
    var pdf = 0;
    files.forEach(function (f) {
      var k = classifyAttachmentFile(f);
      if (k === "image") img += 1;
      else if (k === "video") vid += 1;
      else if (k === "pdf") pdf += 1;
    });
    var elI = document.getElementById("q-count-images");
    var elV = document.getElementById("q-count-videos");
    var elP = document.getElementById("q-count-pdfs");
    var st = document.getElementById("q-file-status");
    if (elI) elI.textContent = String(img);
    if (elV) elV.textContent = String(vid);
    if (elP) elP.textContent = String(pdf);
    if (st) {
      var n = files.length;
      if (n === 0) st.textContent = "No files selected.";
      else if (n === 1) st.textContent = "1 file selected.";
      else st.textContent = n + " files selected.";
    }
  }

  function pdfIconEl() {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 32 40");
    svg.setAttribute("class", "file-preview-pdf-icon");
    svg.setAttribute("aria-hidden", "true");
    var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("fill", "currentColor");
    path.setAttribute(
      "d",
      "M4 2h14l10 10v24a4 4 0 0 1-4 4H4V2zm4 4v28h20V16H14V6H8zm6 10h8v3h-8v-3zm0 7h8v3h-8v-3z"
    );
    svg.appendChild(path);
    return svg;
  }

  function wireAttachmentPreviews(input) {
    var gridId = input.getAttribute("data-file-previews-target");
    if (!gridId) return;
    var grid = document.getElementById(gridId);
    if (!grid) return;
    var blobUrls = [];

    input.addEventListener("change", function () {
      var hidePreviewNames = input.hasAttribute("data-hide-preview-names");
      var limitMsg = document.getElementById("q-attachment-limit-msg");
      if (limitMsg) {
        limitMsg.hidden = true;
        limitMsg.textContent = "";
      }

      blobUrls.forEach(function (u) {
        try {
          URL.revokeObjectURL(u);
        } catch (e) {}
      });
      blobUrls = [];
      grid.innerHTML = "";
      if (!input.files || !input.files.length) {
        grid.hidden = true;
        updateQuoteAttachmentUi([]);
        return;
      }

      var maxFiles = parseInt(input.getAttribute("data-max-files") || "10", 10);
      if (!Number.isFinite(maxFiles) || maxFiles < 1) maxFiles = 10;

      if (input.files.length > maxFiles) {
        try {
          var dt = new DataTransfer();
          Array.from(input.files)
            .slice(0, maxFiles)
            .forEach(function (f) {
              dt.items.add(f);
            });
          input.files = dt.files;
        } catch (err) {
          input.value = "";
          grid.hidden = true;
          updateQuoteAttachmentUi([]);
          if (limitMsg) {
            limitMsg.textContent =
              "Could not apply the file limit in this browser. Please add at most " +
              maxFiles +
              " files at once.";
            limitMsg.hidden = false;
          }
          return;
        }
        if (limitMsg) {
          limitMsg.textContent =
            "Only the first " + maxFiles + " files were kept (safety limit).";
          limitMsg.hidden = false;
        }
      }

      grid.hidden = false;

      Array.from(input.files).forEach(function (file) {
        var cell = document.createElement("div");
        cell.className = "file-preview-cell";
        var frame = document.createElement("div");
        frame.className = "file-preview-frame";
        cell.appendChild(frame);
        if (hidePreviewNames) {
          cell.setAttribute("aria-label", file.name);
          frame.title = file.name;
        } else {
          var nameEl = document.createElement("span");
          nameEl.className = "file-preview-name";
          nameEl.textContent = file.name;
          cell.appendChild(nameEl);
        }
        grid.appendChild(cell);

        var isImg = file.type.indexOf("image/") === 0;
        var isVid = file.type.indexOf("video/") === 0;
        var isPdf =
          file.type === "application/pdf" || /\.pdf$/i.test(file.name);

        if (isImg) {
          var u = URL.createObjectURL(file);
          blobUrls.push(u);
          var im = document.createElement("img");
          im.className = "file-preview-thumb";
          im.src = u;
          im.alt = "";
          frame.appendChild(im);
        } else if (isPdf) {
          frame.appendChild(pdfIconEl());
        } else if (isVid) {
          var uv = URL.createObjectURL(file);
          blobUrls.push(uv);
          var video = document.createElement("video");
          video.muted = true;
          video.playsInline = true;
          video.setAttribute("playsinline", "");
          video.preload = "auto";
          video.src = uv;
          video.style.cssText =
            "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none";
          frame.style.position = "relative";
          frame.appendChild(video);

          var finished = false;
          function cleanupVideoUrl() {
            var ix = blobUrls.indexOf(uv);
            if (ix >= 0) blobUrls.splice(ix, 1);
            try {
              URL.revokeObjectURL(uv);
            } catch (e2) {}
            video.removeAttribute("src");
            try {
              video.load();
            } catch (e3) {}
            if (video.parentNode) video.parentNode.removeChild(video);
          }
          function showPlayFallback() {
            if (finished) return;
            finished = true;
            frame.innerHTML = "";
            cleanupVideoUrl();
            var d = document.createElement("div");
            d.className = "file-preview-fallback file-preview-fallback--video";
            d.setAttribute("aria-hidden", "true");
            d.textContent = "▶";
            frame.appendChild(d);
          }

          video.addEventListener("loadeddata", function () {
            try {
              var dur = video.duration;
              var t =
                Number.isFinite(dur) && dur > 0
                  ? Math.min(0.35, dur * 0.06)
                  : 0.12;
              video.currentTime = t;
            } catch (err) {
              showPlayFallback();
            }
          });
          video.addEventListener("seeked", function onSeeked() {
            video.removeEventListener("seeked", onSeeked);
            if (finished) return;
            try {
              var c = document.createElement("canvas");
              var sz = 72;
              c.width = sz;
              c.height = sz;
              var ctx = c.getContext("2d");
              var vw = video.videoWidth;
              var vh = video.videoHeight;
              if (!vw || !vh) {
                showPlayFallback();
                return;
              }
              ctx.fillStyle = "#262422";
              ctx.fillRect(0, 0, sz, sz);
              var scale = Math.min(sz / vw, sz / vh);
              var dw = vw * scale;
              var dh = vh * scale;
              ctx.drawImage(video, (sz - dw) / 2, (sz - dh) / 2, dw, dh);
              var shot = document.createElement("img");
              shot.className = "file-preview-thumb";
              shot.alt = "";
              shot.src = c.toDataURL("image/jpeg", 0.82);
              frame.innerHTML = "";
              frame.appendChild(shot);
              finished = true;
              cleanupVideoUrl();
            } catch (err2) {
              showPlayFallback();
            }
          });
          video.addEventListener("error", showPlayFallback);
          setTimeout(function () {
            if (!finished) showPlayFallback();
          }, 3500);
        } else {
          var ext = (file.name.split(".").pop() || "?").toUpperCase().slice(0, 4);
          var fb = document.createElement("div");
          fb.className = "file-preview-fallback";
          fb.textContent = ext;
          frame.appendChild(fb);
        }
      });

      updateQuoteAttachmentUi(input.files);
    });
  }

  function handleForm(form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var body = buildMailtoBodyFromFormData(form);
      var to = form.getAttribute("data-mailto-to") || DEFAULT_TO;
      var subject = form.getAttribute("data-mailto-subject") || "Apex Ground Works";
      var url =
        "mailto:" +
        encodeURIComponent(to) +
        "?subject=" +
        encodeURIComponent(subject) +
        "&body=" +
        encodeURIComponent(body);
      window.location.href = url;
    });
  }

  var quoteStep1Form = document.querySelector("form[data-quote-step='1']");
  if (quoteStep1Form) {
    quoteStep1Form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!quoteStep1Form.checkValidity()) {
        quoteStep1Form.reportValidity();
        return;
      }

      var submitBtn = quoteStep1Form.querySelector(".quote-submit-btn");
      var draft = formToQuoteDraft(quoteStep1Form);

      // Collect File objects from the file input
      var fileInputEl = quoteStep1Form.querySelector('input[type="file"]');
      var files = fileInputEl && fileInputEl.files ? Array.from(fileInputEl.files) : [];

      var cfg = getSupabaseConfig();
      var canUpload = cfg.url && cfg.anonKey && files.length > 0;

      if (!canUpload) {
        // No upload configured or no files — proceed directly
        try {
          sessionStorage.setItem(QUOTE_DRAFT_STORAGE_KEY, JSON.stringify(draft));
        } catch (err) {}
        window.location.href = QUOTE_PREVIEW_PAGE;
        return;
      }

      // Generate a pending submission ID for the storage folder
      var pendingId;
      try {
        pendingId = crypto.randomUUID();
      } catch (err) {
        pendingId = "pending-" + Date.now() + "-" + Math.random().toString(36).slice(2);
      }

      // Show loading state on submit button
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.setAttribute("aria-busy", "true");
        submitBtn.textContent = "Uploading files… 0/" + files.length;
      }

      var statusEl = document.getElementById("q-file-status");
      if (statusEl) {
        statusEl.textContent = "Uploading files… 0/" + files.length;
      }

      uploadFilesWithProgress(
        files,
        pendingId,
        cfg.url,
        cfg.anonKey,
        function (done, total) {
          if (submitBtn) submitBtn.textContent = "Uploading files… " + done + "/" + total;
          if (statusEl) statusEl.textContent = "Uploading files… " + done + "/" + total;
        }
      )
        .then(function (paths) {
          draft.attachment_paths = paths;
          try {
            sessionStorage.setItem(QUOTE_DRAFT_STORAGE_KEY, JSON.stringify(draft));
          } catch (err) {}
          window.location.href = QUOTE_PREVIEW_PAGE;
        })
        .catch(function (err) {
          // Upload failed — proceed without paths, showing a warning
          console.warn("File upload warning:", err);
          try {
            sessionStorage.setItem(QUOTE_DRAFT_STORAGE_KEY, JSON.stringify(draft));
          } catch (err2) {}
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.removeAttribute("aria-busy");
            submitBtn.textContent = "Generate project summary →";
          }
          if (statusEl) {
            statusEl.textContent =
              "File upload failed — you can still submit your details without attachments, or try again.";
          }
          // Ask user if they want to continue without uploads
          if (window.confirm("File upload failed. Continue without uploading files?")) {
            window.location.href = QUOTE_PREVIEW_PAGE;
          }
        });
    });
  }

  var quotePreviewRoot = document.getElementById("quote-preview");
  if (quotePreviewRoot) {
    var warnEl = document.getElementById("quote-preview-warning");
    var submitBtn = document.getElementById("quote-preview-submit");
    var emailCopyBtn = document.getElementById("quote-preview-email-copy");
    var downloadBtn = document.getElementById("quote-preview-download");
    var printBtn = document.getElementById("quote-preview-print");
    var draft = parseQuoteDraftFromStorage();
    var submitUrl = getQuoteSubmitUrl();

    function buildSummaryText(result) {
      var lines = [];
      var d = parseQuoteDraftFromStorage() || {};
      lines.push("Apex Ground Works — Smart Quote Summary");
      lines.push("Generated: " + new Date().toLocaleDateString("en-CA", {
        year: "numeric", month: "long", day: "numeric"
      }));
      lines.push("");
      if (d.Name) lines.push("Name: " + d.Name);
      if (d["Project address"]) lines.push("Address: " + d["Project address"]);
      if (d.Email) lines.push("Email: " + d.Email);
      if (d.Phone) lines.push("Phone: " + d.Phone);
      if (d["Project type"]) lines.push("Project type: " + d["Project type"]);
      if (d["Timing"]) lines.push("Timing: " + d["Timing"]);
      lines.push("");
      lines.push("Project description:");
      lines.push(d["Project description"] || "");
      if (result && result.ai_summary) {
        lines.push("");
        lines.push("AI Project Summary:");
        lines.push(result.ai_summary);
      }
      var att = Array.isArray(d.attachments) ? d.attachments : [];
      if (att.length) {
        lines.push("");
        lines.push("Attachments: " + att.join(", "));
      }
      return lines.join("\n");
    }

    function downloadSummaryAsText(result) {
      var text = buildSummaryText(result);
      var blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "apex-smart-quote-summary.txt";
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        if (a.parentNode) a.parentNode.removeChild(a);
        URL.revokeObjectURL(url);
      }, 1000);
    }

    function applyQuotePreviewSuccess(result) {
      if (submitBtn) submitBtn.removeAttribute("aria-busy");
      var titleEl = document.getElementById("quote-preview-panel-title");
      var textEl = document.getElementById("quote-preview-ai");
      var introEl = quotePreviewRoot.querySelector(".quote-card-intro");
      if (titleEl) titleEl.textContent = "Project summary";
      if (textEl) {
        textEl.textContent =
          (result && result.ai_summary) ||
          "Your request was saved. We will follow up with clear next steps.";
      }
      if (introEl) {
        introEl.textContent =
          "Review the AI summary below. Download or print a copy for your records.";
      }
      var foot = quotePreviewRoot.querySelector(".quote-form-footnote");
      if (foot) {
        foot.textContent =
          "Your request is on file with us. Email is optional — use it if you prefer a copy in your sent folder. Re-attach files in your mail app if needed.";
      }
      if (submitBtn) {
        submitBtn.hidden = true;
        submitBtn.disabled = true;
      }
      if (emailCopyBtn) emailCopyBtn.hidden = false;
      if (downloadBtn) {
        downloadBtn.hidden = false;
        downloadBtn.addEventListener("click", function () {
          downloadSummaryAsText(result);
        });
      }
      if (printBtn) {
        printBtn.hidden = false;
        printBtn.addEventListener("click", function () {
          window.print();
        });
      }
      if (warnEl) warnEl.hidden = true;
    }

    function hydrateQuotePreviewFromStorage() {
      var saved = parseQuoteSubmitResultFromStorage();
      if (!saved || !saved.id) return;
      if (!quoteDraftLooksComplete(draft)) return;
      applyQuotePreviewSuccess(saved);
    }

    if (!quoteDraftLooksComplete(draft)) {
      if (warnEl) {
        warnEl.hidden = false;
        warnEl.textContent =
          "Nothing to submit yet. Go back to project details to add your information.";
      }
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.setAttribute("aria-disabled", "true");
      }
    } else {
      hydrateQuotePreviewFromStorage();
      if (submitBtn && submitUrl) {
        submitBtn.textContent = "Submit request";
      }
    }

    if (emailCopyBtn) {
      emailCopyBtn.addEventListener("click", function (e) {
        e.preventDefault();
        var d = parseQuoteDraftFromStorage();
        if (!d) return;
        openMailtoForDraft(quotePreviewRoot, d);
      });
    }

    if (submitBtn && quoteDraftLooksComplete(draft)) {
      submitBtn.addEventListener("click", function () {
        var d = parseQuoteDraftFromStorage();
        if (!d) return;
        if (!submitUrl) {
          openMailtoForDraft(quotePreviewRoot, d);
          return;
        }
        var payload = draftToSubmitPayload(d);
        if (
          !payload ||
          !payload.customer_name ||
          !payload.customer_email ||
          !payload.project_address ||
          !payload.project_description
        ) {
          return;
        }
        submitBtn.disabled = true;
        submitBtn.setAttribute("aria-busy", "true");
        if (warnEl) {
          warnEl.hidden = true;
          warnEl.textContent = "";
        }
        fetch(submitUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
          .then(function (res) {
            return res.json().then(function (data) {
              return { ok: res.ok, status: res.status, data: data };
            });
          })
          .then(function (out) {
            if (!out.ok) {
              var msg =
                (out.data && out.data.error) ||
                "Could not submit. Check your connection or try the email option.";
              throw new Error(msg);
            }
            try {
              sessionStorage.setItem(
                QUOTE_SUBMIT_RESULT_KEY,
                JSON.stringify(out.data),
              );
            } catch (err) {}
            applyQuotePreviewSuccess(out.data);
          })
          .catch(function (err) {
            if (warnEl) {
              warnEl.hidden = false;
              warnEl.textContent =
                (err && err.message) ||
                "Could not submit. You can still send your details by email.";
            }
            submitBtn.disabled = false;
            submitBtn.removeAttribute("aria-busy");
          });
      });
    }
  }

  document.querySelectorAll("form[data-mailto-form]").forEach(handleForm);
  document.querySelectorAll("input[data-file-previews-target]").forEach(wireAttachmentPreviews);

  /* Project gallery lightbox */
  var lb = document.getElementById("gallery-lightbox");
  if (lb) {
    var lbWebp = document.getElementById("lightbox-webp");
    var lbImg = document.getElementById("lightbox-img");
    var lbClose = lb.querySelector(".lightbox__close");
    var lbPanel = lb.querySelector(".lightbox__panel");

    function closeLightbox() {
      lb.hidden = true;
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    }

    function onKey(e) {
      if (e.key === "Escape") closeLightbox();
    }

    function openLightbox(btn) {
      var w = btn.getAttribute("data-lightbox-webp");
      var j = btn.getAttribute("data-lightbox-jpg");
      var alt = btn.getAttribute("data-lightbox-alt") || "";
      if (w) {
        lbWebp.setAttribute("srcset", w);
      } else {
        lbWebp.removeAttribute("srcset");
      }
      lbImg.src = j || "";
      lbImg.alt = alt;
      lb.hidden = false;
      document.body.style.overflow = "hidden";
      document.addEventListener("keydown", onKey);
      if (lbClose) lbClose.focus();
    }

    lb.addEventListener("click", function (e) {
      if (e.target === lb) closeLightbox();
    });
    if (lbPanel) {
      lbPanel.addEventListener("click", function () {
        closeLightbox();
      });
    }

    document.querySelectorAll(".gallery-item[data-lightbox-jpg]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openLightbox(btn);
      });
    });
  }

  var loopCorner = document.querySelector(".landing-loop-video__media");
  if (loopCorner && typeof loopCorner.play === "function") {
    loopCorner.play().catch(function () {});
  }
})();
