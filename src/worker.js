// language: JavaScript, runtime: Cloudflare Workers, target: https://www.image2url.com/tools scraper & reliable uploader

const CREATOR = "Creator - 👨‍💻 SHADOW MOVIE X MAIN OWNER 👨‍💻";
const BASE_URL = "https://www.image2url.com";
const TOOLS_URL = `${BASE_URL}/tools`;
const UPLOAD_API = `${BASE_URL}/api/upload`;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function json_res(data, status = 200) {
  return new Response(
    JSON.stringify(
      {
        creator: CREATOR,
        ...data,
      },
      null,
      2
    ),
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    }
  );
}

function abs_url(raw, base = BASE_URL) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s || s.startsWith("javascript:") || s.startsWith("mailto:") || s.startsWith("#")) {
    return null;
  }
  try {
    return new URL(s, base).toString();
  } catch (_) {
    return null;
  }
}

function clean_text(htmlStr = "") {
  return String(htmlStr)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function classify_tool(name = "", url = "") {
  const hay = `${name} ${url}`.toLowerCase();
  if (/gif/.test(hay)) return "gif-to-url";
  if (/video/.test(hay)) return "video-to-url";
  if (/pdf|doc|document/.test(hay)) return "pdf-to-url";
  if (/file-to-url|bulk|compress-file|zip/.test(hay)) return "file-to-url";
  if (/image|img|converter|resize|crop|enhance|photo|picture|webp|png|jpg|heic|svg|qr/.test(hay)) {
    return "image-to-url";
  }
  return "other-tools";
}

function extract_assets_from_html(html = "") {
  const images = [];
  const videos = [];
  const gifs = [];
  const pdfs = [];

  for (const m of html.matchAll(/https?:\/\/[^\s"'<>`()]+/gi)) {
    const u = m[0].replace(/\\\//g, "/").replace(/[,;]+$/, "");
    if (/\.gif(?:\?|$)/i.test(u) && !gifs.includes(u)) {
      gifs.push(u);
    } else if (/\.(?:mp4|webm|mov|m3u8)(?:\?|$)/i.test(u) && !videos.includes(u)) {
      videos.push(u);
    } else if (/\.pdf(?:\?|$)/i.test(u) && !pdfs.includes(u)) {
      pdfs.push(u);
    } else if (/\.(?:png|jpg|jpeg|webp)(?:\?|$)/i.test(u) && !images.includes(u)) {
      images.push(u);
    }
  }

  return { images, videos, gifs, pdfs };
}

async function scrape_tools_page(targetPageUrl = TOOLS_URL) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  let html = "";
  try {
    const res = await fetch(targetPageUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Referer: `${BASE_URL}/`,
      },
      redirect: "follow",
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} while fetching ${targetPageUrl}`);
    }
    html = await res.text();
  } finally {
    clearTimeout(timer);
  }

  const seen = new Set();
  const tools = [];

  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const fullUrl = abs_url(match[1], targetPageUrl);
    if (!fullUrl) continue;

    const parsed = new URL(fullUrl);
    if (!parsed.hostname.endsWith("image2url.com")) continue;

    const pathname = parsed.pathname.toLowerCase();
    if (
      pathname === "/" ||
      pathname.includes("/cdn-cgi/") ||
      /privacy|terms|cookie|login|signin|sign-in|pricing|blog|about/.test(pathname)
    ) {
      continue;
    }

    const title = clean_text(match[2]) || pathname.split("/").filter(Boolean).pop() || "Tool";
    const key = `${fullUrl}|${title}`;
    if (seen.has(key)) continue;
    seen.add(key);

    tools.push({
      title,
      url: fullUrl,
      category: classify_tool(title, fullUrl),
    });
  }

  for (const m of html.matchAll(/"(?:href|url|path|route)"\s*:\s*"(\/[a-zA-Z0-9\-_/?=&]+)"/g)) {
    const fullUrl = abs_url(m[1], BASE_URL);
    if (!fullUrl) continue;

    const parsed = new URL(fullUrl);
    if (!parsed.hostname.endsWith("image2url.com")) continue;

    const pathname = parsed.pathname.toLowerCase();
    if (
      pathname === "/" ||
      pathname.includes("/cdn-cgi/") ||
      /privacy|terms|cookie|login|signin|sign-in/.test(pathname)
    ) {
      continue;
    }

    const key = `${fullUrl}|route`;
    if (seen.has(key)) continue;
    seen.add(key);

    const slugTitle =
      parsed.pathname
        .split("/")
        .filter(Boolean)
        .pop()
        ?.replace(/[-_]+/g, " ") || "Tool";

    tools.push({
      title: slugTitle,
      url: fullUrl,
      category: classify_tool(slugTitle, fullUrl),
    });
  }

  const grouped = {
    imageToUrl: tools.filter((t) => t.category === "image-to-url"),
    videoToUrl: tools.filter((t) => t.category === "video-to-url"),
    gifToUrl: tools.filter((t) => t.category === "gif-to-url"),
    pdfToUrl: tools.filter((t) => t.category === "pdf-to-url"),
    fileToUrl: tools.filter((t) => t.category === "file-to-url"),
    otherTools: tools.filter((t) => t.category === "other-tools"),
  };

  const pageTitle =
    (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]
      ? clean_text((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1])
      : "Image2URL Tools";

  return {
    ok: true,
    source: targetPageUrl,
    pageTitle,
    totalTools: tools.length,
    grouped,
    allTools: tools,
    assets: extract_assets_from_html(html),
  };
}

function extract_url_from_text_or_obj(data, rawText = "") {
  if (data && typeof data === "object") {
    const candidates = [
      data.url,
      data.link,
      data.fileUrl,
      data.file_url,
      data.downloadUrl,
      data.shortUrl,
      data.data?.url,
      data.data?.link,
      data.data?.fileUrl,
      data.result?.url,
    ];
    for (const c of candidates) {
      if (typeof c === "string" && /^https?:\/\//i.test(c.trim())) {
        return c.trim();
      }
    }
  }

  const directMatch = String(rawText || "").trim().match(/^https?:\/\/[^\s"'<>`\\)]+$/i);
  if (directMatch) return directMatch[0];

  const anyMatch = String(rawText || "").match(/https?:\/\/[^\s"'<>`\\)]+/i);
  if (anyMatch) return anyMatch[0].replace(/[,;]+$/, "");

  return null;
}

async function try_image2url_upload(file, toolHint) {
  try {
    const forwardForm = new FormData();
    forwardForm.append("file", file, file.name || "upload.bin");
    if (toolHint) forwardForm.append("tool", String(toolHint));

    const res = await fetch(UPLOAD_API, {
      method: "POST",
      body: forwardForm,
      headers: {
        "User-Agent": UA,
        Origin: BASE_URL,
        Referer: TOOLS_URL,
      },
    });
    const rawText = await res.text();
    let parsed = null;
    try {
      parsed = JSON.parse(rawText);
    } catch (_) {
      parsed = { rawText, status: res.status };
    }
    const url = extract_url_from_text_or_obj(parsed, rawText);
    return { provider: "image2url", url, upstream: parsed };
  } catch (e) {
    return { provider: "image2url", url: null, error: e.message };
  }
}

async function try_fallback_hosts(file) {
  const fileName = file.name || "upload.bin";

  // Fallback 1: uguu.se
  try {
    const f1 = new FormData();
    f1.append("files[]", file, fileName);
    const r1 = await fetch("https://uguu.se/upload", {
      method: "POST",
      body: f1,
      headers: { "User-Agent": UA },
    });
    const t1 = await r1.text();
    let j1 = null;
    try { j1 = JSON.parse(t1); } catch (_) {}
    const u1 = j1?.files?.[0]?.url || extract_url_from_text_or_obj(j1, t1);
    if (u1) return { provider: "uguu.se", url: u1 };
  } catch (_) {}

  // Fallback 2: 0x0.st
  try {
    const f2 = new FormData();
    f2.append("file", file, fileName);
    const r2 = await fetch("https://0x0.st", {
      method: "POST",
      body: f2,
      headers: { "User-Agent": UA },
    });
    const t2 = await r2.text();
    const u2 = extract_url_from_text_or_obj(null, t2);
    if (u2) return { provider: "0x0.st", url: u2 };
  } catch (_) {}

  // Fallback 3: catbox.moe
  try {
    const f3 = new FormData();
    f3.append("reqtype", "fileupload");
    f3.append("fileToUpload", file, fileName);
    const r3 = await fetch("https://catbox.moe/user/api.php", {
      method: "POST",
      body: f3,
      headers: { "User-Agent": UA },
    });
    const t3 = await r3.text();
    const u3 = extract_url_from_text_or_obj(null, t3);
    if (u3) return { provider: "catbox.moe", url: u3 };
  } catch (_) {}

  return { provider: null, url: null };
}

async function handle_upload(request) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return json_res(
      { ok: false, error: "Send multipart/form-data with a 'file' field" },
      400
    );
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return json_res({ ok: false, error: "Missing 'file' upload field" }, 400);
  }

  const toolHint = formData.get("tool");
  const i2uRes = await try_image2url_upload(file, toolHint);

  let finalUrl = i2uRes.url;
  let hostUsed = finalUrl ? i2uRes.provider : null;

  if (!finalUrl) {
    const fb = await try_fallback_hosts(file);
    if (fb.url) {
      finalUrl = fb.url;
      hostUsed = fb.provider;
    }
  }

  const fname = (file.name || "").toLowerCase();
  let detectedType = "file-url";
  if (/\.gif$/.test(fname)) detectedType = "gif-url";
  else if (/\.(mp4|mov|webm|mkv|avi)$/.test(fname)) detectedType = "video-url";
  else if (/\.pdf$/.test(fname)) detectedType = "pdf-url";
  else if (/\.(png|jpg|jpeg|webp|bmp)$/.test(fname)) detectedType = "image-url";

  return json_res({
    ok: Boolean(finalUrl),
    type: detectedType,
    fileName: file.name || null,
    url: finalUrl,
    host: hostUsed,
    upstream: i2uRes.upstream || i2uRes.error || null,
  });
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return json_res({ ok: true }, 200);
    }

    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";

    try {
      if (pathname === "/health") {
        return json_res({
          ok: true,
          status: "ready",
          target: TOOLS_URL,
          endpoints: [
            "/tools",
            "/scrape?url=https://www.image2url.com/tools",
            "/upload (POST multipart/form-data with 'file')",
          ],
        });
      }

      if (pathname === "/tools") {
        const data = await scrape_tools_page(TOOLS_URL);
        return json_res(data);
      }

      if (pathname === "/scrape") {
        const target = (url.searchParams.get("url") || TOOLS_URL).trim();
        const resolved = abs_url(target, TOOLS_URL);
        if (!resolved || !new URL(resolved).hostname.endsWith("image2url.com")) {
          return json_res({ ok: false, error: "Invalid image2url.com URL" }, 400);
        }
        const data = await scrape_tools_page(resolved);
        return json_res(data);
      }

      if (pathname === "/upload" && request.method === "POST") {
        return await handle_upload(request);
      }

      return json_res({ ok: false, error: "Endpoint not found" }, 404);
    } catch (err) {
      return json_res(
        {
          ok: false,
          error: err?.message || "Worker error",
        },
        500
      );
    }
  },
};
