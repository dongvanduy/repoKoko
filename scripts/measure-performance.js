const fs=require("node:fs");
const path=require("node:path");
const {chromium}=require("@playwright/test");
const {database}=require("../test/helpers/database");
(async()=>{
  const db=await database();let server,browser;
  try {
    const Plan=require("../models/Plan"),Config=require("../models/Config");
    const plan=await Plan.create({title:{en:"Kimono rental"},desc:{en:"A comfortable kimono for your Kyoto visit."},image:"/img/gallery/1.jpg",price:3000,isVisible:true});
    await Config.insertMany([{key:"booking_inventory_v1",value:{ready:true}},{key:"hero_image",value:["/img/gallery/1.jpg"]}]);
    const {app}=require("../server");server=await new Promise(r=>{const s=app.listen(0,"127.0.0.1",()=>r(s));});
    browser=await chromium.launch({headless:true});
    const samples=[];
    for(const route of ["/","/plan/"+plan._id])for(let run=1;run<=5;run++){
      const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true,reducedMotion:"reduce"});
      // A reproducible local fixture, with third-party fonts/embeds excluded.
      await context.route(/^https:\/\//,r=>r.abort());
      await context.addInitScript(()=>{
        window.lab={lcp:0,cls:0,interactionDuration:0};let score=0,start=0,last=0;
        new PerformanceObserver(list=>{for(const e of list.getEntries())window.lab.lcp=e.startTime;}).observe({type:"largest-contentful-paint",buffered:true});
        new PerformanceObserver(list=>{for(const e of list.getEntries())if(!e.hadRecentInput){
          if(e.startTime-last>1000||e.startTime-start>5000){start=e.startTime;score=0;}
          last=e.startTime;score+=e.value;window.lab.cls=Math.max(window.lab.cls,score);
        }}).observe({type:"layout-shift",buffered:true});
        new PerformanceObserver(list=>{for(const e of list.getEntries())if(e.interactionId)window.lab.interactionDuration=Math.max(window.lab.interactionDuration,e.duration);}).observe({type:"event",buffered:true,durationThreshold:16});
      });
      const page=await context.newPage(),cdp=await context.newCDPSession(page);
      await cdp.send("Network.enable");await cdp.send("Network.setCacheDisabled",{cacheDisabled:true});
      await cdp.send("Network.emulateNetworkConditions",{offline:false,latency:150,downloadThroughput:200000,uploadThroughput:94000});
      await cdp.send("Emulation.setCPUThrottlingRate",{rate:4});
      const response=await page.goto("http://127.0.0.1:"+server.address().port+route+"?lang=en",{waitUntil:"networkidle"});
      if(response.status()!==200)throw Error("fixture_failed");
      await page.waitForTimeout(500);
      if(route!=="/")await page.locator('input[name="fullname"]').fill("Lab test");
      else await page.keyboard.press("Tab");
      await page.waitForTimeout(200);
      const metric=await page.evaluate(()=>({...window.lab,ttfb:performance.getEntriesByType("navigation")[0].responseStart,resources:performance.getEntriesByType("resource").filter(e=>new URL(e.name).origin===location.origin).reduce((sum,e)=>sum+e.transferSize,0)}));
      samples.push({page:route==="/"?"home":"detail",run,...metric});await context.close();
    }
    const percentile=values=>values.sort((a,b)=>a-b)[Math.ceil(values.length*.75)-1];
    const summary=Object.fromEntries(["home","detail"].map(page=>[page,Object.fromEntries(["lcp","cls","interactionDuration","ttfb","resources"].map(k=>[k,percentile(samples.filter(s=>s.page===page).map(s=>s[k]))]))]));
    const report={kind:"local synthetic fixture, not production field metrics or a before/after comparison",network:{latency:150,downloadBytesPerSecond:200000,cpuSlowdown:4},summary,samples};
    fs.mkdirSync(path.resolve("test-results"),{recursive:true});fs.writeFileSync("test-results/performance.json",JSON.stringify(report,null,2));
    console.log(JSON.stringify(summary,null,2));
  } finally {
    if(browser)await browser.close();
    if(server)await new Promise(r=>{server.close(r);server.closeAllConnections();});
    await db.close();
  }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
