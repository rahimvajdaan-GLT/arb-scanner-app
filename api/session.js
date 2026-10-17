import crypto from 'node:crypto';
function sign(payload,secret){return crypto.createHmac('sha256',secret).update(payload).digest('base64url')}
function cookies(req){return Object.fromEntries(String(req.headers.cookie||'').split(';').map(v=>v.trim()).filter(Boolean).map(v=>{const i=v.indexOf('=');return [v.slice(0,i),decodeURIComponent(v.slice(i+1))]}))}
function safeEqual(a,b){const aa=Buffer.from(String(a));const bb=Buffer.from(String(b));return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb)}
export default async function handler(req,res){
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'Method not allowed'})}
  const secret=String(process.env.KAKA_ARB_AUTH_SECRET||'');
  const token=cookies(req).kaka_arb_session||'';
  const [body,sig]=token.split('.');
  if(!secret||!body||!sig||!safeEqual(sig,sign(body,secret)))return res.status(401).json({error:'Unauthorised'});
  try{const data=JSON.parse(Buffer.from(body,'base64url').toString('utf8'));if(!data.exp||Date.now()>data.exp)return res.status(401).json({error:'Session expired'});return res.status(200).json({ok:true,email:data.email});}catch{return res.status(401).json({error:'Unauthorised'});}
}
