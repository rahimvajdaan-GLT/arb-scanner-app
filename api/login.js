import crypto from 'node:crypto';

function b64url(input){return Buffer.from(input).toString('base64url')}
function sign(payload,secret){return crypto.createHmac('sha256',secret).update(payload).digest('base64url')}
function safeEqual(a,b){const aa=Buffer.from(String(a));const bb=Buffer.from(String(b));return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb)}

export default async function handler(req,res){
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'Method not allowed'})}
  const email=String(req.body?.email||'').trim().toLowerCase();
  const password=String(req.body?.password||'');
  const allowedEmail=String(process.env.KAKA_ARB_LOGIN_EMAIL||'').trim().toLowerCase();
  const allowedPassword=String(process.env.KAKA_ARB_LOGIN_PASSWORD||'');
  const secret=String(process.env.KAKA_ARB_AUTH_SECRET||'');
  if(!allowedEmail||!allowedPassword||secret.length<24)return res.status(503).json({error:'Login is not configured yet.'});
  if(!safeEqual(email,allowedEmail)||!safeEqual(password,allowedPassword))return res.status(401).json({error:'Invalid email or password.'});
  const body=b64url(JSON.stringify({email:allowedEmail,exp:Date.now()+1000*60*60*24*7}));
  const token=`${body}.${sign(body,secret)}`;
  res.setHeader('Set-Cookie',`kaka_arb_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`);
  return res.status(200).json({ok:true});
}
