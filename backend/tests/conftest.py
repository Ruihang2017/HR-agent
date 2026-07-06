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
