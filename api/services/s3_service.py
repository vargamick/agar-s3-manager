import boto3
import os
from datetime import datetime
from typing import List, Dict, Optional, Any
from botocore.exceptions import ClientError, NoCredentialsError
from loguru import logger


class S3DocumentService:
    """
    Enhanced S3 service for comprehensive document management.
    Extends basic S3 operations with folder management, metadata extraction,
    and bulk operations for the Ask Agar project.
    """
    
    # Class constants
    FOLDER_MARKER_FILE = '.folder_marker'
    DEFAULT_MAX_FILE_SIZE_MB = 50
    
    def __init__(self, bucket_name: str, region_name: str = 'ap-southeast-2'):
        """
        Initialize S3 service with bucket configuration.
        
        Args:
            bucket_name: Name of the S3 bucket
            region_name: AWS region (default: ap-southeast-2)
        """
        self.bucket_name = bucket_name
        self.region_name = region_name
        
        try:
            # Get credentials from environment - try S3-specific first, then generic AWS
            aws_access_key_id = (
                os.environ.get('AWS_S3_ACCESS_KEY_ID') or 
                os.environ.get('AWS_ACCESS_KEY_ID')
            )
            aws_secret_access_key = (
                os.environ.get('AWS_S3_SECRET_ACCESS_KEY') or 
                os.environ.get('AWS_SECRET_ACCESS_KEY')
            )
            
            # Log credential source for debugging
            if os.environ.get('AWS_S3_ACCESS_KEY_ID'):
                logger.info("Using S3-specific credentials (AWS_S3_ACCESS_KEY_ID)")
            elif os.environ.get('AWS_ACCESS_KEY_ID'):
                logger.info("Using generic AWS credentials (AWS_ACCESS_KEY_ID)")
            else:
                logger.warning("No explicit AWS credentials found in environment")
            
            # Initialize S3 client and resource with explicit credentials
            if aws_access_key_id and aws_secret_access_key:
                self.s3_client = boto3.client(
                    's3',
                    region_name=region_name,
                    aws_access_key_id=aws_access_key_id,
                    aws_secret_access_key=aws_secret_access_key
                )
                self.s3_resource = boto3.resource(
                    's3',
                    region_name=region_name,
                    aws_access_key_id=aws_access_key_id,
                    aws_secret_access_key=aws_secret_access_key
                )
                logger.info(f"S3 service initialized with explicit credentials for bucket: {bucket_name}")
            else:
                # Fallback to default credential chain
                self.s3_client = boto3.client('s3', region_name=region_name)
                self.s3_resource = boto3.resource('s3', region_name=region_name)
                logger.warning(f"S3 service initialized with default credential chain for bucket: {bucket_name}")
            
            self.bucket = self.s3_resource.Bucket(bucket_name)
            
            # Test connection
            self.s3_client.head_bucket(Bucket=bucket_name)
            logger.info(f"S3 connection test successful for bucket: {bucket_name}")
            
        except NoCredentialsError:
            logger.error("AWS credentials not found")
            raise
        except ClientError as e:
            logger.error(f"Failed to connect to S3 bucket {bucket_name}: {e}")
            raise
    
    # ==================== COMMON HELPER FUNCTIONS ====================
    
    def _normalize_folder_path(self, path: str) -> str:
        """
        Normalize folder path to ensure consistency.
        
        Args:
            path: Folder path to normalize
            
        Returns:
            Normalized folder path ending with '/'
        """
        if not path:
            return ''
        
        # Remove duplicate slashes and ensure single trailing slash
        normalized = '/'.join(filter(None, path.split('/'))) + '/'
        
        # Handle root path case
        if normalized == '/':
            return ''
            
        return normalized
    
    def _validate_file_data(self, file_data: Any, filename: str, max_size_mb: int = None) -> Dict[str, Any]:
        """
        Validate file data and metadata.
        
        Args:
            file_data: File data to validate
            filename: Name of the file
            max_size_mb: Maximum file size in MB (default: class constant)
            
        Returns:
            Dictionary with validation result
        """
        if max_size_mb is None:
            max_size_mb = self.DEFAULT_MAX_FILE_SIZE_MB
            
        validation_result = {
            'valid': True,
            'errors': [],
            'warnings': [],
            'file_size': 0,
            'content_type': None
        }
        
        # Validate filename
        if not filename or filename.strip() == '':
            validation_result['valid'] = False
            validation_result['errors'].append('Filename cannot be empty')
            return validation_result
        
        # Get file size
        file_size = 0
        if hasattr(file_data, 'size'):
            file_size = file_data.size
        elif hasattr(file_data, 'content_length'):
            file_size = file_data.content_length
        elif isinstance(file_data, (bytes, str)):
            file_size = len(file_data)
        
        validation_result['file_size'] = file_size
        
        # Validate file size
        if not self.validate_file_size(file_size, max_size_mb):
            validation_result['valid'] = False
            size_mb = file_size / (1024 * 1024)
            validation_result['errors'].append(f'File size {size_mb:.1f}MB exceeds {max_size_mb}MB limit')
        
        # Get content type
        validation_result['content_type'] = self._get_content_type(filename)
        
        return validation_result
    
    def _get_content_type(self, filename: str) -> str:
        """
        Get content type for file based on extension.
        
        Args:
            filename: Name of the file
            
        Returns:
            MIME content type string
        """
        file_ext = os.path.splitext(filename)[1].lower()
        content_type_map = {
            '.pdf': 'application/pdf',
            '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            '.doc': 'application/msword',
            '.txt': 'text/plain',
            '.md': 'text/markdown',
            '.json': 'application/json',
            '.csv': 'text/csv',
            '.xml': 'application/xml',
            '.html': 'text/html',
            '.htm': 'text/html',
            '.rtf': 'application/rtf'
        }
        return content_type_map.get(file_ext, 'application/octet-stream')
    
    def _execute_s3_operation(self, operation_func, *args, error_context: str, **kwargs) -> Dict[str, Any]:
        """
        Execute S3 operation with consistent error handling.
        
        Args:
            operation_func: S3 operation function to execute
            *args: Positional arguments for the operation
            error_context: Context description for error logging
            **kwargs: Keyword arguments for the operation
            
        Returns:
            Dictionary with operation result
        """
        try:
            result = operation_func(*args, **kwargs)
            logger.debug(f"S3 operation successful: {error_context}")
            return {
                'success': True,
                'result': result,
                'error': None
            }
        except ClientError as e:
            error_code = e.response.get('Error', {}).get('Code', 'Unknown')
            error_message = e.response.get('Error', {}).get('Message', str(e))
            logger.error(f"S3 operation failed ({error_context}): {error_code} - {error_message}")
            return {
                'success': False,
                'result': None,
                'error': {
                    'code': error_code,
                    'message': error_message,
                    'context': error_context
                }
            }
        except Exception as e:
            logger.error(f"Unexpected error in S3 operation ({error_context}): {e}")
            return {
                'success': False,
                'result': None,
                'error': {
                    'code': 'UnexpectedError',
                    'message': str(e),
                    'context': error_context
                }
            }
    
    def _filter_immediate_children(self, documents: List[Dict[str, Any]], folder_path: str) -> List[Dict[str, Any]]:
        """
        Filter documents to show only immediate children of the specified folder.
        
        Args:
            documents: List of all documents in the folder and subfolders
            folder_path: The parent folder path to filter for immediate children
            
        Returns:
            List of documents that are immediate children of the folder
        """
        immediate_children = []
        
        # Normalize folder path
        if folder_path and not folder_path.endswith('/'):
            folder_path += '/'
        
        for doc in documents:
            doc_key = doc['key']
            
            # Remove the folder_path prefix to get relative path
            if folder_path:
                if not doc_key.startswith(folder_path):
                    continue
                relative_path = doc_key[len(folder_path):]
            else:
                relative_path = doc_key
            
            # Check if this is an immediate child (no additional slashes in relative path)
            if '/' not in relative_path:
                immediate_children.append(doc)
        
        return immediate_children
    
    def _ensure_folder_visible(self, folder_path: str) -> Dict[str, Any]:
        """
        Ensure folder is visible in tree structure by creating both marker and placeholder file.
        
        Args:
            folder_path: Path of the folder to create
            
        Returns:
            Dictionary with creation result
        """
        try:
            normalized_path = self._normalize_folder_path(folder_path)
            
            logger.info(f"Creating visible folder: {normalized_path}")
            
            # Create folder marker for S3 compatibility
            marker_result = self._execute_s3_operation(
                self.s3_client.put_object,
                Bucket=self.bucket_name,
                Key=normalized_path,
                Body='',
                ContentType='application/x-directory',
                error_context=f"create folder marker {normalized_path}"
            )
            
            if not marker_result['success']:
                return {
                    'success': False,
                    'folder_path': normalized_path,
                    'error': f"Failed to create folder marker: {marker_result['error']['message']}"
                }
            
            # Create hidden placeholder file to ensure folder appears in tree
            placeholder_key = f"{normalized_path}{self.FOLDER_MARKER_FILE}"
            placeholder_content = f"Folder marker created at {datetime.utcnow().isoformat()}"
            
            placeholder_result = self._execute_s3_operation(
                self.s3_client.put_object,
                Bucket=self.bucket_name,
                Key=placeholder_key,
                Body=placeholder_content,
                ContentType='text/plain',
                Metadata={
                    'folder_marker': 'true',
                    'created_at': datetime.utcnow().isoformat()
                },
                error_context=f"create folder placeholder {placeholder_key}"
            )
            
            if not placeholder_result['success']:
                # Try to clean up the marker if placeholder creation failed
                try:
                    self.s3_client.delete_object(Bucket=self.bucket_name, Key=normalized_path)
                except:
                    pass  # Ignore cleanup errors
                
                return {
                    'success': False,
                    'folder_path': normalized_path,
                    'error': f"Failed to create folder placeholder: {placeholder_result['error']['message']}"
                }
            
            result = {
                'success': True,
                'folder_path': normalized_path,
                'marker_created': True,
                'placeholder_created': True,
                'message': f'Folder {normalized_path} created successfully with visibility marker'
            }
            
            logger.info(f"Successfully created visible folder: {normalized_path}")
            return result
            
        except Exception as e:
            logger.error(f"Unexpected error creating visible folder {folder_path}: {e}")
            return {
                'success': False,
                'folder_path': folder_path,
                'error': str(e)
            }
    
    # ==================== END HELPER FUNCTIONS ====================
    
    def list_documents(self, folder_path: str = "documents/", immediate_children_only: bool = False) -> List[Dict[str, Any]]:
        """
        List all documents in bucket with metadata.
        
        Args:
            folder_path: Path to list documents from (default: documents/)
            immediate_children_only: If True, only return immediate children (files and folders)
            
        Returns:
            List of document dictionaries with metadata
        """
        try:
            documents = []
            
            # Ensure folder_path ends with /
            if folder_path and not folder_path.endswith('/'):
                folder_path += '/'
            
            # List objects with the specified prefix
            response = self.s3_client.list_objects_v2(
                Bucket=self.bucket_name,
                Prefix=folder_path
            )
            
            if 'Contents' in response:
                for obj in response['Contents']:
                    key = obj['Key']
                    filename = os.path.basename(key)
                    
                    # Skip folder markers (objects ending with /) and hidden folder marker files
                    if not key.endswith('/') and filename != self.FOLDER_MARKER_FILE:
                        doc_info = {
                            'key': key,
                            'filename': filename,
                            'size': obj['Size'],
                            'last_modified': obj['LastModified'].isoformat(),
                            'etag': obj['ETag'].strip('"'),
                            'storage_class': obj.get('StorageClass', 'STANDARD'),
                            'folder': os.path.dirname(key) + '/' if os.path.dirname(key) else ''
                        }
                        documents.append(doc_info)
            
            # If immediate_children_only is True, filter to show only immediate children
            if immediate_children_only:
                documents = self._filter_immediate_children(documents, folder_path)
            
            logger.info(f"Listed {len(documents)} documents from {folder_path} (immediate_children_only: {immediate_children_only})")
            return documents
            
        except ClientError as e:
            logger.error(f"Failed to list documents from {folder_path}: {e}")
            raise
    
    def upload_document(self, file_data: Any, filename: str, folder_path: str = "documents/") -> Dict[str, Any]:
        """
        Upload document with metadata extraction using common helper functions.
        
        Args:
            file_data: File data to upload (file object or bytes)
            filename: Name of the file
            folder_path: Destination folder path (default: documents/)
            
        Returns:
            Dictionary with upload result and metadata
        """
        try:
            # Validate file data using common helper
            validation = self._validate_file_data(file_data, filename)
            if not validation['valid']:
                raise ValueError(f"File validation failed: {', '.join(validation['errors'])}")
            
            # Normalize folder path using common helper
            normalized_folder_path = self._normalize_folder_path(folder_path)
            if not normalized_folder_path and folder_path:
                normalized_folder_path = folder_path + '/' if not folder_path.endswith('/') else folder_path
            
            # Construct full S3 key
            s3_key = f"{normalized_folder_path}{filename}"
            
            # Get content type using common helper
            content_type = self._get_content_type(filename)
            file_ext = os.path.splitext(filename)[1].lower()
            
            # Upload file with metadata
            extra_args = {
                'ContentType': content_type,
                'Metadata': {
                    'uploaded_at': datetime.utcnow().isoformat(),
                    'original_filename': filename,
                    'file_extension': file_ext
                }
            }
            
            # Handle different file data types using S3 operation wrapper
            upload_result = None
            if hasattr(file_data, 'read'):
                # File-like object
                upload_result = self._execute_s3_operation(
                    self.s3_client.upload_fileobj,
                    file_data, self.bucket_name, s3_key,
                    ExtraArgs=extra_args,
                    error_context=f"upload file object {filename}"
                )
            elif isinstance(file_data, (bytes, str)):
                # Raw data
                upload_result = self._execute_s3_operation(
                    self.s3_client.put_object,
                    Bucket=self.bucket_name,
                    Key=s3_key,
                    Body=file_data,
                    ContentType=content_type,
                    Metadata=extra_args['Metadata'],
                    error_context=f"upload raw data {filename}"
                )
            else:
                # Assume it's a file path
                upload_result = self._execute_s3_operation(
                    self.s3_client.upload_file,
                    file_data, self.bucket_name, s3_key,
                    ExtraArgs=extra_args,
                    error_context=f"upload file path {filename}"
                )
            
            if not upload_result['success']:
                raise Exception(f"Upload failed: {upload_result['error']['message']}")
            
            # Get uploaded object metadata using S3 operation wrapper
            metadata_result = self._execute_s3_operation(
                self.s3_client.head_object,
                Bucket=self.bucket_name, Key=s3_key,
                error_context=f"get metadata for {filename}"
            )
            
            if not metadata_result['success']:
                raise Exception(f"Failed to retrieve metadata: {metadata_result['error']['message']}")
            
            response = metadata_result['result']
            result = {
                'success': True,
                'key': s3_key,
                'filename': filename,
                'size': response['ContentLength'],
                'content_type': response['ContentType'],
                'last_modified': response['LastModified'].isoformat(),
                'etag': response['ETag'].strip('"'),
                'metadata': response.get('Metadata', {})
            }
            
            logger.info(f"Successfully uploaded {filename} to {s3_key}")
            return result
            
        except Exception as e:
            logger.error(f"Failed to upload {filename}: {e}")
            raise
    
    def delete_document(self, document_path: str) -> Dict[str, Any]:
        """
        Delete document and return result.
        
        Args:
            document_path: Full S3 key of the document to delete
            
        Returns:
            Dictionary with deletion result
        """
        try:
            # Check if document exists
            try:
                self.s3_client.head_object(Bucket=self.bucket_name, Key=document_path)
            except ClientError as e:
                if e.response['Error']['Code'] == '404':
                    return {'success': False, 'error': 'Document not found', 'key': document_path}
                raise
            
            # Delete the document
            self.s3_client.delete_object(Bucket=self.bucket_name, Key=document_path)
            
            result = {
                'success': True,
                'key': document_path,
                'message': f'Document {document_path} deleted successfully'
            }
            
            logger.info(f"Successfully deleted document: {document_path}")
            return result
            
        except ClientError as e:
            logger.error(f"Failed to delete document {document_path}: {e}")
            raise
    
    def move_document(self, source_path: str, destination_path: str) -> Dict[str, Any]:
        """
        Move document between locations.
        
        Args:
            source_path: Current S3 key of the document
            destination_path: New S3 key for the document
            
        Returns:
            Dictionary with move result
        """
        try:
            # Copy object to new location
            copy_source = {'Bucket': self.bucket_name, 'Key': source_path}
            self.s3_client.copy_object(
                CopySource=copy_source,
                Bucket=self.bucket_name,
                Key=destination_path
            )
            
            # Delete original object
            self.s3_client.delete_object(Bucket=self.bucket_name, Key=source_path)
            
            result = {
                'success': True,
                'source_key': source_path,
                'destination_key': destination_path,
                'message': f'Document moved from {source_path} to {destination_path}'
            }
            
            logger.info(f"Successfully moved document from {source_path} to {destination_path}")
            return result
            
        except ClientError as e:
            logger.error(f"Failed to move document from {source_path} to {destination_path}: {e}")
            raise
    
    def get_document_metadata(self, document_path: str) -> Dict[str, Any]:
        """
        Extract document metadata.
        
        Args:
            document_path: S3 key of the document
            
        Returns:
            Dictionary with document metadata
        """
        try:
            response = self.s3_client.head_object(Bucket=self.bucket_name, Key=document_path)
            
            metadata = {
                'key': document_path,
                'filename': os.path.basename(document_path),
                'size': response['ContentLength'],
                'content_type': response['ContentType'],
                'last_modified': response['LastModified'].isoformat(),
                'etag': response['ETag'].strip('"'),
                'storage_class': response.get('StorageClass', 'STANDARD'),
                'metadata': response.get('Metadata', {}),
                'folder': os.path.dirname(document_path) + '/' if os.path.dirname(document_path) else ''
            }
            
            logger.info(f"Retrieved metadata for document: {document_path}")
            return metadata
            
        except ClientError as e:
            if e.response['Error']['Code'] == '404':
                logger.warning(f"Document not found: {document_path}")
                return {'error': 'Document not found', 'key': document_path}
            logger.error(f"Failed to get metadata for {document_path}: {e}")
            raise
    
    def create_folder(self, folder_path: str) -> Dict[str, Any]:
        """
        Create new folder structure in S3 that is visible in tree structure.
        
        Args:
            folder_path: Path of the folder to create
            
        Returns:
            Dictionary with creation result
        """
        try:
            logger.info(f"Creating visible folder: {folder_path} in bucket: {self.bucket_name}")
            
            # Use the unified folder creation method that ensures visibility
            result = self._ensure_folder_visible(folder_path)
            
            if result['success']:
                logger.info(f"Successfully created visible folder: {result['folder_path']}")
            else:
                logger.error(f"Failed to create visible folder: {result.get('error', 'Unknown error')}")
                # Convert to exception for backward compatibility
                raise Exception(result.get('error', 'Failed to create folder'))
            
            return result
            
        except Exception as e:
            logger.error(f"Error creating folder {folder_path}: {e}")
            raise
    
    def delete_folder(self, folder_path: str) -> Dict[str, Any]:
        """
        Delete folder and all contents.
        
        Args:
            folder_path: Path of the folder to delete
            
        Returns:
            Dictionary with deletion result
        """
        try:
            # Ensure folder_path ends with /
            if not folder_path.endswith('/'):
                folder_path += '/'
            
            # List all objects in the folder
            objects_to_delete = []
            response = self.s3_client.list_objects_v2(
                Bucket=self.bucket_name,
                Prefix=folder_path
            )
            
            if 'Contents' in response:
                for obj in response['Contents']:
                    objects_to_delete.append({'Key': obj['Key']})
            
            if objects_to_delete:
                # Delete all objects in the folder
                self.s3_client.delete_objects(
                    Bucket=self.bucket_name,
                    Delete={'Objects': objects_to_delete}
                )
            
            result = {
                'success': True,
                'folder_path': folder_path,
                'deleted_objects': len(objects_to_delete),
                'message': f'Folder {folder_path} and {len(objects_to_delete)} objects deleted successfully'
            }
            
            logger.info(f"Successfully deleted folder {folder_path} with {len(objects_to_delete)} objects")
            return result
            
        except ClientError as e:
            logger.error(f"Failed to delete folder {folder_path}: {e}")
            raise
    
    def get_folder_structure(self) -> Dict[str, Any]:
        """
        Return hierarchical folder structure.
        
        Returns:
            Dictionary with folder structure
        """
        try:
            # List all objects in bucket
            response = self.s3_client.list_objects_v2(Bucket=self.bucket_name)
            
            folders = set()
            files = []
            
            if 'Contents' in response:
                for obj in response['Contents']:
                    key = obj['Key']
                    
                    # Extract folder path
                    if '/' in key:
                        folder_parts = key.split('/')[:-1]  # Exclude filename
                        for i in range(len(folder_parts)):
                            folder_path = '/'.join(folder_parts[:i+1]) + '/'
                            folders.add(folder_path)
                    
                    # Add file info
                    if not key.endswith('/'):  # Not a folder marker
                        files.append({
                            'key': key,
                            'filename': os.path.basename(key),
                            'folder': os.path.dirname(key) + '/' if os.path.dirname(key) else '',
                            'size': obj['Size'],
                            'last_modified': obj['LastModified'].isoformat()
                        })
            
            structure = {
                'folders': sorted(list(folders)),
                'files': files,
                'total_folders': len(folders),
                'total_files': len(files)
            }
            
            logger.info(f"Retrieved folder structure: {len(folders)} folders, {len(files)} files")
            return structure
            
        except ClientError as e:
            logger.error(f"Failed to get folder structure: {e}")
            raise
    
    def bulk_upload(self, files_data: List[Dict[str, Any]], folder_path: str = "documents/") -> Dict[str, Any]:
        """
        Upload multiple documents.
        
        Args:
            files_data: List of dictionaries with 'data' and 'filename' keys
            folder_path: Destination folder path
            
        Returns:
            Dictionary with bulk upload results
        """
        results = {
            'successful': [],
            'failed': [],
            'total': len(files_data)
        }
        
        for file_info in files_data:
            try:
                result = self.upload_document(
                    file_info['data'],
                    file_info['filename'],
                    folder_path
                )
                results['successful'].append(result)
            except Exception as e:
                error_result = {
                    'filename': file_info['filename'],
                    'error': str(e)
                }
                results['failed'].append(error_result)
                logger.error(f"Failed to upload {file_info['filename']}: {e}")
        
        logger.info(f"Bulk upload completed: {len(results['successful'])} successful, {len(results['failed'])} failed")
        return results
    
    def bulk_delete(self, document_paths: List[str]) -> Dict[str, Any]:
        """
        Delete multiple documents.
        
        Args:
            document_paths: List of S3 keys to delete
            
        Returns:
            Dictionary with bulk deletion results
        """
        results = {
            'successful': [],
            'failed': [],
            'total': len(document_paths)
        }
        
        for path in document_paths:
            try:
                result = self.delete_document(path)
                if result['success']:
                    results['successful'].append(result)
                else:
                    results['failed'].append(result)
            except Exception as e:
                error_result = {
                    'key': path,
                    'error': str(e)
                }
                results['failed'].append(error_result)
                logger.error(f"Failed to delete {path}: {e}")
        
        logger.info(f"Bulk delete completed: {len(results['successful'])} successful, {len(results['failed'])} failed")
        return results
    
    def bulk_move(self, move_operations: List[Dict[str, str]]) -> Dict[str, Any]:
        """
        Move multiple documents.
        
        Args:
            move_operations: List of dictionaries with 'source' and 'destination' keys
            
        Returns:
            Dictionary with bulk move results
        """
        results = {
            'successful': [],
            'failed': [],
            'total': len(move_operations)
        }
        
        for operation in move_operations:
            try:
                result = self.move_document(
                    operation['source'],
                    operation['destination']
                )
                results['successful'].append(result)
            except Exception as e:
                error_result = {
                    'source': operation['source'],
                    'destination': operation['destination'],
                    'error': str(e)
                }
                results['failed'].append(error_result)
                logger.error(f"Failed to move {operation['source']} to {operation['destination']}: {e}")
        
        logger.info(f"Bulk move completed: {len(results['successful'])} successful, {len(results['failed'])} failed")
        return results
    
    def upload_folder_structure(self, files_data: List[Dict[str, Any]], 
                               preserve_structure: bool = True) -> Dict[str, Any]:
        """
        Upload multiple files preserving folder structure.
        
        Args:
            files_data: List of dictionaries with 'file', 'path', and optional 'folder_path'
            preserve_structure: Whether to preserve the original folder structure
            
        Returns:
            Dictionary with upload results
        """
        results = {
            'successful': [],
            'failed': [],
            'total': len(files_data),
            'total_size': 0
        }
        
        logger.info(f"Starting folder structure upload: {len(files_data)} files")
        
        for file_info in files_data:
            try:
                file_data = file_info['file']
                original_path = file_info.get('path', '')
                base_folder = file_info.get('folder_path', '')
                
                # Debug logging to track folder path handling
                logger.info(f"🔧 DEBUG: Processing file upload - original_path: '{original_path}', received folder_path: '{base_folder}'")
                
                # Handle folder path logic correctly:
                # - If folder_path key is missing entirely, default to 'documents/'
                # - If folder_path is provided but empty string, keep it empty (for root uploads)
                # - If folder_path has a value, use it as-is
                if 'folder_path' not in file_info:
                    base_folder = 'documents/'
                    logger.info(f"🔧 DEBUG: folder_path key missing, defaulting to 'documents/'")
                elif base_folder == '':
                    # Empty string means root upload - keep it empty
                    logger.info(f"🔧 DEBUG: folder_path is empty string, uploading to root")
                else:
                    logger.info(f"🔧 DEBUG: Using provided folder_path: '{base_folder}'")
                
                # Validate file data using common helper
                filename = original_path.split('/')[-1] if '/' in original_path else original_path
                validation = self._validate_file_data(file_data, filename)
                if not validation['valid']:
                    raise ValueError(f"File validation failed: {', '.join(validation['errors'])}")
                
                # Determine final path
                if preserve_structure and original_path:
                    # Use the original folder structure
                    final_path = f"{base_folder}{original_path}"
                else:
                    # Flatten to base folder
                    filename = original_path.split('/')[-1] if '/' in original_path else original_path
                    final_path = f"{base_folder}{filename}"
                
                # Ensure folder path ends with /
                folder_part = '/'.join(final_path.split('/')[:-1]) + '/'
                filename = final_path.split('/')[-1]
                
                # Upload the file
                result = self.upload_document(file_data, filename, folder_part)
                results['successful'].append({
                    'original_path': original_path,
                    'final_path': final_path,
                    'result': result
                })
                results['total_size'] += result.get('size', 0)
                
            except Exception as e:
                error_result = {
                    'original_path': file_info.get('path', 'unknown'),
                    'error': str(e)
                }
                results['failed'].append(error_result)
                logger.error(f"Failed to upload {file_info.get('path', 'unknown')}: {e}")
        
        success_rate = (len(results['successful']) / results['total']) * 100 if results['total'] > 0 else 0
        
        logger.info(f"Folder upload completed: {len(results['successful'])}/{results['total']} files successful ({success_rate:.1f}%)")
        
        return {
            'success': len(results['failed']) == 0,
            'results': results,
            'summary': {
                'total_files': results['total'],
                'successful_files': len(results['successful']),
                'failed_files': len(results['failed']),
                'total_size_bytes': results['total_size'],
                'success_rate': success_rate
            }
        }
    
    def bulk_delete_files(self, file_paths: List[str]) -> Dict[str, Any]:
        """
        Delete multiple files in a single operation.
        
        Args:
            file_paths: List of S3 keys to delete
            
        Returns:
            Dictionary with deletion results
        """
        if not file_paths:
            return {
                'success': True,
                'deleted_count': 0,
                'failed_count': 0,
                'results': []
            }
        
        logger.info(f"Starting bulk delete of {len(file_paths)} files")
        
        # Prepare objects for deletion
        objects_to_delete = [{'Key': path} for path in file_paths]
        
        try:
            # Use S3 batch delete for efficiency
            response = self.s3_client.delete_objects(
                Bucket=self.bucket_name,
                Delete={'Objects': objects_to_delete}
            )
            
            deleted = response.get('Deleted', [])
            errors = response.get('Errors', [])
            
            deleted_keys = [obj['Key'] for obj in deleted]
            failed_keys = [error['Key'] for error in errors]
            
            result = {
                'success': len(errors) == 0,
                'deleted_count': len(deleted),
                'failed_count': len(errors),
                'deleted_files': deleted_keys,
                'failed_files': failed_keys,
                'errors': errors
            }
            
            logger.info(f"Bulk delete completed: {len(deleted)} deleted, {len(errors)} failed")
            return result
            
        except ClientError as e:
            logger.error(f"Bulk delete failed: {e}")
            return {
                'success': False,
                'deleted_count': 0,
                'failed_count': len(file_paths),
                'error': str(e),
                'failed_files': file_paths
            }
    
    def delete_folder_recursive(self, folder_path: str) -> Dict[str, Any]:
        """
        Delete entire folder and all its contents recursively.
        
        Args:
            folder_path: Path of the folder to delete
            
        Returns:
            Dictionary with deletion results
        """
        try:
            # Ensure folder_path ends with /
            if not folder_path.endswith('/'):
                folder_path += '/'
            
            logger.info(f"Starting recursive deletion of folder: {folder_path}")
            
            # Get all objects in the folder
            all_objects = []
            paginator = self.s3_client.get_paginator('list_objects_v2')
            
            for page in paginator.paginate(Bucket=self.bucket_name, Prefix=folder_path):
                if 'Contents' in page:
                    all_objects.extend(page['Contents'])
            
            if not all_objects:
                logger.info(f"Folder {folder_path} is empty or doesn't exist")
                return {
                    'success': True,
                    'folder_path': folder_path,
                    'deleted_count': 0,
                    'message': 'Folder is empty or does not exist'
                }
            
            # Extract file paths
            file_paths = [obj['Key'] for obj in all_objects]
            
            # Use bulk delete for efficiency
            delete_result = self.bulk_delete_files(file_paths)
            
            result = {
                'success': delete_result['success'],
                'folder_path': folder_path,
                'deleted_count': delete_result['deleted_count'],
                'failed_count': delete_result['failed_count'],
                'total_objects': len(all_objects),
                'deleted_files': delete_result.get('deleted_files', []),
                'failed_files': delete_result.get('failed_files', [])
            }
            
            if delete_result['success']:
                logger.info(f"Successfully deleted folder {folder_path} with {len(all_objects)} objects")
            else:
                logger.warning(f"Partial deletion of folder {folder_path}: {delete_result['deleted_count']}/{len(all_objects)} objects deleted")
            
            return result
            
        except ClientError as e:
            logger.error(f"Failed to delete folder {folder_path}: {e}")
            return {
                'success': False,
                'folder_path': folder_path,
                'error': str(e),
                'deleted_count': 0
            }
    
    def get_folder_tree_structure(self) -> Dict[str, Any]:
        """
        Get hierarchical folder structure for tree view.
        
        Returns:
            Dictionary with hierarchical folder structure
        """
        try:
            logger.info("Building folder tree structure")
            
            # Get all objects in bucket
            all_objects = []
            paginator = self.s3_client.get_paginator('list_objects_v2')
            
            for page in paginator.paginate(Bucket=self.bucket_name):
                if 'Contents' in page:
                    all_objects.extend(page['Contents'])
            
            # Build folder structure
            folders = {}
            files = []
            
            for obj in all_objects:
                key = obj['Key']
                
                # Handle folder markers (empty folders)
                if key.endswith('/'):
                    # This is a folder marker - add it to the folder hierarchy
                    folder_path = key  # Already ends with '/'
                    folder_parts = key.rstrip('/').split('/')
                    
                    # Build folder hierarchy for empty folder
                    current_level = folders
                    current_path = ''
                    
                    for folder_part in folder_parts:
                        current_path += folder_part + '/'
                        
                        if folder_part not in current_level:
                            current_level[folder_part] = {
                                'path': current_path,
                                'children': {},
                                'file_count': 0,
                                'total_size': 0
                            }
                        
                        current_level = current_level[folder_part]['children']
                    
                    continue  # Skip to next object
                
                # Extract folder path for files
                path_parts = key.split('/')
                filename = path_parts[-1]
                folder_parts = path_parts[:-1]
                
                # Check if this is a hidden folder marker file
                is_folder_marker = filename == self.FOLDER_MARKER_FILE
                
                # Add file info (exclude hidden folder markers from visible files)
                if not is_folder_marker:
                    file_info = {
                        'key': key,
                        'filename': filename,
                        'size': obj['Size'],
                        'last_modified': obj['LastModified'].isoformat(),
                        'folder_path': '/'.join(folder_parts) + '/' if folder_parts else ''
                    }
                    files.append(file_info)
                
                # Build folder hierarchy (include all files for folder detection)
                current_level = folders
                current_path = ''
                
                for folder_part in folder_parts:
                    current_path += folder_part + '/'
                    
                    if folder_part not in current_level:
                        current_level[folder_part] = {
                            'path': current_path,
                            'children': {},
                            'file_count': 0,
                            'total_size': 0
                        }
                    
                    # Only count non-marker files in statistics
                    if not is_folder_marker:
                        current_level[folder_part]['file_count'] += 1
                        current_level[folder_part]['total_size'] += obj['Size']
                    
                    current_level = current_level[folder_part]['children']
            
            # Convert to tree format
            def build_tree(folder_dict, parent_path=''):
                tree = []
                for name, data in folder_dict.items():
                    node = {
                        'name': name,
                        'path': data['path'],
                        'type': 'folder',
                        'file_count': data['file_count'],
                        'total_size': data['total_size'],
                        'children': build_tree(data['children'], data['path'])
                    }
                    tree.append(node)
                return sorted(tree, key=lambda x: x['name'])
            
            tree = build_tree(folders)
            
            # Add root level files if any
            root_files = [f for f in files if f['folder_path'] == '']
            
            result = {
                'tree': tree,
                'files': files,
                'root_files': root_files,
                'statistics': {
                    'total_folders': len([f for f in files if f['folder_path']]),
                    'total_files': len(files),
                    'total_size': sum(f['size'] for f in files)
                }
            }
            
            logger.info(f"Folder tree built: {result['statistics']['total_folders']} folders, {result['statistics']['total_files']} files")
            return result
            
        except ClientError as e:
            logger.error(f"Failed to build folder tree: {e}")
            return {
                'tree': [],
                'files': [],
                'root_files': [],
                'error': str(e),
                'statistics': {
                    'total_folders': 0,
                    'total_files': 0,
                    'total_size': 0
                }
            }
    
    def list_folder_contents(self, folder_path: str = "") -> Dict[str, Any]:
        """
        List immediate contents of a folder (files and subfolders) for navigation.
        
        Args:
            folder_path: Path to list contents from (default: root)
            
        Returns:
            Dictionary with files and folders lists
        """
        try:
            # Normalize folder path
            if folder_path and not folder_path.endswith('/'):
                folder_path += '/'
            
            logger.info(f"Listing folder contents for: '{folder_path}'")
            
            # Get all objects with the folder prefix
            response = self.s3_client.list_objects_v2(
                Bucket=self.bucket_name,
                Prefix=folder_path,
                Delimiter='/'  # This helps us get immediate children only
            )
            
            files = []
            folders = []
            
            # Process files (Contents)
            if 'Contents' in response:
                for obj in response['Contents']:
                    key = obj['Key']
                    filename = os.path.basename(key)
                    
                    # Skip folder markers and hidden folder marker files
                    if not key.endswith('/') and filename != self.FOLDER_MARKER_FILE:
                        # Only include files that are immediate children
                        relative_path = key[len(folder_path):] if folder_path else key
                        if '/' not in relative_path:  # Immediate child file
                            file_info = {
                                'key': key,
                                'filename': filename,
                                'size': obj['Size'],
                                'last_modified': obj['LastModified'].isoformat(),
                                'etag': obj['ETag'].strip('"'),
                                'type': 'file'
                            }
                            files.append(file_info)
            
            # Process folders (CommonPrefixes)
            if 'CommonPrefixes' in response:
                for prefix_info in response['CommonPrefixes']:
                    folder_prefix = prefix_info['Prefix']
                    folder_name = folder_prefix.rstrip('/').split('/')[-1]
                    
                    folder_info = {
                        'path': folder_prefix,
                        'name': folder_name,
                        'type': 'folder'
                    }
                    folders.append(folder_info)
            
            result = {
                'success': True,
                'folder_path': folder_path,
                'files': files,
                'folders': folders,
                'total_files': len(files),
                'total_folders': len(folders)
            }
            
            logger.info(f"Listed folder contents: {len(files)} files, {len(folders)} folders in '{folder_path}'")
            return result
            
        except ClientError as e:
            logger.error(f"Failed to list folder contents for {folder_path}: {e}")
            return {
                'success': False,
                'folder_path': folder_path,
                'files': [],
                'folders': [],
                'error': str(e)
            }

    def validate_file_size(self, file_size: int, max_size_mb: int = 50) -> bool:
        """
        Validate file size against maximum limit.

        Args:
            file_size: File size in bytes
            max_size_mb: Maximum allowed size in MB (default: 50MB)

        Returns:
            True if file size is valid, False otherwise
        """
        max_size_bytes = max_size_mb * 1024 * 1024
        is_valid = file_size <= max_size_bytes

        if not is_valid:
            size_mb = file_size / (1024 * 1024)
            logger.warning(f"File size validation failed: {size_mb:.1f}MB exceeds {max_size_mb}MB limit")

        return is_valid

    def generate_presigned_url(self, document_path: str, expiration: int = 3600) -> Dict[str, Any]:
        """
        Generate a presigned URL for downloading a file.

        Args:
            document_path: S3 key of the document
            expiration: URL expiration time in seconds (default: 1 hour)

        Returns:
            Dictionary with presigned URL or error
        """
        try:
            # Check if document exists first
            try:
                self.s3_client.head_object(Bucket=self.bucket_name, Key=document_path)
            except ClientError as e:
                if e.response['Error']['Code'] == '404':
                    logger.warning(f"Document not found for download: {document_path}")
                    return {
                        'success': False,
                        'error': 'Document not found',
                        'key': document_path
                    }
                raise

            # Generate presigned URL
            url = self.s3_client.generate_presigned_url(
                'get_object',
                Params={
                    'Bucket': self.bucket_name,
                    'Key': document_path
                },
                ExpiresIn=expiration
            )

            result = {
                'success': True,
                'url': url,
                'key': document_path,
                'filename': os.path.basename(document_path),
                'expires_in': expiration
            }

            logger.info(f"Generated presigned URL for: {document_path}")
            return result

        except ClientError as e:
            logger.error(f"Failed to generate presigned URL for {document_path}: {e}")
            return {
                'success': False,
                'error': str(e),
                'key': document_path
            }


# Legacy functions for backward compatibility with original flask-drive
def upload_file(file_name: str, bucket: str) -> Any:
    """Legacy function for backward compatibility."""
    service = S3DocumentService(bucket)
    return service.upload_document(file_name, os.path.basename(file_name))


def download_file(file_name: str, bucket: str) -> str:
    """Legacy function for backward compatibility."""
    s3 = boto3.resource('s3')
    output = f"downloads/{file_name}"
    s3.Bucket(bucket).download_file(file_name, output)
    return output


def list_files(bucket: str) -> List[Dict[str, Any]]:
    """Legacy function for backward compatibility."""
    service = S3DocumentService(bucket)
    return service.list_documents()
