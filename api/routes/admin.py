"""Admin API proxy routes for Memento admin operations."""

import requests
from flask import Blueprint, request, jsonify
from loguru import logger

from config import Config

admin_bp = Blueprint('admin', __name__)


def get_admin_headers():
    """Get headers for Memento Admin API requests."""
    return {
        'Content-Type': 'application/json',
        'x-api-key': Config.MEMENTO_API_KEY
    }


def proxy_to_admin(method: str, endpoint: str, data: dict = None, params: dict = None, headers: dict = None):
    """Proxy request to Memento Admin API."""
    url = f"{Config.MEMENTO_API_URL}/admin/{endpoint}"
    req_headers = get_admin_headers()
    if headers:
        req_headers.update(headers)

    try:
        if method == 'GET':
            response = requests.get(url, headers=req_headers, params=params, timeout=60)
        elif method == 'POST':
            response = requests.post(url, headers=req_headers, json=data, timeout=300)
        elif method == 'DELETE':
            response = requests.delete(url, headers=req_headers, timeout=60)
        else:
            return {'success': False, 'error': f'Unsupported method: {method}'}, 400

        return response.json(), response.status_code
    except requests.exceptions.Timeout:
        logger.error(f"Timeout calling Memento Admin API: {endpoint}")
        return {'success': False, 'error': 'Request timeout'}, 504
    except requests.exceptions.ConnectionError as e:
        logger.error(f"Connection error to Memento Admin API: {e}")
        return {'success': False, 'error': 'Unable to connect to admin API'}, 503
    except Exception as e:
        logger.error(f"Error proxying to Memento Admin API: {e}")
        return {'success': False, 'error': str(e)}, 500


# ============================================
# Health & Stats
# ============================================

@admin_bp.route('/health', methods=['GET'])
def admin_health():
    """Get admin system health status."""
    result, status = proxy_to_admin('GET', 'health')
    return jsonify(result), status


@admin_bp.route('/stats', methods=['GET'])
def admin_stats():
    """Get database statistics."""
    result, status = proxy_to_admin('GET', 'stats')
    return jsonify(result), status


# ============================================
# S3 Scrape Runs
# ============================================

@admin_bp.route('/s3/scrape-runs', methods=['GET'])
def list_scrape_runs():
    """List available scrape runs from S3."""
    result, status = proxy_to_admin('GET', 's3/scrape-runs')
    return jsonify(result), status


# ============================================
# Database Reset
# ============================================

@admin_bp.route('/reset/preview', methods=['GET'])
def reset_preview():
    """Preview what will be deleted in a reset."""
    result, status = proxy_to_admin('GET', 'reset/preview')
    return jsonify(result), status


@admin_bp.route('/reset', methods=['POST'])
def reset_databases():
    """Reset databases (with automatic backup)."""
    # Pass through the confirmation header
    headers = {}
    if request.headers.get('x-admin-confirm'):
        headers['x-admin-confirm'] = request.headers.get('x-admin-confirm')

    result, status = proxy_to_admin('POST', 'reset', headers=headers)
    return jsonify(result), status


# ============================================
# Refresh from S3
# ============================================

@admin_bp.route('/refresh', methods=['POST'])
def start_refresh():
    """Start a refresh job from S3 scrape data."""
    data = request.get_json() or {}
    result, status = proxy_to_admin('POST', 'refresh', data)
    return jsonify(result), status


@admin_bp.route('/refresh/status', methods=['GET'])
def refresh_status():
    """Get current refresh job status."""
    result, status = proxy_to_admin('GET', 'refresh/status')
    return jsonify(result), status


@admin_bp.route('/refresh/jobs/<job_id>', methods=['GET'])
def get_job(job_id: str):
    """Get specific job details."""
    result, status = proxy_to_admin('GET', f'refresh/jobs/{job_id}')
    return jsonify(result), status


@admin_bp.route('/refresh/jobs/<job_id>', methods=['DELETE'])
def cancel_job(job_id: str):
    """Cancel a running job."""
    result, status = proxy_to_admin('DELETE', f'refresh/jobs/{job_id}')
    return jsonify(result), status


# ============================================
# Backup Management
# ============================================

@admin_bp.route('/backup', methods=['POST'])
def create_backup():
    """Create a database backup."""
    data = request.get_json() or {}
    result, status = proxy_to_admin('POST', 'backup', data)
    return jsonify(result), status


@admin_bp.route('/backup/list', methods=['GET'])
def list_backups():
    """List available backups."""
    result, status = proxy_to_admin('GET', 'backup/list')
    return jsonify(result), status


@admin_bp.route('/backup/restore', methods=['POST'])
def restore_backup():
    """Restore from a backup."""
    data = request.get_json() or {}
    result, status = proxy_to_admin('POST', 'backup/restore', data)
    return jsonify(result), status
