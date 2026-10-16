import pytest
from fastapi import status


def test_register_user_success(client):
    res = client.post(
        "/api/auth/register",
        json={"email": "newuser@example.com", "password": "securepassword123"},
    )
    assert res.status_code == status.HTTP_201_CREATED
    data = res.json()
    assert data["email"] == "newuser@example.com"
    assert "id" in data
    assert data["is_active"] is True
    assert data["has_udemy_connected"] is False


def test_register_user_duplicate_email(client, user_a):
    res = client.post(
        "/api/auth/register",
        json={"email": user_a.email, "password": "password123"},
    )
    assert res.status_code == status.HTTP_400_BAD_REQUEST
    assert "already exists" in res.json()["detail"]


def test_login_success(client, user_a):
    res = client.post(
        "/api/auth/login",
        json={"email": user_a.email, "password": "password123"},
    )
    assert res.status_code == status.HTTP_200_OK
    data = res.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert data["user"]["email"] == user_a.email


def test_login_wrong_password(client, user_a):
    res = client.post(
        "/api/auth/login",
        json={"email": user_a.email, "password": "wrongpassword"},
    )
    assert res.status_code == status.HTTP_401_UNAUTHORIZED


def test_get_me_authenticated(client, user_a, user_a_headers):
    res = client.get("/api/auth/me", headers=user_a_headers)
    assert res.status_code == status.HTTP_200_OK
    data = res.json()
    assert data["email"] == user_a.email
    assert data["id"] == user_a.id


def test_get_me_unauthenticated(client):
    res = client.get("/api/auth/me")
    assert res.status_code == status.HTTP_401_UNAUTHORIZED


def test_logout(client, user_a_headers):
    res = client.post("/api/auth/logout", headers=user_a_headers)
    assert res.status_code == status.HTTP_200_OK
    assert res.json()["message"] == "Logged out successfully"
