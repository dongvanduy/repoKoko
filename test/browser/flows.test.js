const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const argon2 = require("argon2");
const { chromium } = require("@playwright/test");
const { database } = require("../helpers/database");
test("both booking flows preserve Tokyo wall time in four browser zones; admin and headers", {timeout:120000}, async t => {
  const db=await database(); t.after(db.close);
  process.env.ADMIN_PASSWORD_HASH=await argon2.hash("test-password",{type:argon2.argon2id});
  const Plan=require("../../models/Plan"), Config=require("../../models/Config"), Booking=require("../../models/booking");
  const plan=await Plan.create({title:{en:"Test Kimono",vi:"Kimono thử",jp:"テスト着物",zh:"测试和服"},desc:{en:"A comfortable kimono",vi:"Kimono thoải mái"},price:3000,isVisible:true,image:"/img/gallery/1.jpg"});
  await Config.create({key:"booking_inventory_v1",value:{ready:true}});
  await Config.create({key:"hero_image",value:["/img/gallery/1.jpg","/img/gallery/2.jpg"]});
  const {app}=require("../../server");
  const server=await new Promise(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const base="http://127.0.0.1:"+server.address().port;
  const browser=await chromium.launch({headless:true});
  t.after(()=>browser.close());
  const errors=[];

  fs.mkdirSync(path.resolve("test-results"),{recursive:true});
  const future=require("../../lib/time").bookingCalendar().tomorrow;
  const date=new Date("2026-10-19T08:00:00+09:00")>new Date(Date.now()+86400000)?"2026-10-19":future;
  for(const timezoneId of ["Asia/Ho_Chi_Minh","Asia/Tokyo","UTC","America/Los_Angeles"]){
    await t.test(timezoneId,async()=>{
      const context=await browser.newContext({timezoneId,viewport:{width:390,height:844},locale:"vi-VN"});
      await context.route(/^https:\/\//,route=>route.abort());
      const page=await context.newPage(); page.on("pageerror",e=>errors.push(e.message));page.on("console",m=>{if(/violates.*Content Security Policy|Refused to execute inline/.test(m.text()))errors.push(m.text());});
      await page.goto(base+"/plan/"+plan._id+"?lang=vi");
      assert.match(await page.locator("[data-slot-picker]").innerText(),/JST, UTC\+9/);
      await page.locator('input[name="fullname"]').fill("Khách Việt Nam");
      await page.locator('input[name="email"]').fill("test@example.invalid");
      await page.locator('input[name="phone"]').fill("0901234567");
      await page.locator('input[name="date"]').fill(date);
      await page.locator('input[name="time"][value="08:00"]').check({force:true});
      if(timezoneId==="Asia/Ho_Chi_Minh") await page.screenshot({path:"test-results/detail-mobile.png",fullPage:true});
      await page.locator('button[type="submit"]').click();
      await page.waitForURL("**/booking-success/**");
      if(timezoneId==="Asia/Ho_Chi_Minh") await page.screenshot({path:"test-results/success-mobile.png",fullPage:true});
      assert.match(await page.locator("main, body").first().innerText(),/08:00/);
      assert.match(await page.locator("body").innerText(),new RegExp(date));
      const first=await Booking.findOne({bookingCode:decodeURIComponent(new URL(page.url()).pathname.split("/").pop())});
      assert.equal(first.time,"08:00");assert.equal(first.date,date);
      assert.equal(first.startsAt.toISOString(),new Date(date+"T08:00:00+09:00").toISOString());
      const count=await Booking.countDocuments(); await page.reload();assert.equal(await Booking.countDocuments(),count);
      await page.goto(base+"/booking-step1?lang=vi");
      await page.locator(".quantity-select").selectOption("1");
      await page.locator('button[type="submit"]').click();
      await page.locator('input[name="date"]').fill(date);
      await page.locator('input[name="time"][value="08:00"]').check({force:true});
      await page.locator('button[type="submit"]').click();
      await page.locator('input[name="fullname"]').fill("Khách nhiều bước");
      await page.locator('input[name="email"]').fill("test@example.invalid");
      await page.locator('input[name="phone"]').fill("0901234567");
      await page.locator('input[name="time"][value="08:00"]').waitFor();
      await page.locator('button[type="submit"]:visible').last().click();
      await page.waitForURL("**/booking-success/**");
      assert.match(await page.locator("body").innerText(),/08:00/);
      const response=await page.request.get(base+"/api/available-slots?date="+date+"&shopId=1&totalQuantity=1");
      assert.equal(response.status(),200);assert.equal(response.headers()["cache-control"],"no-store");
      await context.close();
    });
  }
  await t.test("language links work without Referer and keep the current page",async()=>{
    const context=await browser.newContext();await context.route(/^https:\/\//,route=>route.abort());
    const page=await context.newPage();page.on("pageerror",e=>errors.push(e.message));
    const initial=await page.goto(base+"/?lang=vi&utm_source=language-test");
    assert.equal(initial.headers()["referrer-policy"],"no-referrer");
    for(const lang of ["en","jp","zh","vi"]){
      const requestPromise=page.waitForRequest(r=>new URL(r.url()).pathname==="/change-lang/"+lang);
      await page.locator('a[href^="/change-lang/'+lang+'?"]').click();
      const request=await requestPromise;
      assert.equal(request.headers().referer,undefined);
      await page.waitForURL(base+"/?utm_source=language-test");
      await page.locator('html[lang="'+lang+'"]').waitFor();
      assert.equal((await context.cookies()).find(c=>c.name==="lang").value,lang);
    }
    const missing=await context.request.get(base+"/change-lang/en",{maxRedirects:0});
    assert.equal(missing.status(),302);assert.equal(missing.headers().location,"/");
    assert.equal(missing.headers()["cache-control"],"no-store");
    for(const returnTo of ["//evil.invalid","https://evil.invalid","/change-lang/vi"]){
      const response=await context.request.get(base+"/change-lang/en?"+new URLSearchParams({returnTo}),{maxRedirects:0});
      assert.equal(response.headers().location,"/");
    }
    const back=await context.request.get(base+"/change-lang/jp?"+new URLSearchParams({returnTo:"/blog?lang=vi&page=2"}),{maxRedirects:0});
    assert.equal(back.headers().location,"/blog?page=2");
    await context.close();
  });
  await t.test("marketing pages, admin session rotation, CSRF and local assets",async()=>{
    const context=await browser.newContext({viewport:{width:1280,height:900}});
    await context.route(/^https:\/\//,route=>route.abort());
    const page=await context.newPage();page.on("pageerror",e=>errors.push(e.message));page.on("console",m=>{if(/violates.*Content Security Policy|Refused to execute inline/.test(m.text()))errors.push(m.text());});
    for(const route of ["/","/kimono-rental-kyoto","/kimono-photoshoot-kyoto","/blog","/blog/best-kimono-rental-kyoto"]){
      const response=await page.goto(base+route+"?lang=vi");assert.equal(response.status(),200,route);
      if(route==="/") await page.screenshot({path:"test-results/home-desktop.png"});
      assert.ok(response.headers()["content-security-policy"]);assert.equal(response.headers()["x-frame-options"],"SAMEORIGIN");
      assert.equal(await page.locator('script[src*="tailwind"]').count(),0);
    }
    await page.goto(base+"/login");const before=(await context.cookies()).find(c=>c.name==="kokoro.sid");
    const bad=await page.request.post(base+"/login",{form:{username:"testadmin",password:"test-password"}});assert.equal(bad.status(),403);
    await page.locator('[name="username"]').fill("testadmin");await page.locator('[name="password"]').fill("test-password");
    await page.locator('button[type="submit"]').click();await page.waitForURL("**/admin");
    const after=(await context.cookies()).find(c=>c.name==="kokoro.sid");
    assert.notEqual(after.value,before.value);assert.equal(after.httpOnly,true);assert.equal(after.sameSite,"Lax");
    await page.locator('[data-tab-target="bookings"]:visible').first().click();
    await page.locator("[data-booking-open]:visible").first().click();
    assert.match(await page.locator("#bookingDrawer").innerText(),/JST/);
    assert.equal(await page.evaluate(()=>document.activeElement.id),"closeBookingDrawer");
    await page.keyboard.press("Shift+Tab");
    assert.equal(await page.evaluate(()=>!!document.activeElement.closest("#bookingDrawer")),true);
    await page.keyboard.press("Escape");
    await page.locator('form[action="/logout"] button:visible').first().click();await page.waitForURL("**/login");
    const anonymous=await browser.newContext();const other=await anonymous.request.get(base+"/booking-success/"+(await Booking.findOne()).bookingCode);assert.equal(other.status(),404);await anonymous.close();
    await context.close();
  });
  await t.test("slot requests ignore late responses and expose a retry after errors",async()=>{
    const context=await browser.newContext(); const page=await context.newPage();
    page.on("pageerror",e=>errors.push(e.message));page.on("console",m=>{if(/violates.*Content Security Policy|Refused to execute inline/.test(m.text()))errors.push(m.text());});
    await page.goto(base+"/plan/"+plan._id);
    await page.locator('[name="time"]').first().waitFor();
    await page.route("**/api/available-slots?**",route=>route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"Temporary failure"})}));
    await page.locator('[name="date"]').fill("2029-01-02");
    await page.locator("[data-slot-retry]").waitFor({state:"visible"});
    assert.equal(await page.locator('button[type="submit"]').isDisabled(),true);
    await page.unroute("**/api/available-slots?**");
    await page.locator("[data-slot-retry]").click();await page.locator('[name="time"]').first().waitFor();
    let release, started;
    const gate=new Promise(r=>release=r), arrived=new Promise(r=>started=r);
    await page.route("**/api/available-slots?**",async route=>{
      const old=new URL(route.request().url()).searchParams.get("date")==="2029-01-03";
      if(old){started();await gate;}
      await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify([{time:old?"08:00":"09:00",remaining:20,isFull:false,isAvailable:true,reason:null}])}).catch(()=>{});
    });
    await page.locator('[name="date"]').fill("2029-01-03");await arrived;
    await page.locator('[name="date"]').fill("2029-01-04");
    await page.locator('[name="time"][value="09:00"]').waitFor();
    release();await page.waitForTimeout(100);
    assert.equal(await page.locator('[name="time"][value="08:00"]').count(),0);
    await context.close();
  });
  fs.mkdirSync(path.resolve("test-results"),{recursive:true});
  await t.test("changed price preserves contact fields and requires another confirmation",async()=>{
    await require("../../models/RateBucket").deleteMany({});
    const context=await browser.newContext();const page=await context.newPage();await page.goto(base+"/plan/"+plan._id);
    await page.locator('[name="fullname"]').fill("Price review");await page.locator('[name="email"]').fill("test@example.invalid");await page.locator('[name="phone"]').fill("0901234567");
    await page.locator('[name="time"][value="11:00"]').check({force:true});
    await Plan.updateOne({_id:plan._id},{$set:{price:3500}});
    const responsePromise=page.waitForResponse(r=>r.url()===base+"/booking"&&r.request().method()==="POST");
    await page.locator('button[type="submit"]').click();assert.equal((await responsePromise).status(),409);
    assert.equal(await page.locator('[name="fullname"]').inputValue(),"Price review");
    assert.equal(await Booking.countDocuments({fullname:"Price review"}),0);
    await page.locator('[name="time"][value="11:00"]').waitFor();
    await page.locator('button[type="submit"]:visible').first().click();await page.waitForURL("**/booking-success/**");
    assert.equal((await Booking.findOne({fullname:"Price review"})).totalPrice,3500);
    await Plan.updateOne({_id:plan._id},{$set:{price:3000}});await context.close();
  });
  await t.test("lost response after commit can retry the same form without duplicate booking",async()=>{
    const context=await browser.newContext();const page=await context.newPage();
    await page.goto(base+"/plan/"+plan._id);await page.locator('[name="time"][value="10:00"]').check({force:true});
    await page.locator('[name="fullname"]').fill("Network retry");await page.locator('[name="email"]').fill("test@example.invalid");await page.locator('[name="phone"]').fill("0901234567");
    const form=await page.locator("form").evaluate(form=>Object.fromEntries(new FormData(form)));
    const before=await Booking.countDocuments();
    let done;const committed=new Promise(r=>done=r);
    await page.route("**/booking",async route=>{await route.fetch({maxRedirects:0});done();await route.abort("connectionreset");});
    await page.locator('button[type="submit"]').click().catch(()=>{});await committed;
    const response=await context.request.post(base+"/booking",{form,maxRedirects:0});
    assert.equal(response.status(),303);assert.equal(await Booking.countDocuments(),before+1);
    const Job=require("../../models/Job"),booking=await Booking.findOne({fullname:"Network retry"});
    assert.equal(await Job.countDocuments({"payload.bookingId":String(booking._id)}),1);
    await context.close();
  });
  await t.test("login throttles failures, CSRF rejects multibyte input and database outage is safe",async()=>{
    const context=await browser.newContext();const page=await context.newPage();await page.goto(base+"/login");
    const csrfToken=await page.locator('[name="csrfToken"]').inputValue();
    const bad=await context.request.post(base+"/login",{form:{csrfToken:"é".repeat(64),username:"no-user",password:"wrong"}});
    assert.equal(bad.status(),403);
    for(let i=0;i<5;i++)assert.equal((await context.request.post(base+"/login",{form:{csrfToken,username:"no-user",password:"wrong"}})).status(),401);
    assert.equal((await context.request.post(base+"/login",{form:{csrfToken,username:"no-user",password:"wrong"}})).status(),429);
    await context.close();
    await db.mongoose.disconnect();
    const health=await fetch(base+"/health");assert.equal(health.status,503);
    const failed=await fetch(base+"/api/available-slots?date="+date+"&shopId=1&totalQuantity=1");
    assert.equal(failed.status,503);assert.equal((await failed.json()).code,"service_unavailable");
  });
  fs.writeFileSync(path.resolve("test-results/browser-check.json"),JSON.stringify({zones:4,flows:8,date,errors},null,2));
  assert.deepEqual(errors,[]);
});
