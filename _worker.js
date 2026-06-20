export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.pathname === "/og/account.svg") {
      return new Response(renderAccountOgSvg(url.searchParams.get("address") || ""), {
        headers: {
          "content-type": "image/svg+xml; charset=utf-8",
          "cache-control": "public, max-age=3600",
        },
      })
    }

    const metadata = getRouteMetadata(url)
    const assetResponse = await env.ASSETS.fetch(request)
    const response =
      metadata && assetResponse.status === 404
        ? await env.ASSETS.fetch(new Request(new URL("/index.html", url), request))
        : assetResponse

    if (!shouldInjectHtml(request, response)) {
      return assetResponse
    }

    if (!metadata) {
      return response
    }

    const html = await response.text()
    return new Response(injectMetadata(html, metadata), {
      headers: withHeader(response.headers, "content-type", "text/html; charset=utf-8"),
      status: 200,
      statusText: "OK",
    })
  },
}

function shouldInjectHtml(request, response) {
  if (request.method !== "GET" || response.status >= 400) {
    return false
  }
  return response.headers.get("content-type")?.includes("text/html") ?? false
}

function getRouteMetadata(url) {
  const address = addressFromPath(url.pathname)
  if (!address) {
    return undefined
  }

  const shortAddress = formatAddress(address)
  const title = `${shortAddress} · actonscan`
  const description = `TON account ${shortAddress} on actonscan, an open-source TON explorer.`
  const image = absoluteUrl(url, `/og/account.svg?address=${encodeURIComponent(address)}`)
  return {title, description, image, url: url.href}
}

function addressFromPath(pathname) {
  const match = pathname.match(/^\/address\/([^/?#]+)$/)
  if (!match) {
    return undefined
  }

  try {
    return decodeURIComponent(match[1] || "").trim()
  } catch {
    return match[1]?.trim()
  }
}

function injectMetadata(html, metadata) {
  return html
    .replace(/<title>.*?<\/title>/, `<title>${escapeHtml(metadata.title)}</title>`)
    .replace(
      /<meta\s+name="description"\s+content="[^"]*"\s*\/>/,
      `<meta name="description" content="${escapeHtml(metadata.description)}" />`,
    )
    .replace(
      /<meta\s+property="og:title"\s+content="[^"]*"\s*\/>/,
      `<meta property="og:title" content="${escapeHtml(metadata.title)}" />`,
    )
    .replace(
      /<meta\s+property="og:url"\s+content="[^"]*"\s*\/>/,
      `<meta property="og:url" content="${escapeHtml(metadata.url)}" />`,
    )
    .replace(
      /<meta\s+property="og:description"\s+content="[^"]*"\s*\/>/,
      `<meta property="og:description" content="${escapeHtml(metadata.description)}" />`,
    )
    .replace(
      /<meta\s+property="og:image"\s+content="[^"]*"\s*\/>/,
      `<meta property="og:image" content="${escapeHtml(metadata.image)}" />`,
    )
    .replace(
      /<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/>/,
      `<meta name="twitter:title" content="${escapeHtml(metadata.title)}" />`,
    )
    .replace(
      /<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/>/,
      `<meta name="twitter:description" content="${escapeHtml(metadata.description)}" />`,
    )
    .replace(
      /<meta\s+name="twitter:image"\s+content="[^"]*"\s*\/>/,
      `<meta name="twitter:image" content="${escapeHtml(metadata.image)}" />`,
    )
}

function renderAccountOgSvg(address) {
  const shortAddress = address ? formatAddress(address) : "actonscan"
  const rawAddress = address || "Open-source TON explorer"
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="630" viewBox="0 0 1200 630" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="630" fill="#111318"/>
  <circle cx="1000" cy="84" r="300" fill="#3B82F6" opacity="0.18"/>
  <circle cx="154" cy="520" r="260" fill="#14B8A6" opacity="0.12"/>
  <path d="M0 502C194 438 332 438 512 498C740 574 914 562 1200 452V630H0V502Z" fill="#FFFFFF" opacity="0.045"/>
  <rect x="72" y="72" width="1056" height="486" rx="44" fill="#17191F" stroke="#2A2D36" stroke-width="2"/>
  <rect x="112" y="112" width="116" height="116" rx="34" fill="#F8FAFC"/>
  <path d="M170 144L210 144L170 204L130 144H170Z" stroke="#111318" stroke-width="14" stroke-linejoin="round"/>
  <text x="256" y="157" fill="#FFFFFF" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="44" font-weight="800">actonscan</text>
  <text x="256" y="205" fill="#A8ABB6" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="26" font-weight="600">Open-source TON explorer</text>
  <text x="112" y="346" fill="#FFFFFF" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="70" font-weight="800">${escapeSvg(shortAddress)}</text>
  <text x="112" y="408" fill="#A8ABB6" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="28" font-weight="500">TON account</text>
  <text x="112" y="468" fill="#6D7280" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="24" font-weight="500">${escapeSvg(rawAddress)}</text>
</svg>`
}

function formatAddress(address) {
  if (address.length <= 18) {
    return address
  }
  return `${address.slice(0, 8)}…${address.slice(-6)}`
}

function absoluteUrl(url, pathname) {
  return `${url.protocol}//${url.host}${pathname}`
}

function withHeader(headers, name, value) {
  const next = new Headers(headers)
  next.set(name, value)
  return next
}

function escapeHtml(value) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")
}

function escapeSvg(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}
