#!/usr/bin/env python3
"""DNS falso para las pruebas del kit v3.9 (solo corre en el ejecutor de pruebas, escucha en 127.0.0.1:53).

Imita lo que paso el 28 nov en la red de la tienda: el DNS contesta NXDOMAIN, con el SOA de una zona ajena (dns.jomax.net), para los nombres que se le pidan bloquear;
todo lo demas se reenvia tal cual al DNS real (--upstream). Los bloqueos se leen del archivo --control en cada consulta, asi la prueba los cambia sin reiniciarlo:
    exacto:facturacion.dmalabomba.com     bloquea solo ese nombre
    zona:dmalabomba.com                   bloquea ese nombre y todo lo que cuelgue de el (como una delegacion vieja guardada por el DNS de la red)
"""
import argparse, socket, struct, threading, time

ap = argparse.ArgumentParser()
ap.add_argument("--upstream", required=True)
ap.add_argument("--control", required=True)
ap.add_argument("--log", default=None)
ap.add_argument("--puerto", type=int, default=53)
a = ap.parse_args()
cerrojo = threading.Lock()

def log(t):
    if a.log:
        with cerrojo:
            open(a.log, "a", encoding="utf-8").write(time.strftime("%H:%M:%S ") + t + "\n")

def leer_nombre(b, pos):
    partes = []; saltado = False; fin = pos
    for _ in range(60):
        n = b[pos]
        if n == 0:
            pos += 1; break
        if n & 0xC0 == 0xC0:
            if not saltado: fin = pos + 2
            saltado = True; pos = ((n & 0x3F) << 8) | b[pos + 1]; continue
        partes.append(b[pos + 1:pos + 1 + n].decode("ascii", "replace")); pos += 1 + n
    return ".".join(partes).lower(), (fin if saltado else pos)

def codificar(nombre):
    out = b""
    for l in nombre.strip(".").split("."):
        out += bytes([len(l)]) + l.encode("ascii")
    return out + b"\0"

def bloqueado(nombre):
    try:
        lineas = [l.strip().lower() for l in open(a.control, encoding="utf-8").read().splitlines() if l.strip()]
    except Exception:
        return None
    for l in lineas:
        tipo, _, v = l.partition(":")
        if tipo == "exacto" and nombre == v: return v
        if tipo == "zona" and (nombre == v or nombre.endswith("." + v)): return v
    return None

def nxdomain(q, nombre, zona):
    # Respuesta NXDOMAIN con el SOA de otra zona en la seccion de autoridad (mname dns.jomax.net, serie 2026112702, TTL 600)
    pos = 12; _, pos = leer_nombre(q, pos); pos += 4
    pregunta = q[12:pos]
    cab = q[0:2] + struct.pack(">HHHHH", 0x8183, 1, 0, 1, 0)
    soa_rdata = codificar("dns.jomax.net") + codificar("hostmaster.jomax.net") + struct.pack(">IIIII", 2026112702, 3600, 600, 86400, 600)
    soa = codificar(zona) + struct.pack(">HHIH", 6, 1, 600, len(soa_rdata)) + soa_rdata
    return cab + pregunta + soa

def atender(dato, dir_, sock):
    try:
        nombre, _ = leer_nombre(dato, 12)
        z = bloqueado(nombre)
        if z:
            sock.sendto(nxdomain(dato, nombre, z), dir_); log("NXDOMAIN " + nombre); return
        up = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); up.settimeout(4)
        up.sendto(dato, (a.upstream, 53))
        r, _ = up.recvfrom(4096); up.close()
        sock.sendto(r, dir_); log("reenviado " + nombre)
    except Exception as e:
        log("error " + str(e))

s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.bind(("127.0.0.1", a.puerto))
log("escuchando; upstream " + a.upstream)
while True:
    d, who = s.recvfrom(4096)
    threading.Thread(target=atender, args=(d, who, s), daemon=True).start()
