"""Health check endpoints."""

from flask import Blueprint, jsonify
from datetime import datetime
import boto3
from botocore.exceptions import ClientError, NoCredentialsError
from loguru import logger
import os

from config import Config

health_bp = Blueprint('health', __name__)


@health_bp.route('/', methods=['GET'])
def health_check():
    """Basic health check endpoint."""
    return jsonify({
        'status': 'healthy',
        'service': 'Agar S3 Manager API',
        'timestamp': datetime.utcnow().isoformat(),
        'version': '1.0.0'
    })


@health_bp.route('/s3', methods=['GET'])
def s3_health_check():
    """S3 connectivity check."""
    try:
        aws_access_key_id = (
            os.environ.get('AWS_S3_ACCESS_KEY_ID') or
            os.environ.get('AWS_ACCESS_KEY_ID')
        )
        aws_secret_access_key = (
            os.environ.get('AWS_S3_SECRET_ACCESS_KEY') or
            os.environ.get('AWS_SECRET_ACCESS_KEY')
        )

        if aws_access_key_id and aws_secret_access_key:
            s3_client = boto3.client(
                's3',
                region_name=Config.AWS_REGION,
                aws_access_key_id=aws_access_key_id,
                aws_secret_access_key=aws_secret_access_key
            )
        else:
            s3_client = boto3.client('s3', region_name=Config.AWS_REGION)

        s3_client.head_bucket(Bucket=Config.S3_BUCKET_NAME)

        return jsonify({
            'status': 'healthy',
            'bucket': Config.S3_BUCKET_NAME,
            'region': Config.AWS_REGION,
            'timestamp': datetime.utcnow().isoformat()
        })

    except (NoCredentialsError, ClientError) as e:
        logger.error(f"S3 health check failed: {e}")
        return jsonify({
            'status': 'unhealthy',
            'error': str(e),
            'bucket': Config.S3_BUCKET_NAME,
            'timestamp': datetime.utcnow().isoformat()
        }), 503
