"""Testy SSRF guarda dla endpointów AI podawanych przez klienta."""
import pytest

from backend.app.converters.net_guard import UnsafeEndpointError, validate_outbound_url


def test_rejects_non_http_scheme():
    with pytest.raises(UnsafeEndpointError):
        validate_outbound_url("file:///etc/passwd", allow_private=True)
    with pytest.raises(UnsafeEndpointError):
        validate_outbound_url("gopher://example.com", allow_private=True)


def test_rejects_url_without_host():
    with pytest.raises(UnsafeEndpointError):
        validate_outbound_url("http:///v1", allow_private=True)


def test_cloud_metadata_blocked_even_when_private_allowed():
    with pytest.raises(UnsafeEndpointError):
        validate_outbound_url("http://169.254.169.254/latest/meta-data", allow_private=True)


def test_loopback_allowed_for_local_ollama():
    url = "http://127.0.0.1:11434/v1"
    assert validate_outbound_url(url, allow_private=True) == url


def test_loopback_blocked_when_private_disallowed():
    with pytest.raises(UnsafeEndpointError):
        validate_outbound_url("http://127.0.0.1:11434/v1", allow_private=False)


def test_private_range_blocked_when_disallowed():
    with pytest.raises(UnsafeEndpointError):
        validate_outbound_url("http://192.168.1.10:8080/v1", allow_private=False)


def test_unresolvable_host_is_rejected():
    with pytest.raises(UnsafeEndpointError):
        validate_outbound_url("http://nieistniejacy-host.invalid/v1", allow_private=False)
