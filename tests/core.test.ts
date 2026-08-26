import { describe, it, expect, beforeAll } from 'vitest';

/* localStorage 桩（Node 环境无 DOM） */
const store = new Map<string, string>();
beforeAll(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  });
});

describe('码型映射', async () => {
  const { toZxing, toNative, GROUPS, prettyFormat } = await import('../src/formats.js');

  it('原生↔ZXing 往返一致', () => {
    const native = ['qr_code', 'ean_13', 'code_128'];
    expect(toNative(toZxing(native))).toEqual(native);
  });

  it('分组子集均为合法码型', () => {
    for (const g of Object.values(GROUPS)) {
      expect(g.native.length).toBe(g.zxing.length);
      expect(toZxing(g.native)).toEqual(g.zxing);
    }
  });

  it('展示名统一', () => {
    expect(prettyFormat('qr_code')).toBe(prettyFormat('QRCode'));
    expect(prettyFormat('unknown_x')).toBe('unknown_x');
  });
});

describe('内容分类', async () => {
  const { classify, parseWifi } = await import('../src/apps.js');

  it('原生支付 scheme 直通', () => {
    expect(classify('wxp://f2f0xxx').appName).toBe('微信');
    expect(classify('alipays://platformapi/startapp').appName).toBe('支付宝');
  });

  it('支付宝收款链接构造官方唤起 scheme', () => {
    const r = classify('https://qr.alipay.com/abc123');
    expect(r.appName).toBe('支付宝');
    expect(r.scheme).toContain('saId=10000007');
    expect(r.scheme).toContain(encodeURIComponent('https://qr.alipay.com/abc123'));
  });

  it('未知域名仅显 hostname', () => {
    const r = classify('https://www.example.com/path?q=1');
    expect(r.kind).toBe('url');
    expect(r.display).toBe('example.com');
  });

  it('http 链接给出风险提示', () => {
    expect(classify('http://example.com').risk).toBeTruthy();
    expect(classify('https://example.com').risk).toBeUndefined();
  });

  it('纯数字商品码识别', () => {
    expect(classify('6901028089296').kind).toBe('product');
    expect(classify('12345678').kind).toBe('product');
    expect(classify('1234567').kind).toBe('text');
  });

  it('电话与文本', () => {
    expect(classify('tel:13800138000').kind).toBe('tel');
    expect(classify('hello world').kind).toBe('text');
  });

  it('WiFi 解析', () => {
    const w = parseWifi('WIFI:T:WPA;S:MyHome;P:pass\\;word;;');
    expect(w).not.toBeNull();
    expect(w!.ssid).toBe('MyHome');
    expect(w!.password).toBe('pass;word');
    expect(parseWifi('not wifi')).toBeNull();
  });
});

describe('历史存储', async () => {
  const h = await import('../src/history.js');

  it('去重写入', () => {
    expect(h.add('abc', 'QRCode', 'text')).toBe(true);
    expect(h.add('abc', 'QRCode', 'text')).toBe(false);
    expect(h.query().length).toBe(1);
  });

  it('收藏/备注/删除', () => {
    h.add('xyz', 'EAN13', 'product');
    const item = h.query({ query: 'xyz' })[0];
    h.toggleFav(item.id);
    h.setNote(item.id, '我的水');
    const after = h.query({ favOnly: true });
    expect(after[0].fav).toBe(true);
    expect(after[0].note).toBe('我的水');
    h.remove(item.id);
    expect(h.query({ favOnly: true }).length).toBe(0);
  });

  it('自动清理保留收藏', () => {
    const old = Date.now() - 40 * 864e5;
    h.add('old', 'QRCode', 'url', old);
    h.add('fresh-fav', 'QRCode', 'text');
    const favItem = h.query({ query: 'fresh-fav' })[0];
    h.toggleFav(favItem.id);
    h.add('old-fav', 'QRCode', 'url', old);
    const oldFav = h.query({ query: 'old-fav' })[0];
    h.toggleFav(oldFav.id);

    const removed = h.autoClean(30);
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(h.has('old')).toBe(false);
    expect(h.has('fresh-fav')).toBe(true);
    expect(h.has('old-fav')).toBe(true); // 收藏不过期
  });
});
