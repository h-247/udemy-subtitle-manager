import base64
import hashlib
from cryptography.fernet import Fernet
from app.config import settings


def _get_fernet_key(secret_key: str) -> bytes:
    """Derive a URL-safe 32-byte Fernet key from the application secret key."""
    digest = hashlib.sha256(secret_key.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest)


class CryptoService:
    def __init__(self, secret_key: str):
        key = _get_fernet_key(secret_key)
        self.fernet = Fernet(key)

    def encrypt_text(self, plain_text: str) -> str:
        """Encrypts plain text and returns a base64-encoded encrypted string."""
        if not plain_text:
            return ""
        encrypted_bytes = self.fernet.encrypt(plain_text.encode("utf-8"))
        return encrypted_bytes.decode("utf-8")

    def decrypt_text(self, encrypted_text: str) -> str:
        """Decrypts encrypted text string and returns original plain text."""
        if not encrypted_text:
            return ""
        decrypted_bytes = self.fernet.decrypt(encrypted_text.encode("utf-8"))
        return decrypted_bytes.decode("utf-8")


crypto_service = CryptoService(settings.SECRET_KEY)
