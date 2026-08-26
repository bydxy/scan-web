/**
 * 内容解析与快捷动作层
 *
 * 分类优先级：
 * 原生 scheme 直通 > WiFi/名片/日历结构化内容 > 已知 App 域名 > 普通链接(含风险提示)
 * > 电话/邮件 > 地址猜测 > 纯文本
 */

export type ContentKind =
  | 'app' | 'url' | 'text' | 'tel' | 'mailto'
  | 'wifi' | 'vcard' | 'event' | 'product';

export interface Resolved {
  kind: ContentKind;
  appName?: string;
  scheme?: string;
  webUrl?: string;
  display: string;
  /** 快捷动作（结果面板按钮） */
  actions?: ContentAction[];
  /** 风险提示（http / IP 直连 / 伪装域名） */
  risk?: string;
}

export interface ContentAction {
  label: string;
  run: () => void;
}

interface AppRule {
  name: string;
  hosts?: string[];
  build?: (u: URL) => string | null;
}

const enc = encodeURIComponent;

const RULES: AppRule[] = [
  { name: '支付宝', hosts: ['alipay.com', 'alipaydev.com'], build: (u) => `alipays://platformapi/startapp?saId=10000007&qrcode=${enc(u.href)}` },
  { name: '抖音', hosts: ['douyin.com', 'iesdouyin.com'], build: (u) => `snssdk1128://webview?url=${enc(u.href)}` },
  { name: '快手', hosts: ['kuaishou.com'], build: (u) => `kwai://webview?url=${enc(u.href)}` },
  { name: '百度', hosts: ['baidu.com'], build: (u) => `baiduboxapp://browse?url=${enc(u.href)}` },
  { name: '微信', hosts: ['weixin.qq.com', 'wx.tenpay.com'] },
  { name: '淘宝', hosts: ['taobao.com', 'tmall.com', 'tb.cn'] },
  { name: '京东', hosts: ['jd.com', 'jingxi.com'] },
  { name: '拼多多', hosts: ['pinduoduo.com', 'yangkeduo.com'] },
  { name: '美团', hosts: ['meituan.com', 'meituan.cn', 'dianping.com'] },
  { name: '饿了么', hosts: ['ele.me'] },
  { name: '哔哩哔哩', hosts: ['bilibili.com', 'b23.tv'] },
  { name: '微博', hosts: ['weibo.com', 'weibo.cn'] },
  { name: '知乎', hosts: ['zhihu.com'] },
  { name: '小红书', hosts: ['xiaohongshu.com', 'xhslink.com'] },
  { name: '携程', hosts: ['ctrip.com', 'trip.com'] },
  { name: 'QQ', hosts: ['qq.com'] },
];

function matchHost(hostname: string, list: string[]): boolean {
  const h = hostname.toLowerCase();
  return list.some((d) => h === d || h.endsWith('.' + d));
}

/* ---------- 结构化内容解析 ---------- */

export interface WifiInfo { ssid: string; password: string; auth: string }

export function parseWifi(text: string): WifiInfo | null {
  const seg = '(?:[^;\\\\]|\\\\.)*';
  const re = new RegExp(
    `^WIFI:(?:T:(${seg});)?(?:S:(${seg});)?(?:P:(${seg});)?`,
    'i'
  );
  const m = re.exec(text.trim());
  if (!m || !m[2]) return null;
  return { auth: unescape(m[1] ?? ''), ssid: unescape(m[2]), password: unescape(m[3] ?? '') };
}

function unescape(s: string): string {
  return s.replace(/\\([:,;\\"])/g, '$1');
}

export function isVCard(text: string): boolean {
  return /^BEGIN:VCARD[\s\S]*END:VCARD/i.test(text.trim());
}

export function isVEvent(text: string): boolean {
  return /^BEGIN:VEVENT[\s\S]*END:VEVENT/i.test(text.trim());
}

/** EAN-8/EAN-13/UPC 纯数字 → 商品码 */
function productCode(t: string): boolean {
  return /^(?:\d{8}|\d{12,14})$/.test(t);
}

/** 中国地址粗判：含省/市/区/路/街道关键词且较长 */
function looksLikeAddress(t: string): boolean {
  return (
    t.length >= 8 && t.length <= 120 &&
    /(省|市|区|县|镇|乡|路|街|道|巷|号|大厦|广场|小区)/.test(t) &&
    !/^https?:\/\//i.test(t)
  );
}

/** URL 风险提示 */
function urlRisk(u: URL): string | undefined {
  if (u.protocol === 'http:') return '非加密连接 (HTTP)，注意信息安全';
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(u.hostname)) return 'IP 直连地址，谨慎访问';
  if (u.hostname.includes('xn--')) return '含伪装域名编码，谨防钓鱼';
  return undefined;
}

function mapSearch(keyword: string): ContentAction {
  return {
    label: '地图搜索',
    run: () =>
      window.open(
        `https://uri.amap.com/search?keyword=${enc(keyword)}`,
        '_blank',
        'noopener'
      ),
  };
}

function downloadBlob(name: string, mime: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

const copyText = (t: string) => () => navigator.clipboard.writeText(t).catch(() => undefined);

/* ---------- 主分类 ---------- */

export function classify(raw: string): Resolved {
  const t = raw.trim();

  if (/^wxp:\/\//i.test(t))
    return { kind: 'app', appName: '微信', scheme: t, display: '微信支付码' };
  if (/^weixin:\/\//i.test(t))
    return { kind: 'app', appName: '微信', scheme: t, display: '微信' };
  if (/^alipay(s)?:\/\//i.test(t))
    return { kind: 'app', appName: '支付宝', scheme: t, display: '支付宝' };

  if (/^tel:/i.test(t)) {
    const num = t.replace(/^tel:/i, '');
    return {
      kind: 'tel',
      webUrl: t,
      display: num,
      actions: [{ label: '拨打电话', run: () => (location.href = t) }, { label: '复制号码', run: copyText(num) }],
    };
  }
  if (/^mailto:/i.test(t)) {
    const addr = t.replace(/^mailto:/i, '').split('?')[0];
    return {
      kind: 'mailto',
      webUrl: t,
      display: addr,
      actions: [{ label: '发送邮件', run: () => (location.href = t) }, { label: '复制邮箱', run: copyText(addr) }],
    };
  }

  // WiFi
  const wifi = parseWifi(t);
  if (wifi)
    return {
      kind: 'wifi',
      display: `Wi-Fi · ${wifi.ssid}`,
      actions: [
        { label: '复制密码', run: copyText(wifi.password) },
        { label: '复制名称', run: copyText(wifi.ssid) },
      ],
    };

  // 名片 / 日历
  if (isVCard(t))
    return {
      kind: 'vcard',
      display: '联系人名片',
      actions: [{ label: '保存到通讯录 (.vcf)', run: () => downloadBlob('contact.vcf', 'text/vcard', t) }],
    };
  if (isVEvent(t))
    return {
      kind: 'event',
      display: '日程邀请',
      actions: [{ label: '加入日历 (.ics)', run: () => downloadBlob('event.ics', 'text/calendar', t) }],
    };

  // URL
  let u: URL | null = null;
  if (/^https?:\/\//i.test(t)) {
    try {
      u = new URL(t);
    } catch {
      u = null;
    }
  }
  if (u) {
    const rule = RULES.find((r) => r.hosts && matchHost(u!.hostname, r.hosts));
    const risk = urlRisk(u);
    if (rule) {
      const scheme = rule.build ? rule.build(u) : null;
      const actions: ContentAction[] = [];
      if (scheme)
        actions.push({
          label: `打开${rule.name}`,
          run: () => jumpScheme(scheme, u!.href),
        });
      else actions.push({ label: `打开${rule.name}`, run: () => openWeb(u!.href) });
      return {
        kind: 'app',
        appName: rule.name,
        scheme: scheme ?? undefined,
        webUrl: u.href,
        display: rule.name,
        risk,
        actions,
      };
    }
    return {
      kind: 'url',
      webUrl: u.href,
      display: u.hostname.replace(/^www\./, ''),
      risk,
      actions: [
        { label: '打开链接', run: () => openWeb(u!.href) },
        { label: '复制链接', run: copyText(u!.href) },
      ],
    };
  }

  // 商品条码
  if (productCode(t))
    return {
      kind: 'product',
      display: `商品码 ${t}`,
      actions: [
        { label: '淘宝搜同款', run: () => openWeb(`https://s.taobao.com/search?q=${enc(t)}`) },
        { label: '京东搜同款', run: () => openWeb(`https://search.jd.com/Search?keyword=${enc(t)}`) },
        { label: '复制条码', run: copyText(t) },
      ],
    };

  // 地址
  if (looksLikeAddress(t))
    return {
      kind: 'text',
      display: t.length > 18 ? t.slice(0, 17) + '…' : t,
      actions: [mapSearch(t), { label: '复制地址', run: copyText(t) }],
    };

  return {
    kind: 'text',
    display: t.length > 18 ? t.slice(0, 17) + '…' : t,
    actions: [{ label: '一键复制', run: copyText(t) }],
  };
}

/* ---------- 跳转执行 ---------- */

export function openWeb(url: string): void {
  window.open(url, '_blank', 'noopener');
}

export function jumpScheme(scheme: string, fallbackUrl?: string): void {
  const start = Date.now();
  location.href = scheme;
  setTimeout(() => {
    if (!document.hidden && Date.now() - start < 3000 && fallbackUrl) {
      openWeb(fallbackUrl);
    }
  }, 1500);
}

export function activate(r: Resolved): void {
  if (r.scheme) return jumpScheme(r.scheme, r.webUrl);
  if (r.kind === 'tel' || r.kind === 'mailto') {
    location.href = r.webUrl!;
    return;
  }
  const primary = r.actions?.find((a) => /^(打开|访问)/.test(a.label));
  if (primary) return primary.run();
  if (r.webUrl) openWeb(r.webUrl);
}
