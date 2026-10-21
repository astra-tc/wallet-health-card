import asyncio
from playwright.async_api import async_playwright
SHIELD='''<svg viewBox="0 0 100 100" width="{w}" height="{w}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2f81f7"/><stop offset="1" stop-color="#3fb950"/></linearGradient></defs>
<path d="M50 6 L88 20 V48 C88 72 70 88 50 95 C30 88 12 72 12 48 V20 Z" fill="url(#g)"/>
<path d="M22 54 H36 L42 40 L52 68 L60 48 L66 54 H78" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>'''
LOGO=f'<html><body style="margin:0;width:512px;height:512px;background:#0d1117;display:flex;align-items:center;justify-content:center">{SHIELD.format(w=400)}</body></html>'
VIS=f'''<html><body style="margin:0;width:1600px;height:900px;background:radial-gradient(circle at 30% 30%,#1b2a44,#0d1117);font-family:system-ui;color:#e6edf3;display:flex;align-items:center;padding:0 90px;box-sizing:border-box;gap:70px">
<div>{SHIELD.format(w=380)}</div><div><div style="font-size:84px;font-weight:800">Wallet Health Card</div>
<div style="font-size:38px;color:#8b949e;margin:18px 0 34px">Find risky approvals, address poisoning &amp; spam tokens across chains in one click</div>
<div style="display:flex;gap:16px;font-size:28px"><span style="background:#3fb95022;border:2px solid #3fb950;padding:10px 20px;border-radius:12px">A–F grade</span><span style="background:#f8514922;border:2px solid #f85149;padding:10px 20px;border-radius:12px">Poisoning detection</span><span style="background:#2f81f722;border:2px solid #2f81f7;padding:10px 20px;border-radius:12px">Read-only</span></div>
<div style="font-size:27px;white-space:nowrap;margin-top:40px">Powered by <b>Blockscout PRO API</b> · astratc.github.io/wallet-health-card</div></div></body></html>'''
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch()
    for html,w,h,out in [(LOGO,512,512,'../logo.png'),(VIS,1600,900,'../x_visual.png')]:
      pg=await b.new_page(viewport={'width':w,'height':h}); await pg.set_content(html); await pg.screenshot(path=out); await pg.close()
    await b.close()
asyncio.run(main())
