// language: JavaScript, runtime: Cloudflare Workers, target: https://www.image2url.com/tools scraper & uploader

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
  if (/image|img|converter|resize|crop|enhance/.test(hay)) return "image-to-url";
  if (/file|bulk|upload/.test(hay)) return "file-to-url";
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
    if (pathname === "/" || /privacy|terms|cookie|login|signin|sign-in/.test(pathname)) {
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

  const forwardForm = new FormData();
  forwardForm.append("file", file, file.name || "upload.bin");
  const toolHint = formData.get("tool");
  if (toolHint) {
    forwardForm.append("tool", String(toolHint));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);

  let upstreamData = null;
  try {
    const res = await fetch(UPLOAD_API, {
      method: "POST",
      body: forwardForm,
      signal: controller.signal,
      headers: {
        "User-Agent": UA,
        Origin: BASE_URL,
        Referer: TOOLS_URL,
      },
    });
    const txt = await res.text();
    try {
      upstreamData = JSON.parse(txt);
    } catch (_) {
      upstreamData = { rawText: txt, status: res.status };
    }
  } finally {
    clearTimeout(timer);
  }

  const generatedUrl =
    upstreamData?.url ||
    upstreamData?.link ||
    upstreamData?.fileUrl ||
    upstreamData?.data?.url ||
    upstreamData?.data?.link ||
    null;

  const fname = (file.name || "").toLowerCase();
  let detectedType = "file-url";
  if (/\.gif$/.test(fname)) detectedType = "gif-url";
  else if (/\.(mp4|mov|webm|mkv|avi)$/.test(fname)) detectedType = "video-url";
  else if (/\.pdf$/.test(fname)) detectedType = "pdf-url";
  else if (/\.(png|jpg|jpeg|webp|bmp)$/.test(fname)) detectedType = "image-url";

  return json_res({
    ok: Boolean(generatedUrl),
    type: detectedType,
    fileName: file.name || null,
    url: generatedUrl,
    upstream: upstreamData,
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
