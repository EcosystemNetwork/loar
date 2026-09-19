import os

# main.py validates configuration at import time (fail-fast on a bad deploy),
# so the environment must exist before any test module imports it.
os.environ.update(
    {
        "LOAR_API_BASE": "https://loar.test",
        "LOAR_API_KEY": "loar_test",
        "GRADIUM_API_KEY": "gsk_test",
        "SAMBANOVA_API_KEY": "sn_test",
        "VOICE_SESSION_SECRET": "app-test-secret",
        "HUME_API_KEY": "hume_test",
        "ALLOWED_ORIGINS": "https://loar.fun",
    }
)
