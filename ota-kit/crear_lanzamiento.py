#!/usr/bin/env python3
"""Arma y firma un lanzamiento OTA del kit de caja de La Bomba.

Uso:
  python3 crear_lanzamiento.py CARPETA_DEL_KIT --llave llave-privada.pem --salida CARPETA_SALIDA \
      --estaciones caja-pollos [--desde 2026-11-27T08:00:00Z] [--dias 30] [--url-base https://www.dmalabomba.com/kit-caja/ota]

Produce en CARPETA_SALIDA:
  manifiesto.json, manifiesto.json.firma (base64 de la firma RSA PKCS#1 v1.5 SHA-256), paquetes/kit-<serie>.zip
Si ya existe un manifiesto.json en CARPETA_SALIDA se conserva lo anterior (reemplazando la misma serie).
La llave privada NUNCA va al repositorio ni al kit. No publica nada: solo deja los archivos listos.
"""
import argparse, base64, datetime as dt, hashlib, json, os, re, subprocess, sys, zipfile, tempfile

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("kit"); ap.add_argument("--llave", required=True); ap.add_argument("--salida", required=True)
    ap.add_argument("--estaciones", default="caja-pollos", help="lista separada por comas o * para todas")
    ap.add_argument("--desde", default=None); ap.add_argument("--dias", type=int, default=30)
    ap.add_argument("--url-base", default="https://www.dmalabomba.com/kit-caja/ota")
    ap.add_argument("--minimo-actualizador", type=int, default=1)
    ap.add_argument("--notas", default="")
    ap.add_argument("--relativa", action="store_true", help="solo pruebas: la url del paquete es relativa a la carpeta del manifiesto")
    ap.add_argument("--extra-entrada", default=None, help="solo pruebas: agrega una entrada con ese nombre al zip (para probar rechazos)")
    a = ap.parse_args()
    kit = a.kit
    cfg = open(os.path.join(kit, "config.ps1"), encoding="utf-8-sig").read()
    version = re.search(r'\$VersionKit\s*=\s*"([^"]+)"', cfg).group(1)
    serie = int(re.search(r'\$OtaSerie\s*=\s*(\d+)', open(os.path.join(kit, "ota serie.ps1"), encoding="utf-8-sig").read()).group(1))
    nombres = sorted(n for n in os.listdir(kit) if os.path.isfile(os.path.join(kit, n)) and os.path.splitext(n)[1].lower() in (".ps1", ".bat"))
    os.makedirs(os.path.join(a.salida, "paquetes"), exist_ok=True)
    zpath = os.path.join(a.salida, "paquetes", "kit-%d.zip" % serie)
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for n in nombres:
            zi = zipfile.ZipInfo(n, date_time=(2026, 1, 1, 0, 0, 0)); zi.compress_type = zipfile.ZIP_DEFLATED; zi.external_attr = 0o644 << 16
            z.writestr(zi, open(os.path.join(kit, n), "rb").read())
        if a.extra_entrada:
            zi = zipfile.ZipInfo(a.extra_entrada, date_time=(2026, 1, 1, 0, 0, 0)); z.writestr(zi, b"x")
    sha = hashlib.sha256(open(zpath, "rb").read()).hexdigest()
    ahora = dt.datetime.utcnow().replace(microsecond=0)
    iso = lambda d: d.strftime("%Y-%m-%dT%H:%M:%SZ")
    mpath = os.path.join(a.salida, "manifiesto.json")
    lanz = []
    if os.path.exists(mpath):
        lanz = [l for l in json.load(open(mpath, encoding="utf-8"))["lanzamientos"] if l["serie"] != serie]
    url = ("paquetes/kit-%d.zip" % serie) if a.relativa else ("%s/paquetes/kit-%d.zip" % (a.url_base, serie))
    lanz.append({"version": version, "serie": serie, "estaciones": [x.strip() for x in a.estaciones.split(",")],
                 "desde": a.desde or iso(ahora), "url": url, "sha256": sha, "bytes": os.path.getsize(zpath),
                 "minimo_actualizador": a.minimo_actualizador, "notas": a.notas})
    lanz.sort(key=lambda l: l["serie"])
    man = {"formato": 1, "emitido": iso(ahora), "caduca": iso(ahora + dt.timedelta(days=a.dias)), "lanzamientos": lanz}
    open(mpath, "w", encoding="utf-8", newline="\n").write(json.dumps(man, indent=2, ensure_ascii=True) + "\n")
    firma = subprocess.check_output(["openssl", "dgst", "-sha256", "-sign", a.llave, mpath])
    open(mpath + ".firma", "w").write(base64.b64encode(firma).decode() + "\n")
    print("Listo: %s (serie %d) sha256=%s bytes=%d" % (version, serie, sha, os.path.getsize(zpath)))

main()
