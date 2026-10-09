from py_app import greet


def test_greets_by_name() -> None:
    assert greet("Ada") == "Hello, Ada!"
