# Agar S3 Manager

A minimal, standalone S3 document management application.

## Components

- **API Server** (Flask): S3 document operations API
- **Frontend** (Nginx): Web interface for document management

## Quick Start

1. Copy `.env.example` to `.env` and configure:
   ```bash
   cp .env.example .env
   ```

2. Set your AWS credentials in `.env`:
   ```
   AWS_S3_ACCESS_KEY_ID=your_key
   AWS_S3_SECRET_ACCESS_KEY=your_secret
   S3_BUCKET_NAME=your_bucket
   ```

3. Run with Docker Compose:
   ```bash
   docker-compose up -d
   ```

4. Access the application at http://localhost:8080

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health/` | GET | Health check |
| `/api/s3/documents` | GET | List documents |
| `/api/s3/documents` | POST | Upload document |
| `/api/s3/documents/<path>` | DELETE | Delete document |
| `/api/s3/folders` | GET | Get folder structure |
| `/api/s3/folders` | POST | Create folder |
| `/api/s3/structure/tree` | GET | Get folder tree |
| `/api/s3/folder/contents` | GET | Get folder contents |

## Development

### API Server
```bash
cd api
pip install -r requirements.txt
python app.py
```

### Frontend
```bash
cd frontend
# Serve with any static server
python -m http.server 8080
```

## License

Proprietary - Ask Agar
