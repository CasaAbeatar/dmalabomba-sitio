#!/usr/bin/env python3
"""Prepara el PAQUETE candidato de un lanzamiento OTA SIN firmarlo con la llave de produccion.

Uso:  python3 ota-kit/preparar_candidato.py "kit pc caja/v3.8 resiliencia de dominio 27 nov"
Deja en ota-kit/lanzamientos/serie N/: paquetes/kit-N.zip, candidato-lanzamiento.json y LEEME candidato.txt.
No crea manifiesto ni firma: eso lo hace Emil (o quien tenga la llave privada de produccion) con crear_lanzamiento.py, que arma el MISMO zip
(zip determinista: fechas fijas y nombres ordenados), por lo que el SHA-256 de abajo es el que quedara firmado.
"""
import hashlib, json, os, re, shutil, subprocess, sys, tempfile
raiz = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
kit = os.path.abspath(sys.argv[1])
cfg = open(os.path.join(kit, "config.ps1"), encoding="utf-8-sig").read()
version = re.search(r'\$VersionKit\s*=\s*"([^"]+)"', cfg).group(1)
serie = int(re.search(r'\$OtaSerie\s*=\s*(\d+)', open(os.path.join(kit, "ota serie.ps1"), encoding="utf-8-sig").read()).group(1))
llave = os.path.join(raiz, "ota-kit", "pruebas", "llave-prueba-NO-USAR-EN-PRODUCCION.txt")   # solo para poder correr el script: el manifiesto que sale aqui NO se guarda
with tempfile.TemporaryDirectory() as tmp:
    subprocess.check_call([sys.executable, os.path.join(raiz, "ota-kit", "crear_lanzamiento.py"), kit, "--llave", llave, "--salida", tmp, "--estaciones", "caja-pollos"], stdout=subprocess.DEVNULL)
    destino = os.path.join(raiz, "ota-kit", "lanzamientos", "serie %d" % serie)
    os.makedirs(os.path.join(destino, "paquetes"), exist_ok=True)
    zdest = os.path.join(destino, "paquetes", "kit-%d.zip" % serie)
    shutil.copyfile(os.path.join(tmp, "paquetes", "kit-%d.zip" % serie), zdest)
sha = hashlib.sha256(open(zdest, "rb").read()).hexdigest()
cand = {"version": version, "serie": serie, "estaciones": ["caja-pollos"], "url": "https://www.dmalabomba.com/kit-caja/ota/paquetes/kit-%d.zip" % serie,
        "sha256": sha, "bytes": os.path.getsize(zdest), "minimo_actualizador": 1,
        "nota": "CANDIDATO sin firmar. El manifiesto y su firma se generan con la llave privada de produccion (crear_lanzamiento.py); no existe aqui. 'desde' lo fija quien publique."}
open(os.path.join(destino, "candidato-lanzamiento.json"), "w", encoding="utf-8", newline="\n").write(json.dumps(cand, indent=2) + "\n")
open(os.path.join(destino, "LEEME candidato.txt"), "w", encoding="utf-8", newline="\n").write(
"""Lanzamiento CANDIDATO serie %d (%s). NO esta firmado ni publicado.

Paquete: paquetes/kit-%d.zip  sha256=%s  bytes=%d

Para publicarlo (lo decide Emil; este repositorio no tiene la llave privada de produccion):
  1) Copiar la carpeta publicada actual (manifiesto.json, manifiesto.json.firma, paquetes/) a una carpeta de trabajo para conservar la serie 37.
  2) python3 ota-kit/crear_lanzamiento.py "kit pc caja/<carpeta v3.8>" --llave <llave-privada-de-produccion.pem> --salida <carpeta de trabajo> --estaciones caja-pollos [--desde ...]
     (conserva lo anterior del manifiesto y agrega la serie %d; el zip sale identico: mismo SHA-256 que arriba).
  3) Subir manifiesto.json, manifiesto.json.firma y paquetes/kit-%d.zip a www.dmalabomba.com/kit-caja/ota/ Y a dma-sitio.pages.dev/kit-caja/ota/ (el origen alterno debe tener los mismos archivos).
  4) Verificar los dos origenes con: python3 -c "import urllib.request as u; print(u.urlopen('https://dma-sitio.pages.dev/kit-caja/ota/manifiesto.json').read()[:80])"
""" % (serie, version, serie, sha, os.path.getsize(zdest), serie, serie))
print("Listo: serie %d %s sha256=%s" % (serie, version, sha))
