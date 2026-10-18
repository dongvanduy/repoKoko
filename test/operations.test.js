const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs/promises");
const express=require("express");
const sharp=require("sharp");
const {database}=require("./helpers/database");
const {bookingCalendar,arrivalInstant}=require("../lib/time");

test("migration, reminder catch-up and shared abuse limits",async t=>{
  const db=await database();t.after(db.close);
  const Booking=require("../models/booking"),Slot=require("../models/SlotInventory"),Job=require("../models/Job"),Config=require("../models/Config");
  const {migrateBookings}=require("../services/migration");
  const {updateBooking}=require("../services/bookings");
  const date=bookingCalendar().tomorrow;
  const legacy=await Booking.collection.insertOne({bookingCode:"LEGACY-TEST",date,time:"08:00",shopId:"1",shopName:"Test",fullname:"Test",email:"test@example.invalid",phone:"123456789",status:"Mới",guests:[{planName:"Kimono",price:3000}],totalPrice:3000,language:"en"});
  await t.test("dry run is read only; repeated migration preserves Tokyo time and counts",async()=>{
    const dry=await migrateBookings();assert.equal(dry.valid,1);assert.equal(dry.slots,1);
    assert.equal(await Slot.countDocuments(),0);assert.equal(await Config.countDocuments(),0);
    process.env.BOOKING_WRITES_ENABLED="false";
    try {await migrateBookings({apply:true});await migrateBookings({apply:true});}finally{delete process.env.BOOKING_WRITES_ENABLED;}
    const b=await Booking.findById(legacy.insertedId);
    assert.equal(b.startsAt.toISOString(),arrivalInstant(date,"08:00").toISOString());
    assert.equal(b.time,"08:00");assert.equal(b.date,date);assert.equal(b.guestCount,1);
    assert.equal((await Slot.findOne({date})).reserved,1);
    assert.equal((await Config.findOne({key:"booking_inventory_v1"})).value.ready,true);
  });
  await t.test("restart catches up after 07:00 JST without duplicate reminders; cancelled bookings are skipped",async()=>{
    const {scheduleReminders}=require("../services/jobs");
    await scheduleReminders(arrivalInstant(date,"06:59"));assert.equal(await Job.countDocuments(),0);
    await scheduleReminders(arrivalInstant(date,"07:15"));await scheduleReminders(arrivalInstant(date,"07:30"));
    assert.equal(await Job.countDocuments(),1);
    await updateBooking(legacy.insertedId,{status:"Đã hủy"});
    let sends=0;const job=await Job.findOne();
    await require("../services/mail").sendEmailJob(job.payload,job,{sendMail:async()=>sends++});
    assert.equal(sends,0);assert.equal((await Slot.findOne({date})).reserved,0);
  });
  await t.test("historical archive does not require counters absent from migration",async()=>{
    const old=await Booking.collection.insertOne({bookingCode:"PAST-TEST",date:"2020-01-01",time:"08:00",shopId:"1",status:"Mới",guests:[{planName:"Old",price:1}],totalPrice:1});
    await updateBooking(old.insertedId,{archive:true});assert.ok((await Booking.findById(old.insertedId)).archivedAt);
  });
  await t.test("malformed active legacy data blocks apply before any writes",async()=>{
    await Booking.collection.insertOne({bookingCode:"INVALID-TEST",date:"2026-02-30",time:"08:00",status:"Mới"});
    const dry=await migrateBookings();assert.equal(dry.blockers.length,1);
    const previous=JSON.stringify(await Slot.find().lean());
    process.env.BOOKING_WRITES_ENABLED="false";
    try {await assert.rejects(migrateBookings({apply:true}),/need review/);}finally{delete process.env.BOOKING_WRITES_ENABLED;}
    assert.equal(JSON.stringify(await Slot.find().lean()),previous);
  });
  await t.test("concurrent requests share an atomic rate bucket",async()=>{
    const {consumeRate}=require("../middleware/security");
    const results=await Promise.allSettled(Array.from({length:12},()=>consumeRate("concurrent-test",5,600000)));
    assert.equal(results.filter(r=>r.status==="fulfilled").length,5);
    assert.ok(results.filter(r=>r.status==="rejected").every(r=>r.reason.status===429));
  });
});

test("upload checks CSRF, real content, size and temporary cleanup before external publishing",async t=>{
  const {upload,manageUploads,publishUploads}=require("../middleware/uploads");
  const {requireAdminCsrf}=require("../middleware/admin-csrf");
  const cloud=require("cloudinary").v2;
  const original=cloud.uploader.upload;let calls=0;
  cloud.uploader.upload=async()=>{calls++;return{secure_url:"https://example.invalid/image.png",public_id:"test"};};
  t.after(()=>{cloud.uploader.upload=original;});
  const token="a".repeat(64);const dirs=[];
  const app=express();
  app.use((req,res,next)=>{req.session={isAdmin:true,adminCsrfToken:token};res.on("finish",()=>{if(req.uploadDirectoryPromise)dirs.push(req.uploadDirectoryPromise);});next();});
  app.post("/",manageUploads,upload.array("photos",2),requireAdminCsrf,publishUploads,(req,res)=>res.json({count:req.files.length}));
  app.use((err,req,res,next)=>res.status(err.status||400).json({code:err.code||"invalid"}));
  const server=await new Promise(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const url="http://127.0.0.1:"+server.address().port;
  const png=await sharp({create:{width:10,height:10,channels:3,background:"red"}}).png().toBuffer();
  async function submit(bytes,csrf=true){const form=new FormData();if(csrf)form.append("csrfToken",token);form.append("photos",new Blob([bytes],{type:"image/png"}),"test.png");return fetch(url,{method:"POST",body:form});}
  assert.equal((await submit(png)).status,200);assert.equal(calls,1);
  assert.equal((await submit(Buffer.from("<script>alert(1)</script>"))).status,400);assert.equal(calls,1);
  assert.equal((await submit(png,false)).status,403);assert.equal(calls,1);
  assert.equal((await submit(Buffer.alloc(5*1024*1024+1))).status,400);assert.equal(calls,1);
  for(const promise of dirs){const dir=await promise;for(let i=0;i<50;i++){try{await fs.access(dir);await new Promise(r=>setTimeout(r,10));}catch{break;}}await assert.rejects(fs.access(dir));}
});
