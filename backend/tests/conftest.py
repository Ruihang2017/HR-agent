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
