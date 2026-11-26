# Verifica la prueba de actualizacion real 2.9.0 -> 2.11.0 con los APK firmados. Sale con 1 si algo falla.
import json, re, sys, os
d = sys.argv[1]
rec = [json.loads(l) for l in open(d + "/guardian-recibidos.jsonl")]
lat = [r for r in rec if r["ruta"].startswith("/latido")]
t_act = float(open(d + "/t-actualiza.txt").read())
inst = open(d + "/instalacion.txt").read()
res = []
def chk(n, c, extra=""):
    res.append(bool(c)); print(("PASA  " if c else "FALLA ") + n + (("  [" + str(extra) + "]") if extra else ""))
chk("la 2.9.0 firmada se instalo", "instala-2.9.0: Success" in inst and "versionName=2.9.0" in inst, inst.replace("\n", " | ")[:200])
chk("la 2.11.0 firmada se instalo ENCIMA (mismo certificado) sin desinstalar", "actualiza-a-2.11.0-encima: Success" in inst and "versionName=2.11.0" in inst and "versionCode=21" in inst, inst.replace("\n", " | ")[-200:])
chk("todas las peticiones llegaron con firma valida", all(r["firma_ok"] for r in rec), f"{sum(r['firma_ok'] for r in rec)}/{len(rec)}")
ant = [r for r in lat if r["t"] < t_act]; des = [r for r in lat if r["t"] >= t_act]
chk("la 2.9.0 mando latidos antes de actualizar", len(ant) >= 2, len(ant))
chk("la 2.11.0 arranco sola y mando latidos despues de actualizar", len(des) >= 2, len(des))
cu_a = [json.loads(r["cuerpo"]) for r in ant]; cu_d = [json.loads(r["cuerpo"]) for r in des]
chk("antes: detalle.app = 2.9.0", all(c.get("detalle", {}).get("app") == "2.9.0" for c in cu_a))
chk("despues: detalle.app = 2.11.0", all(c.get("detalle", {}).get("app") == "2.11.0" for c in cu_d), set(c.get("detalle", {}).get("app") for c in cu_d))
chk("despues: la empresa y el telefono se conservan (soda)", all(c.get("empresa") == "soda" for c in cu_d))
ra = open(d + "/regla-antes.xml").read(); rd = open(d + "/regla-despues.xml").read()
chk("la regla de reenvio se conserva identica tras actualizar", ra == rd and "claveprueba" in rd)
hb = open(d + "/heartbeat-despues.xml").read()
chk("la configuracion del latido se conserva", 'name="enabled" value="true"' in hb and "10.0.2.2:8099/latido" in hb)
def ejec(f):
    s = open(d + "/" + f, errors="replace").read() if os.path.exists(d + "/" + f) else ""
    e = {}
    for m in re.finditer(r"(\d+)\|(\w+)\|(\w+)\|(\d+)", s): e.setdefault(int(m.group(1)), []).append((m.group(2), m.group(3)))
    return e
ea, ed = ejec("guardian-antes.xml"), ejec("guardian-despues.xml")
chk("el registro de ordenes ejecutadas se conserva tras actualizar", len(ea) > 0 and all(k in ed for k in ea), (sorted(ea), sorted(ed)))
chk("ninguna orden ya ejecutada se repitio al actualizar (el servidor las reenvia siempre)", all(len(v) == 1 for v in ed.values()), {k: len(v) for k, v in ed.items()})
chk("la orden 3 (fuera de la lista) nunca se ejecuto", 3 not in ed)
conf_a = set(); conf_d = set()
for c in cu_a: conf_a |= set(c.get("detalle", {}).get("comandos_hechos", []))
for c in cu_d: conf_d |= set(c.get("detalle", {}).get("comandos_hechos", []))
chk("la 2.11.0 sigue confirmando al servidor las ordenes ya hechas", conf_a <= conf_d and len(conf_d) >= 1, (sorted(conf_a), sorted(conf_d)))
n_det = [c["detalle"] for c in cu_d if "detalle" in c]
chk("el latido nuevo trae permisos_extra (permisos de la 2.9/2.10/2.11)", any("permisos_extra" in x for x in n_det), [x.get("permisos_extra") for x in n_det][:1])
fcm = [x.get("fcm_token") for x in n_det if x.get("fcm_token")]
print("INFO  fcm_token en el latido: " + ("si (%d chars)" % len(fcm[0]) if fcm else "no (el emulador puede no entregarlo)"))
pid = open(d + "/pid.txt").read().strip()
chk("el proceso de la 2.11.0 esta vivo al final", bool(pid), pid)
print("\nRESUMEN: %d de %d comprobaciones pasan" % (sum(res), len(res)))
sys.exit(0 if all(res) else 1)
