"""Processing API proxy routes for Memento integration."""

import requests
from flask import Blueprint, request, jsonify
from loguru import logger

from config import Config

processing_bp = Blueprint('processing', __name__)


def get_memento_headers():
    """Get headers for Memento API requests."""
    return {
        'Content-Type': 'application/json',
        'x-api-key': Config.MEMENTO_API_KEY
    }


def proxy_to_memento(method: str, endpoint: str, data: dict = None, params: dict = None):
    """Proxy request to Memento Processing API."""
    url = f"{Config.MEMENTO_API_URL}/processing/{endpoint}"
    headers = get_memento_headers()

    try:
        if method == 'GET':
            response = requests.get(url, headers=headers, params=params, timeout=60)
        elif method == 'POST':
            response = requests.post(url, headers=headers, json=data, timeout=120)
        elif method == 'DELETE':
            response = requests.delete(url, headers=headers, timeout=60)
        else:
            return {'success': False, 'error': f'Unsupported method: {method}'}, 400

        return response.json(), response.status_code
    except requests.exceptions.Timeout:
        logger.error(f"Timeout calling Memento API: {endpoint}")
        return {'success': False, 'error': 'Request timeout'}, 504
    except requests.exceptions.ConnectionError as e:
        logger.error(f"Connection error to Memento API: {e}")
        return {'success': False, 'error': 'Unable to connect to processing API'}, 503
    except Exception as e:
        logger.error(f"Error proxying to Memento API: {e}")
        return {'success': False, 'error': str(e)}, 500


# ============================================
# Configuration Check
# ============================================

@processing_bp.route('/config', methods=['GET'])
def check_config():
    """Check if processing API is configured."""
    is_configured = bool(Config.MEMENTO_API_KEY)
    return jsonify({
        'success': True,
        'configured': is_configured,
        'apiUrl': Config.MEMENTO_API_URL if is_configured else None
    })


# ============================================
# Job Management
# ============================================

@processing_bp.route('/jobs', methods=['GET'])
def list_jobs():
    """List all processing jobs."""
    result, status = proxy_to_memento('GET', 'jobs')
    return jsonify(result), status


@processing_bp.route('/jobs/<job_id>', methods=['GET'])
def get_job_status(job_id: str):
    """Get status of a specific job."""
    result, status = proxy_to_memento('GET', f'jobs/{job_id}')
    return jsonify(result), status


@processing_bp.route('/jobs/<job_id>', methods=['DELETE'])
def cancel_job(job_id: str):
    """Cancel a running job."""
    result, status = proxy_to_memento('DELETE', f'jobs/{job_id}')
    return jsonify(result), status


# ============================================
# Phase 1: Metadata Processing
# ============================================

@processing_bp.route('/metadata/start', methods=['POST'])
def start_metadata_job():
    """Start a new metadata processing job."""
    data = request.get_json() or {}
    result, status = proxy_to_memento('POST', 'metadata/start', data)
    return jsonify(result), status


@processing_bp.route('/metadata/load', methods=['POST'])
def load_metadata():
    """Load metadata from S3 scrape run."""
    data = request.get_json() or {}
    result, status = proxy_to_memento('POST', 'metadata/load', data)
    return jsonify(result), status


@processing_bp.route('/metadata/batch', methods=['POST'])
def process_metadata_batch():
    """Process a batch of products."""
    data = request.get_json() or {}
    result, status = proxy_to_memento('POST', 'metadata/batch', data)
    return jsonify(result), status


@processing_bp.route('/metadata/sync-catalog', methods=['POST'])
def sync_catalog():
    """Sync catalog entities."""
    data = request.get_json() or {}
    result, status = proxy_to_memento('POST', 'metadata/sync-catalog', data)
    return jsonify(result), status


# ============================================
# Phase 2: PDF Processing
# ============================================

@processing_bp.route('/pdf/start', methods=['POST'])
def start_pdf_job():
    """Start a new PDF processing job."""
    data = request.get_json() or {}
    result, status = proxy_to_memento('POST', 'pdf/start', data)
    return jsonify(result), status


@processing_bp.route('/pdf/list', methods=['GET'])
def list_pdfs():
    """List PDFs to process."""
    params = {
        'jobId': request.args.get('jobId'),
        'scrapeRunPath': request.args.get('scrapeRunPath')
    }
    result, status = proxy_to_memento('GET', 'pdf/list', params=params)
    return jsonify(result), status


@processing_bp.route('/pdf/batch', methods=['POST'])
def process_pdf_batch():
    """Process a batch of PDFs."""
    data = request.get_json() or {}
    result, status = proxy_to_memento('POST', 'pdf/batch', data)
    return jsonify(result), status


# ============================================
# Phase 3: Embedding Generation
# ============================================

@processing_bp.route('/embeddings/start', methods=['POST'])
def start_embeddings_job():
    """Start a new embeddings generation job."""
    data = request.get_json() or {}
    result, status = proxy_to_memento('POST', 'embeddings/start', data)
    return jsonify(result), status


@processing_bp.route('/embeddings/entities', methods=['GET'])
def list_entities_for_embedding():
    """List entities that need embeddings."""
    params = {
        'jobId': request.args.get('jobId'),
        'limit': request.args.get('limit', 100)
    }
    result, status = proxy_to_memento('GET', 'embeddings/entities', params=params)
    return jsonify(result), status


@processing_bp.route('/embeddings/batch', methods=['POST'])
def generate_embeddings_batch():
    """Generate embeddings for a batch of entities."""
    data = request.get_json() or {}
    result, status = proxy_to_memento('POST', 'embeddings/batch', data)
    return jsonify(result), status
