import asyncio,os
from playwright.async_api import async_playwright
KEY=open('/workspace/secure/blockscout_api_key.txt').read().strip()
A='0x3DdfA8eC3052539b6C9549F12cEA2C295cfF5296'
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch(); pg=await b.new_page(viewport={'width':1280,'height':800})
    await pg.goto('https://astratc.github.io/wallet-health-card/?v=3'); await pg.screenshot(path='../screenshots/1_home.png')
    await pg.fill('#addr',A); await pg.fill('#key',KEY); await pg.click('#go')
    await pg.wait_for_selector('.grade',timeout=240000); await pg.wait_for_timeout(500)
    await pg.evaluate("localStorage.removeItem('bs_key')")
    await pg.screenshot(path='../screenshots/2_scan_grade_findings.png')
    await pg.locator('h3:has-text("Arbitrum One")').scroll_into_view_if_needed(); await pg.screenshot(path='../screenshots/3_chain_approvals_tokens.png')
    href=await pg.locator('a:has-text("view tx")').first.get_attribute('href'); print('explorer',href)
    e=await b.new_page(viewport={'width':1280,'height':800}); r=await e.goto(href); await e.wait_for_timeout(8000); print('status',r.status, await e.title())
    await e.screenshot(path='../screenshots/4_blockscout_explorer_finding.png')
    await b.close()
asyncio.run(main())
