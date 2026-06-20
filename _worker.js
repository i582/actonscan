export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.pathname === "/og/account.svg") {
      const preview = await getAccountPreview(url.searchParams.get("address") || "", env, true)
      return new Response(renderAccountOgSvg(preview), {
        headers: {
          "content-type": "image/svg+xml; charset=utf-8",
          "cache-control": "public, max-age=3600",
        },
      })
    }

    const metadata = await getRouteMetadata(url, env)
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

async function getRouteMetadata(url, env) {
  const address = addressFromPath(url.pathname)
  if (!address) {
    return undefined
  }

  const preview = await getAccountPreview(address, env)
  const title = `${preview.title} · actonscan`
  const description = `${preview.subtitle} ${preview.shortAddress} on actonscan.`
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

async function getAccountPreview(address, env, includeImage = false) {
  const fallback = fallbackAccountPreview(address)
  if (!address) {
    return fallback
  }

  try {
    const [accountStates, jettonMasters] = await Promise.all([
      fetchToncenterJson("/accountStates", {address, include_boc: "false"}, env),
      fetchToncenterJson("/jetton/masters", {address}, env),
    ])
    const preview = previewFromResponses(address, accountStates, jettonMasters)
    if (!includeImage || !preview.image) {
      return preview
    }

    return {
      ...preview,
      image: (await inlineImage(preview.image)) || preview.image,
    }
  } catch {
    return fallback
  }
}

function fallbackAccountPreview(address) {
  const shortAddress = address ? formatAddress(address) : "actonscan"
  return {
    title: shortAddress,
    subtitle: "TON account",
    shortAddress,
    rawAddress: address || "Open-source TON explorer",
    status: undefined,
    type: undefined,
    detail: undefined,
    image: undefined,
    avatarText: "A",
  }
}

async function fetchToncenterJson(pathname, searchParams, env) {
  const baseUrl = env.TONCENTER_API_V3_URL || "https://toncenter.com/api/v3"
  const url = new URL(`${baseUrl.replace(/\/$/, "")}/${pathname.replace(/^\//, "")}`)
  for (const [key, value] of Object.entries(searchParams)) {
    url.searchParams.append(key, value)
  }

  const headers = new Headers()
  if (env.TONCENTER_API_KEY) {
    headers.set("X-API-Key", env.TONCENTER_API_KEY)
  }

  const response = await fetch(url, {headers})
  if (!response.ok) {
    throw new Error(`Toncenter request failed: ${response.status}`)
  }
  return response.json()
}

function previewFromResponses(address, accountStates, jettonMasters) {
  const fallback = fallbackAccountPreview(address)
  const account = Array.isArray(accountStates?.accounts) ? accountStates.accounts[0] : undefined
  const addressBook =
    accountStates?.address_book?.[account?.address] ?? accountStates?.address_book?.[address]
  const interfaces = account?.interfaces ?? addressBook?.interfaces ?? []
  const jettonMaster = Array.isArray(jettonMasters?.jetton_masters)
    ? jettonMasters.jetton_masters[0]
    : undefined
  const tokenInfo =
    tokenInfoForAddress(accountStates?.metadata, account?.address || address) ||
    tokenInfoForAddress(jettonMasters?.metadata, account?.address || address)
  const jettonContent = {
    ...(isRecord(jettonMaster?.jetton_content) ? jettonMaster.jetton_content : {}),
    ...(isRecord(tokenInfo?.extra) ? tokenInfo.extra : {}),
  }

  const name =
    stringValue(jettonContent.name) ||
    stringValue(tokenInfo?.name) ||
    stringValue(addressBook?.domain) ||
    fallback.title
  const symbol = stringValue(jettonContent.symbol) || stringValue(tokenInfo?.symbol)
  const image = tokenImage(jettonContent, tokenInfo)
  const status = formatStatus(account?.status || account?.account_status || addressBook?.status)
  const type = formatAccountType(interfaces, jettonMaster)
  const totalSupply =
    stringValue(jettonMaster?.total_supply) || stringValue(tokenInfo?.total_supply)
  const decimals = Number(
    stringValue(jettonContent.decimals) || stringValue(tokenInfo?.decimals) || "9",
  )
  const detail =
    totalSupply && symbol
      ? `Max.supply: ${formatTokenAmount(totalSupply, decimals)} ${symbol}`
      : symbol
        ? `Token symbol: ${symbol}`
        : undefined

  return {
    title: name,
    subtitle: type || "TON account",
    shortAddress: fallback.shortAddress,
    rawAddress: address,
    status,
    type,
    detail,
    image,
    avatarText: avatarText(name, symbol),
  }
}

function tokenInfoForAddress(metadata, address) {
  const records = metadata?.[address]?.token_info
  return Array.isArray(records) ? records.find(info => info.type === "jetton_masters") : undefined
}

function renderAccountOgSvg(preview) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="630" viewBox="0 0 1200 630" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="avatarGradient" cx="50%" cy="45%" r="64%">
      <stop offset="0%" stop-color="#5EEAD4"/>
      <stop offset="100%" stop-color="#0F766E"/>
    </radialGradient>
    <pattern id="dotWave" width="26" height="26" patternUnits="userSpaceOnUse">
      <circle cx="4" cy="4" r="2.1" fill="#FFFFFF" opacity="0.13"/>
    </pattern>
    <clipPath id="avatarClip">
      <circle cx="156" cy="148" r="76"/>
    </clipPath>
  </defs>
  <rect width="1200" height="630" fill="#202020"/>
  <rect width="1200" height="630" fill="url(#dotWave)" opacity="0.36" transform="translate(520 24) rotate(-13 600 315)"/>
  <circle cx="1060" cy="118" r="280" fill="#FFFFFF" opacity="0.03"/>
  ${renderAvatar(preview)}
  <text x="270" y="132" fill="#FFFFFF" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="72" font-weight="800">${escapeSvg(truncateText(preview.title, 24))}</text>
  ${preview.status ? renderBadge(272, 166, preview.status, "#14532D", "#5DD66F") : ""}
  ${preview.type ? renderBadge(preview.status ? 426 : 272, 166, preview.type, "#3A3A3D", "#E8E8EA") : ""}
  ${preview.detail ? `<text x="272" y="266" fill="#E8E8EA" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="31" font-weight="650">${escapeSvg(truncateText(preview.detail, 44))}</text>` : ""}
  <rect x="90" y="492" width="286" height="62" rx="31" fill="#252527" stroke="#4A4A4D" stroke-width="2"/>
  <text x="233" y="523" text-anchor="middle" dominant-baseline="middle" fill="#B8B8BE" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="30" font-weight="700">actonscan.com</text>
</svg>`
}

function renderAvatar(preview) {
  if (!preview.image) {
    return `<rect x="80" y="72" width="152" height="152" rx="32" fill="#454547" stroke="#5A5A5D" stroke-width="2"/>
  <path d="M156 110L199 110L156 182L113 110H156Z" stroke="#FFFFFF" stroke-width="10" stroke-linejoin="round" fill="none"/>
  <path d="M156 111V181" stroke="#FFFFFF" stroke-width="10" stroke-linecap="round"/>`
  }

  return `<circle cx="156" cy="148" r="76" fill="url(#avatarGradient)"/>
  <image x="80" y="72" width="152" height="152" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatarClip)" href="${escapeAttribute(preview.image)}"/>`
}

function renderBadge(x, y, label, fill, color) {
  const width = Math.max(116, label.length * 14 + 36)
  return `<rect x="${x}" y="${y}" width="${width}" height="46" rx="10" fill="${fill}" opacity="0.92"/>
  <text x="${x + 20}" y="${y + 23}" dy="0.12em" dominant-baseline="middle" fill="${color}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="28" font-weight="800">${escapeSvg(label)}</text>`
}

function formatAddress(address) {
  if (address.length <= 18) {
    return address
  }
  return `${address.slice(0, 8)}…${address.slice(-6)}`
}

function formatStatus(status) {
  const value = stringValue(status)?.toLowerCase()
  if (!value) {
    return undefined
  }
  return value === "active" ? "Active" : value.charAt(0).toUpperCase() + value.slice(1)
}

function formatAccountType(interfaces, jettonMaster) {
  if (jettonMaster || interfaces?.includes?.("jetton_master")) {
    return "Jetton Master"
  }
  if (interfaces?.includes?.("jetton_wallet")) {
    return "Jetton Wallet"
  }
  if (interfaces?.includes?.("nft_item")) {
    return "NFT Item"
  }
  if (interfaces?.includes?.("nft_collection")) {
    return "NFT Collection"
  }
  return undefined
}

function formatTokenAmount(value, decimals) {
  const numeric = BigInt(value)
  const divisor = 10n ** BigInt(Math.max(0, decimals))
  const whole = numeric / divisor
  const fraction = numeric % divisor
  const fractionText = fraction
    .toString()
    .padStart(Math.max(0, decimals), "0")
    .replace(/0+$/, "")
    .slice(0, 2)
  return fractionText ? `${formatWholeNumber(whole)}.${fractionText}` : formatWholeNumber(whole)
}

function formatWholeNumber(value) {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")
}

function avatarText(name, symbol) {
  return (symbol || name || "A").trim().charAt(0).toUpperCase()
}

function tokenImage(content, tokenInfo) {
  return (
    stringValue(content._image_big) ||
    stringValue(content._image_medium) ||
    stringValue(content._image_small) ||
    stringValue(content.image) ||
    stringValue(tokenInfo?.image)
  )
}

async function inlineImage(url) {
  try {
    const response = await fetch(url)
    if (!response.ok) {
      return undefined
    }

    const contentType = response.headers.get("content-type") || "image/png"
    const bytes = new Uint8Array(await response.arrayBuffer())
    let binary = ""
    for (const byte of bytes) {
      binary += String.fromCharCode(byte)
    }
    return `data:${contentType};base64,${btoa(binary)}`
  } catch {
    return undefined
  }
}

function truncateText(value, maxLength) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringValue(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined
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

function escapeAttribute(value) {
  return escapeSvg(value).replace(/"/g, "&quot;")
}
