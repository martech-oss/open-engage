import type { LandingPageDocument, LandingFormBinding } from "@openengage/core/web";

import { escapeHtml } from "../rendering/html";
import { sanitizeLandingDocument, sanitizeLandingHtml } from "./landing-safety";

export interface LandingRenderOptions {
  workspaceSlug: string;
  origin: string;
  pageSlug: string;
  measurementToken: string;
  formBindings: LandingFormBinding[];
  imageUrls: Record<string, string>;
  dynamicContents?: Record<string, string> | undefined;
  preview: boolean;
  resolved?: boolean;
  visitorToken?: string;
}

export async function renderLandingPage(
  input: LandingPageDocument,
  options: LandingRenderOptions,
): Promise<string> {
  const document = await sanitizeLandingDocument(input);
  let rewriter = new HTMLRewriter();
  for (const form of document.forms) {
    const binding = options.formBindings.find((item) => item.refId === form.refId);
    const content =
      options.preview || !binding
        ? `<section aria-label="${escapeHtml(form.name)}"><label>メールアドレス <input type="email" disabled placeholder="プレビューでは送信できません"></label><button disabled>送信する</button></section>`
        : `<iframe title="${escapeHtml(form.name)}" style="width:100%;min-height:540px;border:0" src="${escapeHtml(`${options.origin}/f/${options.workspaceSlug}/lp-${binding.formId}?measurementToken=${encodeURIComponent(options.measurementToken)}${options.visitorToken ? `&consent=true&oe_v=${encodeURIComponent(options.visitorToken)}` : ""}`)}"></iframe>`;
    rewriter = rewriter.on(`[data-oe-form="${form.refId}"]`, {
      element: (element) => {
        element.setInnerContent(content, { html: true });
      },
    });
  }
  for (const cta of document.ctas)
    rewriter = rewriter.on(`[data-oe-cta="${cta.refId}"]`, {
      element: (element) => {
        element.setAttribute("href", options.preview ? "#" : cta.href);
        element.setInnerContent(escapeHtml(cta.label), { html: true });
      },
    });
  for (const image of document.images)
    rewriter = rewriter.on(`[data-oe-image="${image.refId}"]`, {
      element: (element) => {
        const url = options.imageUrls[image.assetId];
        if (url) element.setAttribute("src", url);
        element.setAttribute("alt", image.alt);
        element.setAttribute("loading", "lazy");
      },
    });
  for (const slot of document.dynamicSlots) {
    const content = await sanitizeLandingHtml(
      options.dynamicContents?.[slot.refId] ?? slot.fallbackHtml,
    );
    rewriter = rewriter.on(`[data-oe-dynamic="${slot.refId}"]`, {
      element: (element) => {
        element.setInnerContent(content, { html: true });
      },
    });
  }
  const body = await rewriter.transform(new Response(document.html)).text();
  const config = JSON.stringify({
    workspaceSlug: options.workspaceSlug,
    origin: options.origin,
    pageSlug: options.pageSlug,
    token: options.measurementToken,
    resolved: options.resolved === true,
    visitorToken: options.visitorToken ?? null,
  }).replaceAll("<", "\\u003c");
  const runtime = options.preview
    ? ""
    : `<script>(function(){
    const config=${config}, key="openengage_visitor_"+config.workspaceSlug, consentKey="openengage_consent_"+config.workspaceSlug;
    let token=config.visitorToken, active=config.resolved;
    function stampRedirects(){ for(const link of document.querySelectorAll("a[href]")){try{const url=new URL(link.href,location.href);if(url.origin!==config.origin||!url.pathname.startsWith("/r/"+config.workspaceSlug+"/"))continue;if(active&&token){url.searchParams.set("oe_v",token);url.searchParams.set("consent","true")}else{url.searchParams.delete("oe_v");url.searchParams.delete("consent")}link.href=url.toString();}catch{}} }
    function withdraw(){active=false;token=null;try{localStorage.removeItem(key);localStorage.removeItem(consentKey)}catch{}location.reload();}
    document.getElementById("oe-consent-withdraw")?.addEventListener("click",withdraw);
    async function resolve(){
      if(active)return;const button=document.getElementById("oe-consent-accept");if(button)button.disabled=true;
      try { let previous;try{previous=localStorage.getItem(key)}catch{}
        const response=await fetch(config.origin+"/api/public/landing/"+config.workspaceSlug+"/"+config.pageSlug+"/resolve",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({consent:true,visitorToken:previous,source:{url:location.href,referrer:document.referrer}})});
        if(!response.ok)throw new Error("計測設定を読み込めませんでした");const result=await response.json();
        try{localStorage.setItem(consentKey,"true");localStorage.setItem(key,result.data.visitorToken)}catch{}
        document.open();document.write(result.data.html);document.close();
      }catch{if(button){button.disabled=false;button.textContent="再試行する"}}
    }
    function event(type,refId){if(!active||!token)return;void fetch(config.origin+"/api/public/landing/events",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({consent:true,visitorToken:token,measurementToken:config.token,type,refId}),keepalive:true}).catch(()=>{});}
    document.getElementById("oe-consent-accept")?.addEventListener("click",resolve);
    document.getElementById("oe-consent-decline")?.addEventListener("click",()=>document.getElementById("oe-consent")?.remove());
    document.addEventListener("click",eventObject=>{const link=eventObject.target.closest?.("[data-oe-cta]");if(link)event("cta_clicked",link.getAttribute("data-oe-cta"));});
    window.addEventListener("message",message=>{if(message.origin!==config.origin||message.data?.type!=="openengage:form-identity"||!active)return;const known=[...document.querySelectorAll("iframe")].some(frame=>frame.contentWindow===message.source);if(!known||typeof message.data.visitorToken!=="string")return;token=message.data.visitorToken;try{localStorage.setItem(key,token)}catch{}active=false;void resolve();});
    stampRedirects();
    if(active){event("page_viewed");}else{try{if(localStorage.getItem(consentKey)==="true")void resolve()}catch{}}
  })();</script>`;
  const consent = options.preview
    ? ""
    : options.resolved
      ? '<button id="oe-consent-withdraw" type="button" style="margin:1rem">閲覧計測を停止する</button>'
      : '<aside id="oe-consent" role="region" aria-label="閲覧計測の同意" style="padding:1rem;background:#fff;color:#17202a;border-top:1px solid #ccc"><p>閲覧履歴を問い合わせ情報と関連付けて利用します。フォームは同意せずに送信できます。</p><button id="oe-consent-accept" type="button">閲覧計測を許可</button> <button id="oe-consent-decline" type="button">同意せずに続ける</button></aside>';
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${escapeHtml(document.description)}"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'; font-src 'none'; script-src ${options.preview ? "'none'" : "'unsafe-inline'"}; connect-src ${options.preview ? "'none'" : escapeHtml(options.origin)}; frame-src ${options.preview ? "'none'" : escapeHtml(options.origin)}; form-action 'none'; base-uri 'none'"><title>${escapeHtml(document.title)}</title><style>${document.css.replaceAll("<", "\\3c ")}</style></head><body>${body}${consent}${runtime}</body></html>`;
}
