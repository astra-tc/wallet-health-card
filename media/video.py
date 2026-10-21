import asyncio, subprocess, json, time, os, shutil
from playwright.async_api import async_playwright
KEY=open('/workspace/secure/blockscout_api_key.txt').read().strip()
A='0x3DdfA8eC3052539b6C9549F12cEA2C295cfF5296'
APP='https://astratc.github.io/wallet-health-card/?v=9'
os.makedirs('tmp',exist_ok=True)
S=[ # (caption/narration, action)
 ("Wallet Health Card. A multichain wallet security check, powered by the Blockscout PRO API.", "home"),
 ("Wallets get drained by two quiet problems: forgotten unlimited token approvals, and address poisoning, where a look-alike address sends you a zero value transfer so you copy the wrong address from your history.", None),
 ("Checking for both normally means decoding approve calls and comparing addresses by eye, on every chain you use. We do it in one click.", None),
 ("Paste any address. Here we use a well known public wallet on Ethereum. Then add a free Blockscout PRO API key. It stays in your browser.", "fill"),
 ("Press scan. One key covers Ethereum, Optimism, Arbitrum, Gnosis and Scroll. We only change the chain ID in the Blockscout URL.", "scan"),
 ("Under the hood, every chain is queried through the Blockscout PRO API: address info, counters, token balances, paginated ERC-20 transfers, and paginated transactions with decoded input.", "waitscan"),
 ("Base, Polygon and ZKsync need a paid Blockscout plan, so on a free key they are skipped with a clear note instead of failing.", None),
 ("The result is a grade from A to F, plus the number of Blockscout API calls and the credits left on the key.", "top"),
 ("Findings are ranked by severity. Here, an unlimited approval of LUSD to a Curve router, and two address poisoning attempts.", "findings"),
 ("Look closely: both fake addresses start with 0x5dc1 and end with e4e8, exactly like a real contact this wallet paid before. That is the poisoning pattern.", None),
 ("Every finding links straight to its evidence in Blockscout Explorer. Here is the approval transaction itself: method approve, success, on Ethereum.", "explorer"),
 ("Back in the card, each chain shows its open approvals, with the spender's name and verification status from Blockscout, and a link to revoke.", "chains"),
 ("We also flag spam and airdrop bait tokens, like fake claim sites, which Blockscout token data lets us catch even when they are not yet marked as scams.", "tokens"),
 ("It is read only. No wallet connection, and no signatures. The same core also runs as a command line tool, and the test suite runs offline against a mocked API.", "top"),
 ("Next, we will add watch mode alerts for new poisoning attempts and approvals, approval value at risk, and a pay per scan endpoint for AI agents.", None),
 ("Wallet Health Card. Open source, at astratc.github.io/wallet-health-card. Built on Blockscout.", "end"),
]
CAP="""(t)=>{let d=document.getElementById('cap');if(!d){d=document.createElement('div');d.id='cap';d.style.cssText='position:fixed;left:40px;right:40px;bottom:24px;background:rgba(0,0,0,.82);color:#fff;font:600 22px system-ui;padding:14px 20px;border-radius:12px;z-index:99999;text-align:center;line-height:1.35';document.body.appendChild(d)}d.textContent=t}"""
SAY={'chain ID':'chain I D','ERC-20':'E R C 20','ZKsync':'Z K sync','LUSD':'L U S D','0x5dc1':'five d c one','e4e8':'e four e eight','AI agents':'A I agents','astratc.github.io/wallet-health-card':'astra t c dot github dot io, slash wallet health card'}
def tts(i,t):
  for k,v in SAY.items(): t=t.replace(k,v)
  f=f'tmp/n{i}.wav'; subprocess.run(['espeak-ng','-v','en-us+m3','-s','135','-w',f,t],check=True)
  d=float(subprocess.check_output(['ffprobe','-v','0','-show_entries','format=duration','-of','csv=p=0',f]).decode()); return f,d
async def main():
  aud=[tts(i,t) for i,(t,_) in enumerate(S)]
  async with async_playwright() as p:
    b=await p.chromium.launch(); ctx=await b.new_context(viewport={'width':1280,'height':720},record_video_dir='tmp/vid',record_video_size={'width':1280,'height':720})
    pg=await ctx.new_page(); t0=time.time(); await pg.goto(APP); cur=pg; starts=[]; ex=None
    for i,(text,act) in enumerate(S):
      st=time.time()-t0; starts.append(st)
      try: await cur.evaluate(CAP,text)
      except Exception: pass
      if act=='fill':
        await pg.click('#addr'); await pg.type('#addr',A,delay=25); await pg.fill('#key',KEY); await cur.evaluate(CAP,text)
      elif act=='scan': await pg.click('#go'); await pg.evaluate(CAP,text)
      elif act=='waitscan':
        await pg.wait_for_selector('.grade',timeout=240000); await pg.evaluate("localStorage.removeItem('bs_key')"); await pg.evaluate(CAP,text)
      elif act=='top': await cur.evaluate('window.scrollTo({top:0,behavior:"smooth"})')
      elif act=='findings': await pg.evaluate('document.querySelectorAll(".card")[2].scrollIntoView({behavior:"smooth"})')
      elif act=='explorer':
        href=await pg.locator('a:has-text("view tx")').first.get_attribute('href'); await pg.goto(href); await pg.wait_for_timeout(4000); await pg.evaluate(CAP,text)
      elif act=='chains':
        await pg.go_back(); await pg.click('#demo'); await pg.wait_for_selector('.grade'); await pg.evaluate(CAP,text)
        await pg.evaluate('[...document.querySelectorAll("h3")].find(h=>h.textContent.includes("Arbitrum")).scrollIntoView({behavior:"smooth"})')
      elif act=='tokens': await pg.evaluate('[...document.querySelectorAll("h4")].filter(h=>h.textContent.startsWith("Tokens"))[0].scrollIntoView({behavior:"smooth"})')
      elif act=='end': await pg.evaluate('window.scrollTo(0,0)')
      need=aud[i][1]+1.6-(time.time()-t0-st)
      if need>0: await pg.wait_for_timeout(int(need*1000))
    total=time.time()-t0; vp=await pg.video.path(); await ctx.close(); await b.close()
  json.dump({'starts':starts,'total':total},open('tmp/timing.json','w'))
  inputs=[]; flt=[]
  for i,(f,d) in enumerate(aud): inputs+=['-i',f]; flt.append(f'[{i+1}:a]adelay={int(starts[i]*1000)}|{int(starts[i]*1000)}[a{i}]')
  mix=';'.join(flt)+';'+''.join(f'[a{i}]' for i in range(len(aud)))+f'amix=inputs={len(aud)}:normalize=0[a]'
  subprocess.run(['ffmpeg','-y','-loglevel','error','-i',vp,*inputs,'-filter_complex',mix,'-map','0:v','-map','[a]','-c:v','libx264','-pix_fmt','yuv420p','-r','30','-vf','scale=1280:720','-c:a','aac','-b:a','128k','-shortest','-movflags','+faststart','../docs/demo.mp4'],check=True)
  print('total',round(total,1))
asyncio.run(main())
