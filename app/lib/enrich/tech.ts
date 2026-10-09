import type { TechHints } from "../types";

/**
 * How a website is built and run, from its HTML and text: the store platform (and whether it's
 * still on a free default theme), the tools it uses, an ERP it names, a customer portal or
 * tracking page, and job ads that show manual office work. Each is a reason an agency can offer
 * a store upgrade, a CRM/ERP or an automation. Pure, exported for tests.
 */

const TOOLS: Array<[RegExp, string]> = [
  [/static\.klaviyo\.com|klaviyo\.js/i, "Klaviyo"],
  [/js\.hs-scripts\.com|js\.hsforms\.net|hs-analytics|hubspot/i, "HubSpot"],
  [/salesforce\.com|force\.com|pardot/i, "Salesforce"],
  [/zoho\.(com|in|eu)\/|salesiq\.zoho|zohopublic|zohocdn/i, "Zoho"],
  [/widget\.intercom\.io|intercomcdn/i, "Intercom"],
  [/zdassets\.com|zendesk/i, "Zendesk"],
  [/freshchat|freshdesk|freshworks/i, "Freshworks"],
  [/client\.crisp\.chat/i, "Crisp"],
  [/embed\.tawk\.to/i, "Tawk.to"],
  [/js\.driftt\.com|drift\.com/i, "Drift"],
  [/gorgias/i, "Gorgias"],
  [/tidio/i, "Tidio"],
  [/chimpstatic\.com|list-manage\.com|mailchimp/i, "Mailchimp"],
  [/pipedrive/i, "Pipedrive"],
  [/monday\.com/i, "monday.com"],
  [/calendly\.com/i, "Calendly"],
  [/recharge(payments|cdn)|rechargeapps/i, "Recharge"],
  [/yotpo|judge\.me|okendo|stamped\.io|loox\.io/i, "Reviews app"],
];

/** Analytics and ad tags: a site without them can't see where customers come from and isn't advertising. */
const MARKETING: Array<[RegExp, string]> = [
  [/googletagmanager\.com\/gtag\/js\?id=G-|google-analytics\.com\/(analytics|ga)\.js|gtag\(\s*['"]config['"]\s*,\s*['"](G|UA)-/i, "Google Analytics"],
  [/googletagmanager\.com\/gtm\.js|\bGTM-[A-Z0-9]{4,}\b/, "Google Tag Manager"],
  [/connect\.facebook\.net\/[^"']*\/fbevents\.js|fbq\(\s*['"]init['"]/i, "Meta Pixel"],
  [/gtag\(\s*['"]config['"]\s*,\s*['"]AW-|googleadservices\.com|googleads\.g\.doubleclick\.net/i, "Google Ads"],
];

const ERP: Array<[RegExp, string]> = [
  [/\bSAP\b(?! ?\/)(?!-)/, "SAP"],
  [/\bOracle (ERP|Fusion|E-?Business|JD ?Edwards)|\bJD ?Edwards\b/i, "Oracle"],
  [/\bNetSuite\b/i, "NetSuite"],
  [/\bOdoo\b/i, "Odoo"],
  [/\b(Microsoft )?Dynamics (365|NAV|AX|GP|Business Central)|\bBusiness Central\b/i, "Microsoft Dynamics"],
  [/\bSage (X3|Intacct|100|300|50)\b/i, "Sage"],
  [/\bEpicor\b/i, "Epicor"],
  [/\bInfor (CloudSuite|M3|LN|SyteLine)\b/i, "Infor"],
  [/\bTally( ?ERP| ?Prime)?\b/, "Tally"],
];

const MARKETPLACES: Array<[RegExp, string]> = [
  [/(^|\.)amazon\.(com|ca|com\.au|ae|sa|co\.uk|in)$/, "Amazon"],
  [/(^|\.)etsy\.com$/, "Etsy"],
  [/(^|\.)ebay\.(com|ca|com\.au)$/, "eBay"],
  [/(^|\.)walmart\.(com|ca)$/, "Walmart"],
  [/(^|\.)noon\.com$/, "Noon"],
  [/(^|\.)(faire|wayfair)\.com$/, "Faire / Wayfair"],
  [/(^|\.)(flipkart|meesho|myntra)\.com$/, "Indian marketplaces"],
  [/(^|\.)(trademe\.co\.nz|catch\.com\.au|kogan\.com)$/, "Local marketplaces"],
];

/** Shopify's free themes: a store on one of these was set up and never designed. */
const FREE_SHOPIFY_THEMES = /^(dawn|debut|brooklyn|minimal|simple|supply|venture|narrative|boundless|express|craft|crave|sense|studio|taste|refresh|origin|colorblock|ride|publisher|spotlight|trade|split|horizon)$/i;

const MANUAL_ROLES = /\b(data entry (operator|clerk|executive|specialist)?|dispatcher|dispatch (coordinator|clerk)|order (processing|entry) (clerk|specialist|executive)|admin(istrative)? assistant|office assistant|back[- ]office (executive|assistant)|billing (clerk|executive)|accounts (clerk|assistant)|inventory (clerk|controller)|customer service (rep|representative|agent)|logistics coordinator|shipping clerk|documentation (executive|clerk))\b/gi;

export function techHints(html: string, text: string, hosts: string[] = []): TechHints {
  const h = html.slice(0, 600_000);
  const t = text.slice(0, 400_000);
  const out: TechHints = {};

  // store platform
  if (/cdn\.shopify\.com|Shopify\.theme|myshopify\.com/i.test(h)) out.platform = "Shopify";
  else if (/woocommerce/i.test(h)) out.platform = "WooCommerce";
  else if (/Mage\.Cookies|\/skin\/frontend\/|varien\//i.test(h)) out.platform = "Magento 1";
  else if (/data-mage-init|mage\/cookies|Magento_|requirejs-config\.js/i.test(h)) out.platform = "Magento 2";
  else if (/cdn\d*\.bigcommerce\.com|bigcommerce/i.test(h)) out.platform = "BigCommerce";
  else if (/prestashop/i.test(h)) out.platform = "PrestaShop";
  else if (/opencart|catalog\/view\/theme/i.test(h)) out.platform = "OpenCart";
  else if (/static\.wixstatic\.com|wix\.com/i.test(h)) out.platform = "Wix";
  else if (/squarespace/i.test(h)) out.platform = "Squarespace";
  else if (/ecwid/i.test(h)) out.platform = "Ecwid";

  if (out.platform === "Shopify") {
    const name = h.match(/Shopify\.theme\s*=\s*\{[^}]*?"name"\s*:\s*"([^"]+)"/)?.[1] ?? h.match(/"theme_store_id"[^}]*?"name"\s*:\s*"([^"]+)"/)?.[1];
    // "Dawn - updated copy", "Debut (backup) 2" → the theme it started from
    let clean = name?.trim().replace(/\s*\(.*?\)/g, " ").trim();
    for (let prev = ""; clean && clean !== prev; ) {
      prev = clean;
      clean = clean.replace(/[\s_-]*\b(copy|updated|backup|live|old|new|v?\d[\d.]*)$/i, "").trim();
    }
    if (clean && FREE_SHOPIFY_THEMES.test(clean)) out.defaultTheme = clean[0].toUpperCase() + clean.slice(1).toLowerCase();
  }

  out.store = !!out.platform && !["Wix", "Squarespace"].includes(out.platform) ? true : /\b(add to (cart|bag|basket)|checkout|shopping (cart|bag))\b/i.test(t) || /\/cart\b|\/checkout\b/i.test(h);

  const market = [...new Set(hosts.flatMap((x) => MARKETPLACES.filter(([re]) => re.test(x)).map(([, n]) => n)))];
  if (market.length) out.marketplaces = market;

  const tools = TOOLS.filter(([re]) => re.test(h)).map(([, n]) => n);
  if (tools.length) out.tools = [...new Set(tools)];
  const marketing = MARKETING.filter(([re]) => re.test(h)).map(([, n]) => n);
  if (marketing.length) out.marketing = marketing;
  const erp = ERP.filter(([re]) => re.test(t)).map(([, n]) => n);
  if (erp.length) out.erp = [...new Set(erp)];

  out.portal = /\b(customer|client|partner|dealer|shipper|carrier|vendor|supplier) (portal|login|log in|sign in)\b|\bmy account\b/i.test(t);
  out.tracking = /\b(track (your|my|a) (shipment|order|parcel|consignment|delivery|load)|shipment tracking|order tracking|track & trace|track and trace)\b/i.test(t);
  out.quoteForm = /\b(request|get|ask for) (a )?(free )?(quote|quotation)\b|\bRFQ\b/i.test(t);

  const roles = [...new Set((t.match(MANUAL_ROLES) ?? []).map((r) => r.toLowerCase().replace(/\s+/g, " ")))];
  if (roles.length) out.manualRoles = roles.slice(0, 4);

  const loc = [...t.matchAll(/\b(\d{1,3})\+?\s+(locations|branches|offices|warehouses|depots|terminals|stores|facilities|distribution centers|distribution centres|yards)\b/gi)].map((m) => Number(m[1])).filter((n) => n >= 2 && n <= 500);
  if (loc.length) out.locations = Math.max(...loc);

  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== false && v !== undefined)) as TechHints;
}

/** Combine what several pages of one site say. */
export function mergeTech(into: TechHints, more: TechHints): TechHints {
  for (const [k, v] of Object.entries(more) as Array<[keyof TechHints, unknown]>) {
    const cur = into[k] as unknown;
    if (Array.isArray(v)) (into as Record<string, unknown>)[k] = [...new Set([...((cur as string[] | undefined) ?? []), ...v])];
    else if (typeof v === "number") (into as Record<string, unknown>)[k] = Math.max(Number(cur ?? 0), v);
    else if (cur === undefined) (into as Record<string, unknown>)[k] = v;
  }
  return into;
}
