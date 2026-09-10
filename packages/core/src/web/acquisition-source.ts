export const ACQUISITION_CHANNELS = [
  "paid_search",
  "paid_social",
  "organic_search",
  "organic_social",
  "referral",
  "direct",
  "other",
  "unknown",
] as const;
export type AcquisitionChannel = (typeof ACQUISITION_CHANNELS)[number];
export interface AcquisitionSource {
  channel: AcquisitionChannel;
  source: string;
  medium: string;
  campaign: string;
}
export const ACQUISITION_CHANNEL_LABELS: Record<AcquisitionChannel, string> = {
  paid_search: "検索広告",
  paid_social: "SNS広告",
  organic_search: "自然検索",
  organic_social: "SNS",
  referral: "参照サイト",
  direct: "直接流入・内部遷移",
  other: "その他",
  unknown: "不明",
};
const socialDomains = [
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "twitter.com",
  "x.com",
  "t.co",
  "youtube.com",
  "tiktok.com",
];
const searchDomains = [
  "google.com",
  "google.co.jp",
  "google.co.uk",
  "google.de",
  "google.fr",
  "bing.com",
  "yahoo.com",
  "yahoo.co.jp",
  "duckduckgo.com",
  "baidu.com",
  "yandex.com",
  "yandex.ru",
];
const hasDomain = (host: string, domains: readonly string[]) =>
  domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
function httpUrl(value: unknown): URL | null {
  if (typeof value !== "string") return null;
  const url = URL.parse(value);
  return url && (url.protocol === "https:" || url.protocol === "http:") ? url : null;
}

/** Deterministic, editable heuristics; a source label does not prove causality. */
export function classifyAcquisitionSource(
  value: unknown,
  internalDomains: readonly string[] = [],
): AcquisitionSource {
  const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const page = httpUrl(input.url),
    referrer = httpUrl(input.referrer);
  const utm = (key: string) => {
    const explicit = input[key];
    return (typeof explicit === "string" ? explicit : (page?.searchParams.get(key) ?? ""))
      .trim()
      .slice(0, 500);
  };
  let source = utm("utm_source").toLowerCase(),
    medium = utm("utm_medium").toLowerCase();
  const campaign = utm("utm_campaign");
  if (source || medium || campaign) {
    let channel: AcquisitionChannel = "other";
    const social =
      hasDomain(source, socialDomains) ||
      ["facebook", "instagram", "linkedin", "twitter", "x", "youtube", "tiktok"].includes(source);
    if (["paid_social", "paidsocial", "social_paid"].includes(medium)) channel = "paid_social";
    else if (["cpc", "ppc", "paidsearch", "paid_search"].includes(medium))
      channel = social ? "paid_social" : "paid_search";
    else if (medium === "organic") channel = "organic_search";
    else if (["social", "social-network", "social_media", "social-media"].includes(medium))
      channel = "organic_social";
    else if (medium === "referral") channel = "referral";
    return { channel, source: source || "(unknown)", medium: medium || "(none)", campaign };
  }
  const internalReferrer =
    page &&
    referrer &&
    (page.hostname.replace(/^www\./, "") === referrer.hostname.replace(/^www\./, "") ||
      (hasDomain(page.hostname, internalDomains) && hasDomain(referrer.hostname, internalDomains)));
  if (referrer && !internalReferrer) {
    source = referrer.hostname.toLowerCase();
    const channel = hasDomain(source, searchDomains)
      ? "organic_search"
      : hasDomain(source, socialDomains)
        ? "organic_social"
        : "referral";
    medium =
      channel === "organic_search"
        ? "organic"
        : channel === "organic_social"
          ? "social"
          : "referral";
    return { channel, source, medium, campaign };
  }
  return page
    ? { channel: "direct", source: "(direct)", medium: "(none)", campaign }
    : { channel: "unknown", source: "(unknown)", medium: "(unknown)", campaign };
}
