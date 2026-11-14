"""Apply to Python workers and their Python CLI children before third-party imports."""
import ipaddress
import socket

_connect = socket.socket.connect
_connect_ex = socket.socket.connect_ex

def _destination(sock, address):
    if sock.family not in (socket.AF_INET, socket.AF_INET6):
        return address
    host, port = address[:2]
    addresses = socket.getaddrinfo(host, port, family=sock.family, type=sock.type)
    if not addresses or any(not ipaddress.ip_address(item[4][0]).is_global for item in addresses):
        raise PermissionError('Private network destinations are not allowed')
    return addresses[0][4]

def connect(sock, address):
    return _connect(sock, _destination(sock, address))

def connect_ex(sock, address):
    return _connect_ex(sock, _destination(sock, address))

socket.socket.connect = connect
socket.socket.connect_ex = connect_ex
