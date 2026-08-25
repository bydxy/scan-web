/**
 * 内容解析与 App 跳转层
 *
 * 优先级：原生支付/应用 scheme 直通 > 已知域名（命名 + 尽力唤起）> 未知名域（仅显域名）> 纯文本。
 * 已知域名但无可靠 scheme 构造器时，直接打开 https 链接，
 * 由系统的 Universal Link / App Link 自动路由进 App——不硬造不可靠的 scheme。
 */

export interface Resolved {
  kind: 'app' | 'url' | 'text' | 'tel' | 'mailto';
  /** 命中的 App 名（微信/支付宝…），未知则缺省 */
  appName?: string;
  /** 可直接 location.href 的自定义 scheme */
  scheme?: string;
  /** 浏览器兜底链接 */
  webUrl?: string;
  /** 展示用短文本（标签 chip 与结果标题共用） */
  display: string;
}

interface AppRule {
  name: string;
  /** 原生 scheme 直通（wxp:// 等） */
  rawScheme?: RegExp;
  /** 域名匹配（对 hostname 或其父域做 endsWith） */
  hosts?: string[];
  /** 由 https 链接构造唤起 scheme；无则退化为直接开链接 */
  build?: (u: URL) => string | null;
}

const enc = encodeURIComponent;

/** 主流 App 规则表（持续扩充） */
const RULES: AppRule[] = [
  {
    name: '支付宝',
    hosts: ['alipay.com', 'alipaydev.com'],
    build: (u) =>
      `alipays://platformapi/startapp?saId=10000007&qrcode=${enc(u.href)}`,
  },
  {
    name: '抖音',
    hosts: ['douyin.com', 'iesdouyin.com'],
    build: (u) => `snssdk1128://webview?url=${enc(u.href)}`,
  },
  {
    name: '快手',
    hosts: ['kuaishou.com'],
    build: (u) => `kwai://webview?url=${enc(u.href)}`,
  },
  {
    name: '百度',
    hosts: ['baidu.com'],
    build: (u) => `baiduboxapp://browse?url=${enc(u.href)}`,
  },
  { name: '微信', hosts: ['weixin.qq.com', 'wx.tenpay.com', 'weixin.com'] },
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
  { name: '网易', hosts: ['163.com', '126.net'] },
];

function matchHost(hostname: string, list: string[]): boolean {
  const h = hostname.toLowerCase();
  return list.some((d) => h === d || h.endsWith('.' + d));
}

export function classify(raw: string): Resolved {
  const t = raw.trim();

  // 原生 scheme 直通
  if (/^wxp:\/\//i.test(t))
    return { kind: 'app', appName: '微信', scheme: t, display: '微信支付码' };
  if (/^weixin:\/\//i.test(t))
    return { kind: 'app', appName: '微信', scheme: t, display: '微信' };
  if (/^alipay(s)?:\/\//i.test(t))
    return { kind: 'app', appName: '支付宝', scheme: t, display: '支付宝' };

  if (/^tel:/i.test(t))
    return { kind: 'tel', display: t.replace(/^tel:/i, ''), webUrl: t };
  if (/^mailto:/i.test(t))
    return { kind: 'mailto', display: t.replace(/^mailto:/i, ''), webUrl: t };

  // URL 解析
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
    if (rule) {
      const scheme = u && rule.build ? rule.build(u) : null;
      return {
        kind: 'app',
        appName: rule.name,
        scheme: scheme ?? undefined,
        webUrl: u.href,
        display: rule.name,
      };
    }
    return {
      kind: 'url',
      webUrl: u.href,
      display: u.hostname.replace(/^www\./, ''),
    };
  }

  // 纯文本
  return { kind: 'text', display: t.length > 18 ? t.slice(0, 17) + '…' : t };
}

/**
 * 唤起动作：
 * 有 scheme → 先尝试 scheme；1.5s 后若页面仍可见（说明 App 未响应）
 * 回落浏览器打开 webUrl。
 */
export function activate(r: Resolved): void {
  if (r.kind === 'tel' || r.kind === 'mailto') {
    location.href = r.webUrl!;
    return;
  }
  if (r.scheme) {
    const start = Date.now();
    location.href = r.scheme;
    setTimeout(() => {
      if (!document.hidden && Date.now() - start < 3000 && r.webUrl) {
        window.open(r.webUrl, '_blank', 'noopener');
      }
    }, 1500);
    return;
  }
  if (r.webUrl) {
    window.open(r.webUrl, '_blank', 'noopener');
  }
}
