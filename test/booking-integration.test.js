const { test } = require("node:test");
const assert = require("node:assert/strict");
const { database } = require("./helpers/database");
const service = require("../services/bookings");
const Booking = require("../models/booking"), Plan=require("../models/Plan"), Slot=require("../models/SlotInventory"), Job=require("../models/Job"), Config=require("../models/Config");
test("booking transactions, pricing, retries and background jobs", async t => {
  const db=await database(); t.after(db.close);
  const plan=await Plan.create({ title:{en:"Test",vi:"Thử"},price:3000,isVisible:true });
  await Config.create({key:"booking_inventory_v1",value:{ready:true}});
  const {bookingCalendar}=require("../lib/time"); const date=bookingCalendar().tomorrow;
  const priced=await service.priceLines([{id:String(plan._id),qty:1}],"vi");
  const make=(owner="owner",extra={})=>({owner,language:"vi",body:{quote:service.issueQuote(priced,owner),shopId:"1",date,time:"08:00",fullname:"Test Customer",email:"test@example.invalid",phone:"0901234567",...extra}});
  await t.test("21 concurrent requests cannot consume more than 20 seats",async()=>{
    const results=await Promise.allSettled(Array.from({length:21},(_,i)=>service.createBooking(make("owner"+i))));
    assert.equal(results.filter(r=>r.status==="fulfilled").length,20);
    assert.equal(results.find(r=>r.status==="rejected").reason.code,"slot_full");
    assert.equal(await Booking.countDocuments(),20);
    assert.equal((await Slot.findOne({date,time:"08:00"})).reserved,20);
    assert.equal(await Job.countDocuments(),20);
  });
  await t.test("cancellation/archive/restore never overbook and rollback state on conflict",async()=>{
    const booked=await Booking.findOne();await service.updateBooking(booked._id,{status:"Đã hủy"});
    assert.equal((await Slot.findOne({date,time:"08:00"})).reserved,19);
    await service.createBooking(make("replacement"));
    await assert.rejects(service.updateBooking(booked._id,{status:"Mới"}),e=>e.code==="slot_full");
    assert.equal((await Booking.findById(booked._id)).status,"Đã hủy");
    const replacement=await Booking.findOne({owner:"replacement"});
    await service.updateBooking(replacement._id,{archive:true});
    await service.updateBooking(booked._id,{status:"Mới"});
    await assert.rejects(service.updateBooking(replacement._id,{archive:false}),e=>e.code==="slot_full");
    assert.ok((await Booking.findById(replacement._id)).archivedAt);
  });
  await t.test("double submission creates one booking and one mail task",async()=>{
    const req=make("retry",{time:"09:00",price:-100,plansDataString:JSON.stringify([{price:-1}])});
    const results=await Promise.all([service.createBooking(req),service.createBooking(req)]);
    assert.equal(String(results[0]._id),String(results[1]._id));assert.equal(results[0].totalPrice,3000);
    assert.equal((await Slot.findOne({date,time:"09:00"})).reserved,1);
    assert.equal(await Job.countDocuments({"payload.bookingId":String(results[0]._id)}),1);
    req.body.fullname="Changed";
    await assert.rejects(service.createBooking(req),e=>e.code==="request_changed");
  });
  await t.test("server validates date, slot, quote, quantity, hidden plan and changed prices",async()=>{
    await assert.rejects(service.createBooking(make("bad",{date:"2026-02-30"})),e=>e.status===400);
    await assert.rejects(service.createBooking(make("bad",{time:"25:99"})),e=>e.status===400);
    await assert.rejects(service.createBooking(make("bad",{time:"12:13"})),e=>e.code==="invalid_slot");
    await assert.rejects(service.createBooking(make("bad",{quote:"fake.signature"})),e=>e.code==="invalid_quote");
    await assert.rejects(service.priceLines([{id:String(plan._id),qty:21}],"en"),e=>e.status===400);
    for(const qty of [-1,0,21,{},[]]) await assert.rejects(service.priceLines([{id:String(plan._id),qty}],"en"));
    await assert.rejects(service.priceLines([{id:"000000000000000000000000",qty:1}],"en"),e=>e.code==="invalid_plan");
    await assert.rejects(service.availableSlots([date],"1","1"),e=>e.status===400);
    await assert.rejects(service.availableSlots(date,{$ne:""},"1"),e=>e.status===400);
    await assert.rejects(service.availableSlots(date,"1",["1"]),e=>e.status===400);
    await assert.rejects(service.createBooking(make("bad-option",{["options_"+plan._id+"_1"]:"invented"})),e=>e.code==="invalid_options");
    const req=make("price",{time:"10:00"});await Plan.updateOne({_id:plan._id},{$set:{price:4000}});
    await assert.rejects(service.createBooking(req),e=>e.code==="price_changed");
    assert.equal(await Booking.countDocuments({owner:"price"}),0);
    await Plan.updateOne({_id:plan._id},{$set:{isVisible:false}});
    await assert.rejects(service.createBooking(make("hidden",{time:"10:00"})),e=>e.code==="invalid_plan");
    await Plan.updateOne({_id:plan._id},{$set:{isVisible:true,price:3000}});
  });
  await t.test("worker lease prevents simultaneous send and retries failures",async()=>{
    const {runOnce}=require("../services/jobs");
    await Job.updateMany({},{$set:{status:"done"}});
    const task=await Job.create({key:"worker-test",type:"email",payload:{},availableAt:new Date(0)});
    let sends=0;const handlers={email:async()=>{sends++;await new Promise(r=>setTimeout(r,30));}};
    await Promise.all([runOnce(handlers),runOnce(handlers)]);assert.equal(sends,1);
    assert.equal((await Job.findById(task._id)).status,"done");
    const failure=await Job.create({key:"failure-test",type:"email",payload:{},availableAt:new Date(0)});
    await runOnce({email:async()=>{throw Object.assign(new Error("private smtp error"),{code:"ETIMEDOUT"});}});
    const updated=await Job.findById(failure._id);assert.equal(updated.status,"pending");assert.equal(updated.lastError,"ETIMEDOUT");assert.equal(updated.attempts,1);
  });
  await t.test("stale translation never overwrites a newer edit",async()=>{
    const {translateJob}=require("../services/translations");
    await Plan.updateOne({_id:plan._id},{$set:{translationVersion:2,"title.en":"New title"}});
    await translateJob({model:"Plan",id:String(plan._id),version:1,locale:"en",source:{title:{en:"Old"}}},{},async()=>{throw Error("must not translate stale revision");});
    assert.equal((await Plan.findById(plan._id)).title.en,"New title");
  });
  await t.test("transaction outage fails safely and a retry recovers",async()=>{
    const request=make("outage",{time:"11:00"}), original=db.mongoose.connection.transaction;
    db.mongoose.connection.transaction=async()=>{throw Object.assign(new Error("internal-host-details"),{name:"MongoNetworkError"});};
    try { await assert.rejects(service.createBooking(request),e=>e.status===503 && !e.message.includes("internal-host")); }
    finally { db.mongoose.connection.transaction=original; }
    assert.equal(await Booking.countDocuments({owner:"outage"}),0);
    const recovered=await service.createBooking(request);assert.equal(recovered.guestCount,1);
  });
  await t.test("translation failure is retried without losing source text",async()=>{
    const {translateJob}=require("../services/translations");
    await assert.rejects(translateJob({model:"Plan",id:String(plan._id),version:2,locale:"en",source:{title:{en:"New title"}}},{},async()=>{throw new Error("unavailable");}));
    assert.equal((await Plan.findById(plan._id)).title.en,"New title");
  });
  await t.test("maintenance marker prevents new bookings",async()=>{
    await Config.updateOne({key:"booking_inventory_v1"},{$set:{value:{ready:false}}});
    await assert.rejects(service.createBooking(make("paused",{time:"11:00"})),e=>e.status===503);
  });
});
