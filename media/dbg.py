import asyncio
from playwright.async_api import async_playwright
KEY=open('/workspace/secure/blockscout_api_key.txt').read().strip()
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch(); pg=await b.new_page()
    pg.on('console',lambda m:print('CONSOLE',m.text[:200]))
    pg.on('requestfailed',lambda r:print('FAIL',r.url[:120],r.failure))
    await pg.goto('https://astratc.github.io/wallet-health-card/?v=4')
    await pg.fill('#addr','0x220866B1A2219f40e72f5c628B65D54268cA3A9D'); await pg.fill('#key',KEY); await pg.click('#go')
    for i in range(12):
      await pg.wait_for_timeout(10000); t=(await pg.inner_text('#out'))[:200].replace('\n',' '); print(i,t)
      if 'Scanning' not in t: break
    await b.close()
asyncio.run(main())
