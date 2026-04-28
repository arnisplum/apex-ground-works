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

  function draftToSubmitPayload(draft) {
    if (!draft || typeof draft !== "object") return null;
    var attachments = Array.isArray(draft.attachments) ? draft.attachments : [];
    return {
      customer_name: String(draft.Name || "").trim(),
      customer_email: String(draft.Email || "").trim(),
      customer_phone: String(draft.Phone || "").trim(),
      project_address: String(draft["Project address"] || "").trim(),
      project_description: String(draft["Project description"] || "").trim(),
      project_type: String(draft["Project type"] || "").trim(),
      timing: String(draft["Timing"] || "").trim(),
      attachment_manifest: attachments.map(function (name) {
        return { name: String(name) };
      }),
    };
  }

  function draftToSubmitFormData(draft, form) {
    var payload = draftToSubmitPayload(draft);
    if (!payload) return null;
    var fd = new FormData();
    Object.keys(payload).forEach(function (key) {
      if (key === "attachment_manifest") {
        fd.append(key, JSON.stringify(payload[key] || []));
        return;
      }
      fd.append(key, payload[key] || "");
    });
    if (form) {
      form.querySelectorAll('input[type="file"]').forEach(function (input) {
        if (!input.files || !input.files.length) return;
        var maxF = parseInt(input.getAttribute("data-max-files") || "10", 10);
        if (!Number.isFinite(maxF) || maxF < 1) maxF = 10;
        Array.from(input.files)
          .slice(0, maxF)
          .forEach(function (file) {
            fd.append("attachments", file, file.name);
          });
      });
    }
    return fd;
  }

  function parseQuoteResponse(res) {
    return res.text().then(function (text) {
      var data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch (err) {
        data = { error: text || "Unexpected response from quote service." };
      }
      return { ok: res.ok, status: res.status, data: data };
    });
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
    var draft = { attachments: [], attachmentPreviews: [] };
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

  function isPreviewableImageFile(file) {
    if (!file) return false;
    var type = String(file.type || "");
    var name = String(file.name || "");
    return type.indexOf("image/") === 0 || /\.(jpe?g|png|webp|gif)$/i.test(name);
  }

  function imageFileToPreview(file) {
    return new Promise(function (resolve) {
      if (!isPreviewableImageFile(file)) {
        resolve(null);
        return;
      }
      var url = "";
      var settled = false;
      var timer = window.setTimeout(function () {
        if (settled) return;
        settled = true;
        try {
          if (url) URL.revokeObjectURL(url);
        } catch (e) {}
        resolve(null);
      }, 2500);
      function finish(value) {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        try {
          if (url) URL.revokeObjectURL(url);
        } catch (e) {}
        resolve(value);
      }
      try {
        url = URL.createObjectURL(file);
      } catch (e) {
        finish(null);
        return;
      }
      var img = new Image();
      img.onload = function () {
        try {
          var maxW = 900;
          var maxH = 680;
          var scale = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);
          var w = Math.max(1, Math.round(img.naturalWidth * scale));
          var h = Math.max(1, Math.round(img.naturalHeight * scale));
          var canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          var ctx = canvas.getContext("2d");
          if (!ctx) {
            resolve(null);
            return;
          }
          ctx.drawImage(img, 0, 0, w, h);
          finish({
            name: file.name,
            type: file.type,
            src: canvas.toDataURL("image/jpeg", 0.7),
          });
        } catch (e) {
          finish(null);
        }
      };
      img.onerror = function () {
        finish(null);
      };
      img.src = url;
    });
  }

  function addAttachmentPreviewsToDraft(form, draft) {
    if (!form || !draft) return Promise.resolve(draft);
    var files = [];
    form.querySelectorAll('input[type="file"]').forEach(function (input) {
      if (!input.files || !input.files.length) return;
      Array.from(input.files)
        .slice(0, 6)
        .forEach(function (file) {
          files.push(file);
        });
    });
    return Promise.all(files.map(imageFileToPreview)).then(function (previews) {
      draft.attachmentPreviews = previews.filter(Boolean);
      return draft;
    });
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

  function clearQuoteSubmitResult() {
    try {
      sessionStorage.removeItem(QUOTE_SUBMIT_RESULT_KEY);
    } catch (e) {}
  }

  function hydrateQuoteFormFromDraft(form) {
    var draft = parseQuoteDraftFromStorage();
    if (!draft) return;
    QUOTE_MAILTO_FIELD_ORDER.forEach(function (key) {
      var field = form.elements[key];
      if (!field || typeof draft[key] !== "string") return;
      field.value = draft[key];
    });
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
    var type = String((file && file.type) || "");
    var name = String((file && file.name) || "");
    if (type.indexOf("image/") === 0 || /\.(jpe?g|png|webp|gif)$/i.test(name)) {
      return "image";
    }
    if (type.indexOf("video/") === 0 || /\.(mp4|mov|webm)$/i.test(name)) return "video";
    if (type === "application/pdf" || /\.pdf$/i.test(name)) return "pdf";
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
    hydrateQuoteFormFromDraft(quoteStep1Form);
    var step1SubmitUrl = getQuoteSubmitUrl();
    var step1SubmitBtn = quoteStep1Form.querySelector(".quote-submit-btn");
    var step1DefaultText = step1SubmitBtn ? step1SubmitBtn.textContent : "";
    quoteStep1Form.addEventListener("input", clearQuoteSubmitResult);
    quoteStep1Form.addEventListener("change", clearQuoteSubmitResult);
    quoteStep1Form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!quoteStep1Form.checkValidity()) {
        quoteStep1Form.reportValidity();
        return;
      }
      var initialDraft = formToQuoteDraft(quoteStep1Form);
      if (step1SubmitUrl) {
        if (step1SubmitBtn) {
          step1SubmitBtn.disabled = true;
          step1SubmitBtn.setAttribute("aria-busy", "true");
          step1SubmitBtn.textContent = "Saving request…";
        }
        addAttachmentPreviewsToDraft(quoteStep1Form, initialDraft)
          .then(function (formDraft) {
            try {
              sessionStorage.setItem(
                QUOTE_DRAFT_STORAGE_KEY,
                JSON.stringify(formDraft),
              );
              clearQuoteSubmitResult();
            } catch (err) {}
            var body = draftToSubmitFormData(formDraft, quoteStep1Form);
            if (!body) throw new Error("Could not prepare your quote request.");
            return fetch(step1SubmitUrl, {
              method: "POST",
              body: body,
            }).then(function (res) {
              return parseQuoteResponse(res).then(function (out) {
                return { out: out, formDraft: formDraft };
              });
            });
          })
          .then(function (out) {
            if (!out.out.ok) {
              throw new Error(
                (out.out.data && out.out.data.error) ||
                  "Could not save your quote request. Please try again.",
              );
            }
            try {
              sessionStorage.setItem(
                QUOTE_DRAFT_STORAGE_KEY,
                JSON.stringify(out.formDraft),
              );
              sessionStorage.setItem(
                QUOTE_SUBMIT_RESULT_KEY,
                JSON.stringify(out.out.data),
              );
            } catch (err) {}
            window.location.href = QUOTE_PREVIEW_PAGE;
          })
          .catch(function (err) {
            window.alert(
              (err && err.message) ||
                "Could not save your quote request. Please try again.",
            );
            if (step1SubmitBtn) {
              step1SubmitBtn.disabled = false;
              step1SubmitBtn.removeAttribute("aria-busy");
              step1SubmitBtn.textContent = step1DefaultText;
            }
          });
        return;
      }
      addAttachmentPreviewsToDraft(quoteStep1Form, initialDraft).then(function (draft) {
        try {
          sessionStorage.setItem(QUOTE_DRAFT_STORAGE_KEY, JSON.stringify(draft));
          clearQuoteSubmitResult();
        } catch (err) {}
        window.location.href = QUOTE_PREVIEW_PAGE;
      });
    });
  }

  var quotePreviewRoot = document.getElementById("quote-preview");
  if (quotePreviewRoot) {
    var warnEl = document.getElementById("quote-preview-warning");
    var successEl = document.getElementById("quote-preview-success");
    var submitBtn = document.getElementById("quote-preview-submit");
    var emailCopyBtn = document.getElementById("quote-preview-email-copy");
    var draft = parseQuoteDraftFromStorage();
    var submitUrl = getQuoteSubmitUrl();
    var defaultSubmitText = submitBtn ? submitBtn.textContent : "";

    function setQuoteReviewItem(id, value) {
      var item = document.getElementById(id);
      if (!item) return;
      var text = String(value || "").trim();
      item.hidden = !text;
      var valueEl = item.querySelector("[data-review-value]");
      if (valueEl) valueEl.textContent = text;
    }

    function renderQuoteReview(d) {
      var review = document.getElementById("quote-review");
      if (!review) return;
      if (!quoteDraftLooksComplete(d)) {
        review.hidden = true;
        return;
      }
      var contact = [d.Email, d.Phone].filter(function (v) {
        return String(v || "").trim();
      });
      var timeline = [d["Project type"], d.Timing].filter(function (v) {
        return String(v || "").trim();
      });
      setQuoteReviewItem("quote-review-name", d.Name);
      setQuoteReviewItem("quote-review-address", d["Project address"]);
      setQuoteReviewItem("quote-review-contact", contact.join(" · "));
      setQuoteReviewItem("quote-review-scope", d["Project description"]);
      setQuoteReviewItem("quote-review-timeline", timeline.join(" · "));
      setQuoteReviewItem(
        "quote-review-attachments",
        Array.isArray(d.attachments) && d.attachments.length
          ? d.attachments.join(", ")
          : "",
      );
      review.hidden = false;
    }

    function setText(id, value) {
      var el = document.getElementById(id);
      if (!el) return;
      el.textContent = String(value || "").trim();
    }

    function manifestImageUrl(item) {
      if (!item || typeof item !== "object") return "";
      var name = String(item.name || "");
      var type = String(item.type || "");
      var url = String(item.signed_url || item.signedUrl || item.url || "");
      if (!url) return "";
      if (type.indexOf("image/") === 0) return url;
      if (/\.(jpe?g|png|webp|gif)$/i.test(name)) return url;
      return "";
    }

    function renderQuoteDocument(d, result) {
      var doc = document.getElementById("quote-document");
      if (!doc || !quoteDraftLooksComplete(d)) return;
      var contact = [d.Email, d.Phone].filter(function (v) {
        return String(v || "").trim();
      });
      var timeline = [d["Project type"], d.Timing].filter(function (v) {
        return String(v || "").trim();
      });
      var storedManifest =
        result && Array.isArray(result.attachment_manifest)
          ? result.attachment_manifest
          : [];
      var storedAttachmentNames = storedManifest
        .map(function (item) {
          if (typeof item === "string") return item;
          return item && item.name;
        })
        .filter(function (name) {
          return String(name || "").trim();
        });
      var attachments =
        Array.isArray(d.attachments) && d.attachments.length
          ? d.attachments
          : storedAttachmentNames;
      var projectLine =
        (result && result.project_line) ||
        d["Project type"] ||
        "Apex Ground Works project request";
      var aiText =
        (result && result.ai_project_description) ||
        (result && result.ai_summary) ||
        "Apex has received your project details. Our team will review the request and follow up with practical next steps.";

      setText("quote-document-title", projectLine);
      setText("quote-document-client", d["Project address"]);
      setText("quote-document-name", d.Name);
      setText("quote-document-contact", contact.join(" · "));
      setText("quote-document-address", d["Project address"]);
      setText("quote-document-ai", aiText);
      setText("quote-document-summary", d["Project description"]);
      setText(
        "quote-document-timing",
        timeline.length ? "Project type and timing: " + timeline.join(" · ") : "",
      );
      setText(
        "quote-document-attachments",
        attachments.length
          ? attachments.length +
              " uploaded file" +
              (attachments.length === 1 ? "" : "s") +
              " will be reviewed alongside your request."
          : "No files were attached with this request. If helpful, the Apex team may ask for photos before scheduling a site visit.",
      );
      var gallery = document.getElementById("quote-document-gallery");
      var fileList = document.getElementById("quote-document-file-list");
      if (gallery) {
        gallery.textContent = "";
        var previews = Array.isArray(d.attachmentPreviews) ? d.attachmentPreviews : [];
        var previewNames = [];
        previews.forEach(function (preview) {
          if (!preview || !preview.src) return;
          var figure = document.createElement("figure");
          var img = document.createElement("img");
          var caption = document.createElement("figcaption");
          img.src = preview.src;
          img.alt = preview.name || "Uploaded project photo";
          img.loading = "lazy";
          caption.textContent = preview.name || "Project photo";
          previewNames.push(preview.name);
          figure.appendChild(img);
          figure.appendChild(caption);
          gallery.appendChild(figure);
        });
        storedManifest.forEach(function (item) {
          var imageUrl = manifestImageUrl(item);
          var name = item && item.name ? item.name : "Uploaded project photo";
          if (!imageUrl || previewNames.indexOf(name) !== -1) return;
          var figure = document.createElement("figure");
          var img = document.createElement("img");
          var caption = document.createElement("figcaption");
          img.src = imageUrl;
          img.alt = name;
          img.loading = "lazy";
          caption.textContent = name;
          previewNames.push(name);
          figure.appendChild(img);
          figure.appendChild(caption);
          gallery.appendChild(figure);
        });
        gallery.hidden = !gallery.children.length;
        if (fileList) {
          fileList.textContent = "";
          attachments
            .filter(function (name) {
              return previewNames.indexOf(name) === -1;
            })
            .forEach(function (name) {
              var item = document.createElement("li");
              item.textContent = name;
              fileList.appendChild(item);
            });
          fileList.hidden = !fileList.children.length;
        }
      }
      doc.hidden = false;
    }

    function applyQuotePreviewReady() {
      var titleEl = document.getElementById("quote-preview-panel-title");
      var textEl = document.getElementById("quote-preview-ai");
      if (titleEl) titleEl.textContent = "Ready to submit";
      if (textEl) {
        textEl.textContent =
          submitUrl
            ? "Review the details below, then submit your request. Your project summary will appear here after it is saved."
            : "Review the details below, then open an email draft to send your request.";
      }
    }

    function applyQuotePreviewSuccess(result) {
      if (submitBtn) submitBtn.removeAttribute("aria-busy");
      var titleEl = document.getElementById("quote-preview-panel-title");
      var textEl = document.getElementById("quote-preview-ai");
      var introEl = quotePreviewRoot.querySelector(".quote-card-intro");
      if (titleEl) titleEl.textContent = "Project summary";
      if (textEl) {
        textEl.textContent =
          (result && result.ai_project_description) ||
          (result && result.ai_summary) ||
          "Your request was saved. We will follow up with clear next steps.";
      }
      if (introEl) {
        introEl.textContent =
          "Your Smart Quote preview is ready as a clean client-facing project summary. Apex will review it and follow up within 24 hours.";
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
      if (warnEl) warnEl.hidden = true;
      if (successEl) {
        successEl.hidden = false;
        successEl.textContent =
          "Request received" + (result && result.id ? " — reference " + result.id : "") + ".";
      }
      renderQuoteDocument(draft, result);
    }

    function hydrateQuotePreviewFromStorage() {
      var saved = parseQuoteSubmitResultFromStorage();
      if (!saved || !saved.id) return false;
      if (!quoteDraftLooksComplete(draft)) return false;
      applyQuotePreviewSuccess(saved);
      return true;
    }

    renderQuoteReview(draft);

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
      var hasSavedSubmit = hydrateQuotePreviewFromStorage();
      if (!hasSavedSubmit) applyQuotePreviewReady();
      if (submitBtn) {
        submitBtn.textContent = submitUrl ? "Submit request" : "Open email draft";
        defaultSubmitText = submitBtn.textContent;
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
        submitBtn.textContent = "Submitting…";
        if (warnEl) {
          warnEl.hidden = true;
          warnEl.textContent = "";
        }
        if (successEl) {
          successEl.hidden = true;
          successEl.textContent = "";
        }
        fetch(submitUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
          .then(parseQuoteResponse)
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
            submitBtn.textContent = defaultSubmitText;
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
