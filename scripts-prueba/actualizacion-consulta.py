# Consultas sobre lo que recibio el servidor falso de la prueba de actualizacion (act-recibidos.jsonl, act-descargas.log).
# Uso: actualizacion-consulta.py detalle <clave> | detalle_num <clave> | resultado <id> | veces_ejecutada <id> | descargas | latidos | firmas_malas
import json, os, sys


def lineas():
    out = []
    try:
        for l in open("act-recibidos.jsonl"):
            try:
                out.append(json.loads(l))
            except Exception:
                pass
    except FileNotFoundError:
        pass
    return out


def latidos():
    r = []
    for x in lineas():
        if not x["ruta"].startswith("/latido"):
            continue
        try:
            r.append((x, json.loads(x["cuerpo"])))
        except Exception:
            pass
    return r


cmd = sys.argv[1]
if cmd == "detalle":
    L = latidos()
    v = L[-1][1].get("detalle", {}).get(sys.argv[2]) if L else None
    print("" if v is None else json.dumps(v))
elif cmd == "alguna_vez":
    # "true" si algun latido trajo ese valor (clave, valor json)
    print("true" if any(json.dumps(b.get("detalle", {}).get(sys.argv[2])) == sys.argv[3] for _, b in latidos()) else "false")
elif cmd == "detalle_num":
    L = latidos()
    v = L[-1][1].get("detalle", {}).get(sys.argv[2]) if L else None
    print(-999 if not isinstance(v, (int, float)) or isinstance(v, bool) else int(v))
elif cmd == "resultado":
    res = ""
    for _, b in latidos():
        r = b.get("detalle", {}).get("comandos_resultado", {})
        if sys.argv[2] in r:
            res = json.dumps(r[sys.argv[2]])
    print(res)
elif cmd == "veces_ejecutada":
    # cuantos latidos DISTINTOS informan haber hecho esta orden por primera vez no es medible desde afuera;
    # se cuenta en cuantos latidos aparece en comandos_hechos (la app la confirma una sola vez y la olvida)
    n = 0
    for _, b in latidos():
        if int(sys.argv[2]) in b.get("detalle", {}).get("comandos_hechos", []):
            n += 1
    print(n)
elif cmd == "descargas":
    try:
        print(sum(1 for l in open("act-descargas.log") if " GET " in l))
    except FileNotFoundError:
        print(0)
elif cmd == "latidos":
    print(len(latidos()))
elif cmd == "firmas_malas":
    print(sum(1 for x in lineas() if not x["firma_ok"]))
else:
    sys.exit(2)
