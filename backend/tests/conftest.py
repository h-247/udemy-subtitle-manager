import os
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

TEST_DB_FILE = "./test_udemy.db"
if os.path.exists(TEST_DB_FILE):
    try:
        os.remove(TEST_DB_FILE)
    except OSError:
        pass

os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB_FILE}"
os.environ["SECRET_KEY"] = "test-secret-key-for-udemy-subtitle-manager-123456"

from app.config import settings
from app.database import Base, get_db
from app.main import app
from app.models.user import User
from app.services.auth_service import get_password_hash, create_access_token

test_engine = create_engine(
    f"sqlite:///{TEST_DB_FILE}",
    connect_args={"check_same_thread": False},
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)


@pytest.fixture(scope="session", autouse=True)
def setup_test_db():
    Base.metadata.create_all(bind=test_engine)
    yield
    Base.metadata.drop_all(bind=test_engine)
    if os.path.exists(TEST_DB_FILE):
        try:
            os.remove(TEST_DB_FILE)
        except OSError:
            pass


@pytest.fixture
def db_session():
    connection = test_engine.connect()
    transaction = connection.begin()
    session = TestingSessionLocal(bind=connection)

    yield session

    session.close()
    transaction.rollback()
    connection.close()


@pytest.fixture
def client(db_session):
    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def user_a(db_session):
    user = User(
        email="user_a@example.com",
        hashed_password=get_password_hash("password123"),
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture
def user_a_headers(user_a):
    token = create_access_token(subject=user_a.id)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def user_b(db_session):
    user = User(
        email="user_b@example.com",
        hashed_password=get_password_hash("password456"),
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture
def user_b_headers(user_b):
    token = create_access_token(subject=user_b.id)
    return {"Authorization": f"Bearer {token}"}
