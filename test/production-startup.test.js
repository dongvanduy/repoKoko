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
        // Nginx terminates TLS, then forwards HTTP from loopback with its own headers.
        const proxyHeaders={"X-Forwarded-Proto":"https","X-Forwarded-For":"198.51.100.12"};
        const secureLogin=await fetch(base+"/login",{headers:proxyHeaders});
        const secureHtml=await secureLogin.text();
        const cookie=secureLogin.headers.getSetCookie().find(value=>value.startsWith("kokoro.sid="));
        if(!cookie)throw Error("secure_session_cookie_missing");
        if(!/;\\s*Secure/i.test(cookie)||!/;\\s*HttpOnly/i.test(cookie)||!/SameSite=Lax/i.test(cookie))throw Error("cookie_flags_failed");
        const token=secureHtml.match(/name="csrfToken"\\s+value="([a-f0-9]{64})"/)?.[1];
        if(!token)throw Error("csrf_token_missing");
        const {checkLoginReadiness}=require(require("node:path").join(require("node:path").dirname(process.argv[1]),"services/login-readiness"));
        try{await checkLoginReadiness({siteUrl:base});throw Error("unsecured_login_check_passed");}
        catch(error){if(error.code!=="LOGIN_COOKIE_MISSING")throw error;}
        await checkLoginReadiness({siteUrl:base,fetcher:(url,options)=>fetch(url,{...options,headers:{...options.headers,...proxyHeaders}})});
        const oldCookie=cookie.split(";")[0];
        const post=(csrfToken,cookieHeader=oldCookie,password="test-login-password")=>fetch(base+"/login",{
          method:"POST",redirect:"manual",headers:{...proxyHeaders,"Content-Type":"application/x-www-form-urlencoded",...(cookieHeader?{Cookie:cookieHeader}:{})},
          body:new URLSearchParams({username:"testadmin",password,csrfToken}),
        });
        const missingSession=await post(token,"");
        if(missingSession.status!==403)throw Error("missing_session_csrf_bypassed");
        await missingSession.text();
        const invalidToken=await post("0".repeat(64));
        if(invalidToken.status!==403)throw Error("invalid_csrf_bypassed");
        await invalidToken.text();
        const badPassword=await post(token,oldCookie,"incorrect-password");
        if(badPassword.status!==401)throw Error("bad_password_not_rejected");
        await badPassword.text();
        const authenticated=await post(token);
        if(authenticated.status!==303||authenticated.headers.get("location")!=="/admin")throw Error("login_post_failed");
        const newCookie=authenticated.headers.getSetCookie().find(value=>value.startsWith("kokoro.sid="))?.split(";")[0];
        if(!newCookie||newCookie===oldCookie)throw Error("session_not_rotated");
        await authenticated.text();
        const admin=await fetch(base+"/admin",{headers:{...proxyHeaders,Cookie:newCookie},redirect:"manual"});
        if(admin.status!==200)throw Error("authenticated_session_missing");
        await admin.text();
        const stale=await fetch(base+"/admin",{headers:{...proxyHeaders,Cookie:oldCookie},redirect:"manual"});
        if(stale.status!==302)throw Error("old_session_still_authenticated");
        await stale.text();
        if(login.headers.getSetCookie().some(value=>value.startsWith("kokoro.sid=")))throw Error("insecure_http_cookie_created");
        console.log("Production smoke check passed.");
      }finally{await stop();}
    })().catch(error=>{console.error(error.message);process.exitCode=1;});
  `;
  const result=await promisify(execFile)(process.execPath,["-e",code,entry],{
    cwd:directory,encoding:"utf8",timeout:30000,
    env:{...process.env,NODE_ENV:"production",SITE_URL:"https://kokorokimono.com",PORT:"0",TRUST_PROXY:"",
      ADMIN_PASSWORD_HASH:await require("argon2").hash("test-login-password",{type:require("argon2").argon2id}),WORKER_ENABLED:"false"}
  });
  assert.match(result.stdout,/Production smoke check passed/);
});
