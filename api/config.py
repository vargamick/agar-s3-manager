"""
Configuration for Agar S3 Manager API.
"""

import os
from loguru import logger


class Config:
    """Configuration management for S3 Manager API."""

    # Flask Configuration
    FLASK_ENV = os.getenv('FLASK_ENV', 'development')
    API_PORT = int(os.getenv('API_PORT', 3500))
    DEBUG = FLASK_ENV == 'development'

    # AWS Configuration
    AWS_REGION = os.getenv('AWS_REGION', 'ap-southeast-2')

    # S3 Configuration
    AWS_S3_ACCESS_KEY_ID = os.getenv('AWS_S3_ACCESS_KEY_ID')
    AWS_S3_SECRET_ACCESS_KEY = os.getenv('AWS_S3_SECRET_ACCESS_KEY')
    S3_BUCKET_NAME = os.getenv('S3_BUCKET_NAME', 'agar-documentation')

    # Logging Configuration
    LOG_LEVEL = os.getenv('LOG_LEVEL', 'INFO')

    # Memento Processing API Configuration
    MEMENTO_API_URL = os.getenv('MEMENTO_API_URL', 'https://api.askagar.3dn.com.au/api/v1')
    MEMENTO_API_KEY = os.getenv('MEMENTO_API_KEY', '')

    @classmethod
    def validate_s3_config(cls) -> bool:
        """Validate S3 configuration is complete."""
        if not all([cls.AWS_S3_ACCESS_KEY_ID, cls.AWS_S3_SECRET_ACCESS_KEY, cls.S3_BUCKET_NAME]):
            logger.error("Missing required S3 configuration")
            return False
        return True


def setup_logging():
    """Configure logging for the application."""
    log_level = Config.LOG_LEVEL.upper()

    logger.remove()
    logger.add(
        "logs/api-server.log",
        rotation="1 day",
        retention="30 days",
        level=log_level,
        format="{time:YYYY-MM-DD HH:mm:ss} | {level} | {name}:{function}:{line} | {message}"
    )
    logger.add(
        lambda msg: print(msg, end=""),
        level=log_level,
        format="<green>{time:HH:mm:ss}</green> | <level>{level}</level> | {message}"
    )
