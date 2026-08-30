"""Walidacja adresów, pod które serwer wykonuje żądania wychodzące (SSRF guard).

Endpoint AI jest podawany przez klienta (`ai_base_url`), więc bez kontroli
backend stałby się proxy do sieci wewnętrznej i metadanych chmury.

Tryb "Lokalne" (Ollama / LM Studio) z założenia wskazuje na loopback, dlatego
adresy prywatne są dozwolone domyślnie — ale WYŁĄCZNIE gdy backend działa na
maszynie użytkownika. Przy wdrożeniu publicznym ustaw ALLOW_PRIVATE_AI_ENDPOINTS=false.
Adresy link-local (metadane AWS/GCP/Azure) są blokowane zawsze.
"""
import ipaddress
import socket
from urllib.parse import urlsplit

# Blokowane bezwarunkowo — nigdy nie są prawidłowym endpointem modelu.
_ALWAYS_BLOCKED = (
    ipaddress.ip_network("169.254.0.0/16"),   # link-local + metadane chmury
    ipaddress.ip_network("fe80::/10"),
    ipaddress.ip_network("100.64.0.0/10"),    # CGNAT
)


class UnsafeEndpointError(ValueError):
    """Adres odrzucony przez politykę bezpieczeństwa."""


def _resolve(host: str, port: int):
    try:
        infos = socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror as e:
        raise UnsafeEndpointError(f"Nie można rozwiązać hosta: {host}") from e
    return [ipaddress.ip_address(info[4][0]) for info in infos]


def validate_outbound_url(url: str, *, allow_private: bool) -> str:
    """Zwraca URL, jeśli jest bezpieczny; inaczej rzuca UnsafeEndpointError."""
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https"):
        raise UnsafeEndpointError(
            f"Niedozwolony protokół: {parts.scheme or '(brak)'}. Dozwolone: http, https."
        )
    if not parts.hostname:
        raise UnsafeEndpointError("Adres endpointu nie zawiera nazwy hosta.")

    port = parts.port or (443 if parts.scheme == "https" else 80)
    # Każdy rekord DNS musi przejść kontrolę — host z wieloma adresami
    # inaczej obchodzi walidację.
    for ip in _resolve(parts.hostname, port):
        for net in _ALWAYS_BLOCKED:
            if ip.version == net.version and ip in net:
                raise UnsafeEndpointError(f"Adres zablokowany: {ip} (link-local/metadane).")
        if allow_private:
            continue
        if ip.is_private or ip.is_loopback or ip.is_reserved or ip.is_multicast:
            raise UnsafeEndpointError(
                f"Adres {ip} należy do sieci prywatnej — zablokowany przez politykę serwera."
            )
    return url
