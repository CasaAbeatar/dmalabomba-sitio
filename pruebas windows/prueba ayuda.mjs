import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const raiz = path.resolve(process.cwd()); const salida = path.join(raiz, 'resultados'); fs.mkdirSync(salida, { recursive: true });
const tipos = {'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json'};
const html = `<!doctype html><meta charset=utf8><body><div id=r></div><script src="/vacio.js" defer></script><script type=module>
import { ayudaLinea } from '/facturacion/js/m_inv_recibir_ayuda.js';
window.aplicado=null;
document.getElementById('r').append(ayudaLinea({clave:'1'.repeat(50),linea:3,aplicar:(p)=>{window.aplicado=p;return 'ok'}}));
window.listo=true;</script>`;
const srv = http.createServer((q,r)=>{ let p=decodeURIComponent(q.url.split('?')[0]);
  if(p==="/vacio.js"){r.writeHead(200,{"content-type":"text/javascript"});return r.end("");} if(p==="/t.html"){r.writeHead(200,{'content-type':'text/html'});return r.end(html);}
  const f=path.join(raiz,p); if(!f.startsWith(raiz)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('no');}
  r.writeHead(200,{'content-type':tipos[path.extname(f)]||'application/octet-stream'}); fs.createReadStream(f).pipe(r);});
await new Promise(ok=>srv.listen(8125,'127.0.0.1',ok));
const nav = await chromium.launch({channel:'chrome'});
const res=[]; // Prueba de «Ver factura (PDF)» y «Consultar con Claude» con respuestas simuladas de las funciones (21 nov 2026)
 const nota=(n,ok,d='')=>{res.push(ok);console.log(ok?'OK ':'FALLA',n,d)};
for (const [nombre,vp] of [['escritorio',{width:1366,height:768}],['telefono',{width:390,height:844}]]) {
  const ctx = await nav.newContext({viewport:vp}); const pag = await ctx.newPage();
  const errs=[]; pag.on('pageerror',e=>errs.push(String(e))); pag.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
  let llamadas=[];
  await pag.route('**/functions/v1/**', async (route)=>{ const u=route.request().url(); const b=JSON.parse(route.request().postData()||'{}'); llamadas.push([u.split('/').pop(),b]);
    if(u.endsWith('factura-pdf')){ const pdf=Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF'); return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({ok:true,nombre:'f.pdf',tipo:'application/pdf',base64:pdf.toString('base64')})}); }
    return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({ok:true,tarea:'recibir_linea_chat',busquedas:2,resultado:{respuesta:'Es una salsa Tabasco de galón. Cada galón trae 1 unidad.',propuesta:{que_es:'Salsa Tabasco',presentacion:'Galón 3,78 L',unidades_por_unidad_factura:1,tipo_consumo:'insumo_cocina',costo_referencia_unidad:2654.87,certeza:'alta',fuentes:['mcilhenny.com']}}})}); });
  await pag.route('**/functions/v1/**', async (route)=>{ if(route.request().method()==='OPTIONS') return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}}); return route.fallback(); });
  await pag.goto('http://127.0.0.1:8125/t.html'); await pag.waitForFunction(()=>window.listo,null,{timeout:8000}).catch(()=>{});
  nota(nombre+': carga sin errores',errs.length===0&&await pag.evaluate(()=>!!window.listo),errs.join('|').slice(0,300));
  await pag.getByRole('button',{name:'Ver factura (PDF)'}).click(); await pag.waitForSelector('iframe.ay-pdf',{timeout:6000}).catch(()=>{});
  nota(nombre+': PDF en iframe',await pag.locator('iframe.ay-pdf').count()===1, JSON.stringify(llamadas.map(x=>x[0])));
  await pag.screenshot({path:path.join(salida,`ayuda pdf ${nombre}.png`)});
  await pag.getByRole('button',{name:'Consultar con Claude'}).click();
  await pag.getByRole('button',{name:'Investigar qué es este artículo'}).click();
  await pag.waitForSelector('.ay-prop',{timeout:6000}).catch(()=>{});
  nota(nombre+': propuesta visible',await pag.locator('.ay-prop').count()===1);
  const cuerpo = llamadas.find(x=>x[0]==='claude-asistente');
  nota(nombre+': cuerpo enviado',!!cuerpo&&cuerpo[1].tarea==='recibir_linea_chat'&&cuerpo[1].datos.linea===3&&cuerpo[1].datos.clave.length===50,JSON.stringify(cuerpo&&cuerpo[1]).slice(0,160));
  {const b=pag.getByRole('button',{name:'Usar esta propuesta en la línea'}); await b.scrollIntoViewIfNeeded(); await b.click();}
  await pag.waitForTimeout(300); nota(nombre+': aplicar solo con toque',await pag.evaluate(()=>!!window.aplicado&&window.aplicado.unidades_por_unidad_factura===1), await pag.locator('.ay-prop ~ button, button:has-text("Cargado")').count()+'');
  await pag.locator('textarea').fill('¿Y cuánto pesa?'); await pag.getByRole('button',{name:'Enviar',exact:true}).click(); await pag.waitForTimeout(800);
  const c2=llamadas.filter(x=>x[0]==='claude-asistente').pop();
  nota(nombre+': historial viaja en 2º mensaje',c2[1].datos.historial.length===2&&c2[1].datos.pregunta==='¿Y cuánto pesa?');
  nota(nombre+': sin desborde horizontal',!(await pag.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)));
  await pag.screenshot({path:path.join(salida,`ayuda chat ${nombre}.png`),fullPage:true});
  await ctx.close();
}
await nav.close(); srv.close(); process.exit(res.every(Boolean)?0:1);
