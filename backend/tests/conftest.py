import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from shortlist.db import Base


@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:")
    from shortlist.models import tables  # noqa: F401  register mappings

    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    yield session
    session.close()


from types import SimpleNamespace


class FakeResponse:
    def __init__(self, parsed_output):
        self.parsed_output = parsed_output
        self.usage = SimpleNamespace(input_tokens=10, output_tokens=5)


class FakeMessages:
    def __init__(self, owner):
        self._owner = owner

    def parse(self, **kwargs):
        self._owner.calls.append(kwargs)
        item = self._owner.queue.pop(0)
        if not isinstance(item, Exception):
            expected = kwargs.get("output_format")
            assert expected is not None and isinstance(item, expected), (
                f"fake_llm queue drift: got {type(item).__name__}, call wanted {expected.__name__}"
            )
        if isinstance(item, Exception):
            raise item
        return FakeResponse(item)


class FakeClient:
    def __init__(self):
        self.queue: list = []
        self.calls: list[dict] = []
        self.messages = FakeMessages(self)


@pytest.fixture()
def fake_llm(monkeypatch):
    fake = FakeClient()
    monkeypatch.setattr("shortlist.llm.client._get_client", lambda: fake)
    return fake


@pytest.fixture()
def api_client(monkeypatch):
    from fastapi.testclient import TestClient
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool

    import shortlist.db as db_module
    from shortlist.app.main import app
    from shortlist.db import Base, get_session
    from shortlist.models import tables  # noqa: F401

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(engine)
    test_session_factory = sessionmaker(bind=engine, expire_on_commit=False)
    # background tasks open their own session via shortlist.db.SessionLocal
    monkeypatch.setattr(db_module, "SessionLocal", test_session_factory)

    def override():
        session = test_session_factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_session] = override
    with TestClient(app) as client:
        yield client
    app.dependency_overrides.clear()
