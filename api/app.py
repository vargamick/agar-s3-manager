"""
Ask Agar Processor API Server
Flask API for S3 document management and data processing pipeline.
"""

import os
from flask import Flask, jsonify
from flask_cors import CORS
from loguru import logger

from config import Config, setup_logging
from routes.health import health_bp
from routes.s3_management import s3_bp
from routes.processing import processing_bp

# Initialize logging at module level for Gunicorn
os.makedirs('logs', exist_ok=True)
setup_logging()


def create_app():
    """Create and configure Flask application."""
    app = Flask(__name__)

    # Configure CORS
    CORS(app, origins="*")

    # Register blueprints
    app.register_blueprint(health_bp, url_prefix='/api/health')
    app.register_blueprint(s3_bp, url_prefix='/api/s3')
    app.register_blueprint(processing_bp, url_prefix='/api/processing')

    # Root endpoint
    @app.route('/')
    def root():
        """Root endpoint with API information."""
        return jsonify({
            'service': 'Ask Agar Processor API',
            'version': '2.0.0',
            'endpoints': {
                'health': '/api/health/',
                's3_documents': '/api/s3/documents',
                's3_folders': '/api/s3/folders',
                's3_tree': '/api/s3/structure/tree',
                'processing': '/api/processing/'
            }
        })

    # Error handlers
    @app.errorhandler(404)
    def not_found(error):
        return jsonify({'success': False, 'error': 'Endpoint not found'}), 404

    @app.errorhandler(500)
    def internal_error(error):
        logger.error(f"Internal server error: {error}")
        return jsonify({'success': False, 'error': 'Internal server error'}), 500

    logger.info("Flask application created successfully")
    return app


def main():
    """Main entry point."""
    os.makedirs('logs', exist_ok=True)
    app = create_app()

    logger.info(f"Starting Ask Agar Processor API on port {Config.API_PORT}")
    logger.info(f"S3 Bucket: {Config.S3_BUCKET_NAME}")
    logger.info(f"AWS Region: {Config.AWS_REGION}")

    app.run(host='0.0.0.0', port=Config.API_PORT, debug=Config.DEBUG)


if __name__ == '__main__':
    main()
