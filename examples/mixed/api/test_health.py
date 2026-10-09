from api import health


def test_health_is_ok() -> None:
    assert health() == {"status": "ok"}
