const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs/promises");
const os=require("node:os");
const path=require("node:path");
const {promisify}=require("node:util");
const {execFile}=require("node:child_process");
const {database}=require("./helpers/database");

test("production starts from another working directory and serves health/login",async t=>{
  const db=await database();t.after(db.close);
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),"kokoro-startup-"));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const entry=path.resolve(__dirname,"../server.js");
  const code=`
    (async()=>{
      const {server,stop}=await require(process.argv[1]).start();
      try{
        const base="http://127.0.0.1:"+server.address().port;
        const health=await fetch(base+"/health");
        if(health.status!==200)throw Error("health_failed");
        await health.text();
        const login=await fetch(base+"/login");
        if(login.status!==200)throw Error("login_failed");
        const html=await login.text();
        if(!html.includes("/assets/site."))throw Error("assets_failed");
        console.log("Production smoke check passed.");
      }finally{await stop();}
    })().catch(error=>{console.error(error.message);process.exitCode=1;});
  `;
  const result=await promisify(execFile)(process.execPath,["-e",code,entry],{
    cwd:directory,encoding:"utf8",timeout:30000,
    env:{...process.env,NODE_ENV:"production",SITE_URL:"https://kokorokimono.com",PORT:"0",TRUST_PROXY:"",
      ADMIN_PASSWORD_HASH:"$argon2id$test-only",WORKER_ENABLED:"false"}
  });
  assert.match(result.stdout,/Production smoke check passed/);
});
