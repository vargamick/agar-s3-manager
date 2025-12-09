"""S3 document management routes."""

from flask import Blueprint, request, jsonify
from werkzeug.utils import secure_filename
from typing import Dict, Any
import os
from loguru import logger

from services.s3_service import S3DocumentService
from config import Config

s3_bp = Blueprint('s3_management', __name__)
s3_service = None


def get_s3_service() -> S3DocumentService:
    """Get or create S3 service instance."""
    global s3_service
    if s3_service is None:
        s3_service = S3DocumentService(
            bucket_name=Config.S3_BUCKET_NAME,
            region_name=Config.AWS_REGION
        )
    return s3_service


def handle_api_error(error: Exception, operation: str) -> Dict[str, Any]:
    """Handle API errors consistently."""
    error_msg = f"Failed to {operation}: {str(error)}"
    logger.error(error_msg)
    return {'success': False, 'error': error_msg, 'operation': operation}


@s3_bp.route('/documents', methods=['GET'])
def list_documents():
    """List all documents with metadata."""
    try:
        folder_path = request.args.get('folder_path', 'documents/')
        immediate_children_only = request.args.get('immediate_children_only', 'false').lower() == 'true'

        service = get_s3_service()
        documents = service.list_documents(folder_path, immediate_children_only)

        return jsonify({
            'success': True,
            'documents': documents,
            'count': len(documents),
            'folder_path': folder_path
        })

    except Exception as e:
        return jsonify(handle_api_error(e, 'list documents')), 500


@s3_bp.route('/documents', methods=['POST'])
def upload_document():
    """Upload new document."""
    try:
        if 'file' not in request.files:
            return jsonify({'success': False, 'error': 'No file provided'}), 400

        file = request.files['file']
        if file.filename == '':
            return jsonify({'success': False, 'error': 'No file selected'}), 400

        filename = secure_filename(file.filename)
        folder_path = request.form.get('folder_path')
        if folder_path is None:
            folder_path = 'documents/'

        allowed_extensions = {'.pdf', '.docx', '.doc', '.txt', '.md', '.json', '.zip', '.csv'}
        file_ext = os.path.splitext(filename)[1].lower()
        if file_ext not in allowed_extensions:
            return jsonify({
                'success': False,
                'error': f'File type {file_ext} not allowed'
            }), 400

        service = get_s3_service()
        result = service.upload_document(file, filename, folder_path)

        return jsonify(result), 201

    except Exception as e:
        return jsonify(handle_api_error(e, 'upload document')), 500


@s3_bp.route('/documents/<path:document_path>', methods=['GET'])
def get_document_metadata(document_path: str):
    """Get specific document metadata."""
    try:
        service = get_s3_service()
        metadata = service.get_document_metadata(document_path)

        if 'error' in metadata:
            return jsonify({'success': False, 'error': metadata['error'], 'key': document_path}), 404

        return jsonify({'success': True, 'metadata': metadata})

    except Exception as e:
        return jsonify(handle_api_error(e, 'get document metadata')), 500


@s3_bp.route('/documents/<path:document_path>', methods=['DELETE'])
def delete_document(document_path: str):
    """Delete document."""
    try:
        service = get_s3_service()
        result = service.delete_document(document_path)

        if not result['success']:
            return jsonify(result), 404

        return jsonify(result)

    except Exception as e:
        return jsonify(handle_api_error(e, 'delete document')), 500


@s3_bp.route('/documents/<path:document_path>/move', methods=['PUT'])
def move_document(document_path: str):
    """Move document to new location."""
    try:
        data = request.get_json()
        if not data or 'destination_path' not in data:
            return jsonify({'success': False, 'error': 'destination_path is required'}), 400

        destination_path = data['destination_path']
        service = get_s3_service()
        result = service.move_document(document_path, destination_path)

        return jsonify(result)

    except Exception as e:
        return jsonify(handle_api_error(e, 'move document')), 500


@s3_bp.route('/folders', methods=['GET'])
def get_folder_structure():
    """Get folder structure."""
    try:
        service = get_s3_service()
        structure = service.get_folder_structure()

        return jsonify({'success': True, 'structure': structure})

    except Exception as e:
        return jsonify(handle_api_error(e, 'get folder structure')), 500


@s3_bp.route('/folders', methods=['POST'])
def create_folder():
    """Create new folder."""
    try:
        data = request.get_json()
        if not data or 'folder_path' not in data:
            return jsonify({'success': False, 'error': 'folder_path is required'}), 400

        folder_path = data['folder_path']
        service = get_s3_service()
        result = service.create_folder(folder_path)

        return jsonify(result), 201

    except Exception as e:
        return jsonify(handle_api_error(e, 'create folder')), 500


@s3_bp.route('/folders/<path:folder_path>', methods=['DELETE'])
def delete_folder(folder_path: str):
    """Delete folder and all contents."""
    try:
        service = get_s3_service()
        result = service.delete_folder(folder_path)

        return jsonify(result)

    except Exception as e:
        return jsonify(handle_api_error(e, 'delete folder')), 500


@s3_bp.route('/bulk/upload', methods=['POST'])
def bulk_upload():
    """Upload multiple documents."""
    try:
        if 'files' not in request.files:
            return jsonify({'success': False, 'error': 'No files provided'}), 400

        files = request.files.getlist('files')
        folder_path = request.form.get('folder_path', 'documents/')

        files_data = []
        for file in files:
            if file.filename != '':
                filename = secure_filename(file.filename)
                files_data.append({'data': file, 'filename': filename})

        if not files_data:
            return jsonify({'success': False, 'error': 'No valid files provided'}), 400

        service = get_s3_service()
        result = service.bulk_upload(files_data, folder_path)

        return jsonify(result), 201

    except Exception as e:
        return jsonify(handle_api_error(e, 'bulk upload')), 500


@s3_bp.route('/bulk/delete', methods=['POST'])
def bulk_delete():
    """Delete multiple documents."""
    try:
        data = request.get_json()
        if not data or 'document_paths' not in data:
            return jsonify({'success': False, 'error': 'document_paths is required'}), 400

        document_paths = data['document_paths']
        if not isinstance(document_paths, list):
            return jsonify({'success': False, 'error': 'document_paths must be a list'}), 400

        service = get_s3_service()
        result = service.bulk_delete(document_paths)

        return jsonify(result)

    except Exception as e:
        return jsonify(handle_api_error(e, 'bulk delete')), 500


@s3_bp.route('/structure/tree', methods=['GET'])
def get_folder_tree():
    """Get hierarchical folder structure for tree view."""
    try:
        service = get_s3_service()
        result = service.get_folder_tree_structure()

        return jsonify({'success': True, 'tree_structure': result})

    except Exception as e:
        return jsonify(handle_api_error(e, 'get folder tree')), 500


@s3_bp.route('/folder/contents', methods=['GET'])
def get_folder_contents():
    """Get immediate contents of a folder."""
    try:
        folder_path = request.args.get('folder_path', '')
        service = get_s3_service()
        result = service.list_folder_contents(folder_path)

        return jsonify(result)

    except Exception as e:
        return jsonify(handle_api_error(e, 'get folder contents')), 500


@s3_bp.route('/folder/<path:folder_path>', methods=['DELETE'])
def delete_folder_recursive(folder_path: str):
    """Delete entire folder and all its contents recursively."""
    try:
        service = get_s3_service()
        result = service.delete_folder_recursive(folder_path)

        return jsonify(result)

    except Exception as e:
        return jsonify(handle_api_error(e, 'delete folder recursive')), 500


@s3_bp.route('/move', methods=['POST'])
def move_file():
    """Move/rename a file to a new location."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'success': False, 'error': 'Request body is required'}), 400

        source_key = data.get('source_key')
        destination_key = data.get('destination_key')

        if not source_key:
            return jsonify({'success': False, 'error': 'source_key is required'}), 400
        if not destination_key:
            return jsonify({'success': False, 'error': 'destination_key is required'}), 400

        service = get_s3_service()
        result = service.move_document(source_key, destination_key)

        return jsonify(result)

    except Exception as e:
        return jsonify(handle_api_error(e, 'move file')), 500


@s3_bp.route('/download', methods=['GET'])
def download_file():
    """Generate a presigned URL for downloading a file."""
    try:
        file_key = request.args.get('key')
        if not file_key:
            return jsonify({'success': False, 'error': 'key parameter is required'}), 400

        # Optional expiration time in seconds (default: 1 hour)
        expiration = request.args.get('expiration', 3600, type=int)

        service = get_s3_service()
        result = service.generate_presigned_url(file_key, expiration)

        if not result['success']:
            return jsonify(result), 404

        return jsonify(result)

    except Exception as e:
        return jsonify(handle_api_error(e, 'generate download url')), 500
