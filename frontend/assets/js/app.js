/**
 * Agar S3 Document Manager
 * Standalone application for S3 document management
 * Version: 1.0.0
 */

// ============================================
// Configuration
// ============================================

// API Base URL - use relative path since nginx proxies /api/ to backend
const API_BASE = '';

// ============================================
// Global State
// ============================================

let currentFolderPath = '';
let selectedFiles = new Set();
let allFiles = [];
let filteredFiles = [];
let currentPage = 1;
const filesPerPage = 20;
let totalPages = 1;
let folderTreeData = [];
let moveDestinationPath = null;

// ============================================
// Initialization
// ============================================

document.addEventListener('DOMContentLoaded', async function() {
    console.log('Agar S3 Document Manager initialized');
    console.log('API Base URL:', API_BASE);

    // Check API connection
    await checkApiConnection();

    // Load folder tree
    await loadFolderTree();

    // Setup event listeners
    setupEventListeners();
});

function setupEventListeners() {
    // File upload input
    const fileUploadInput = document.getElementById('fileUploadInput');
    if (fileUploadInput) {
        fileUploadInput.addEventListener('change', handleFileUpload);
    }

    // Folder upload input
    const folderUploadInput = document.getElementById('folderUploadInput');
    if (folderUploadInput) {
        folderUploadInput.addEventListener('change', handleFolderUpload);
    }

    // Search input - debounced
    const fileSearch = document.getElementById('fileSearch');
    if (fileSearch) {
        let searchTimeout;
        fileSearch.addEventListener('keyup', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(filterFiles, 300);
        });
    }
}

// ============================================
// API Connection
// ============================================

async function checkApiConnection() {
    const statusElement = document.getElementById('connectionStatus');

    try {
        const response = await fetch(`${API_BASE}/health`, {
            credentials: 'include',
            cache: 'no-cache'
        });

        if (response.ok) {
            statusElement.innerHTML = '<i class="fas fa-circle"></i> Connected';
            statusElement.classList.add('connected');
            statusElement.classList.remove('disconnected');
            console.log('API connection successful');
        } else {
            throw new Error('API not healthy');
        }
    } catch (error) {
        statusElement.innerHTML = '<i class="fas fa-circle"></i> Disconnected';
        statusElement.classList.add('disconnected');
        statusElement.classList.remove('connected');
        console.error('API connection failed:', error);
        showStatus('Unable to connect to API server', 'error');
    }
}

// ============================================
// Folder Tree Management
// ============================================

async function loadFolderTree() {
    const folderTree = document.getElementById('folderTree');

    try {
        folderTree.innerHTML = '<div class="status-info"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';

        const response = await fetch(`${API_BASE}/api/s3/structure/tree?_cb=${Date.now()}`, {
            credentials: 'include',
            cache: 'no-cache'
        });

        const result = await response.json();

        if (response.ok) {
            folderTreeData = result.tree_structure?.tree || [];
            renderFolderTree(folderTreeData);
            console.log('Folder tree loaded successfully');
        } else {
            throw new Error(result.error || 'Failed to load folder tree');
        }
    } catch (error) {
        console.error('Failed to load folder tree:', error);
        folderTree.innerHTML = `<div class="status-info">Error: ${error.message}</div>`;
    }
}

window.refreshFolderTree = async function() {
    await loadFolderTree();
    showStatus('Folder tree refreshed', 'success');
};

function renderFolderTree(tree, parentElement = null, level = 0) {
    const container = parentElement || document.getElementById('folderTree');

    if (level === 0) {
        container.innerHTML = '';

        // Add root folder
        const rootItem = createFolderItem('Root', '', 0, true);
        container.appendChild(rootItem);
    }

    tree.forEach(item => {
        if (item.type === 'folder') {
            const folderItem = createFolderItem(item.name, item.path, level + 1, false);
            container.appendChild(folderItem);

            // Render children
            if (item.children && item.children.length > 0) {
                renderFolderTree(item.children, container, level + 1);
            }
        }
    });
}

function createFolderItem(name, path, level, isRoot) {
    const div = document.createElement('div');
    div.className = 'folder-item';
    div.style.paddingLeft = `${level * 15 + 8}px`;
    div.innerHTML = `<i class="fas fa-folder"></i> ${name}`;
    div.dataset.path = path;

    if (path === currentFolderPath || (isRoot && currentFolderPath === '')) {
        div.classList.add('selected');
    }

    div.onclick = () => selectFolder(path, div);

    return div;
}

function selectFolder(path, element) {
    // Update selection
    document.querySelectorAll('.folder-item').forEach(item => {
        item.classList.remove('selected');
    });
    element.classList.add('selected');

    currentFolderPath = path;

    // Update breadcrumbs
    updateBreadcrumbs(path);

    // Load files
    loadFilesInFolder(path);

    console.log('Selected folder:', path || 'Root');
}

window.navigateToFolder = function(path) {
    const folderItems = document.querySelectorAll('.folder-item');
    folderItems.forEach(item => {
        if (item.dataset.path === path) {
            selectFolder(path, item);
        }
    });
};

function updateBreadcrumbs(path) {
    const breadcrumbNav = document.getElementById('breadcrumbNav');

    let html = `<span class="breadcrumb-item" onclick="navigateToFolder('')"><i class="fas fa-home"></i> Root</span>`;

    if (path) {
        const parts = path.split('/').filter(p => p);
        let currentPath = '';

        parts.forEach((part, index) => {
            currentPath += part + '/';
            html += `<span class="breadcrumb-separator"><i class="fas fa-chevron-right"></i></span>`;
            html += `<span class="breadcrumb-item" onclick="navigateToFolder('${currentPath}')">${part}</span>`;
        });
    }

    breadcrumbNav.innerHTML = html;
}

// ============================================
// File Management
// ============================================

async function loadFilesInFolder(folderPath) {
    const fileListContainer = document.getElementById('fileListContainer');

    try {
        fileListContainer.innerHTML = '<div class="status-info"><i class="fas fa-spinner fa-spin"></i> Loading files...</div>';

        const response = await fetch(`${API_BASE}/api/s3/folder/contents?folder_path=${encodeURIComponent(folderPath)}`, {
            credentials: 'include'
        });

        const result = await response.json();

        if (response.ok && result.success) {
            const files = result.files || [];
            const folders = result.folders || [];

            // Combine folders and files
            allFiles = [
                ...folders.map(folder => ({
                    key: folder.path,
                    filename: folder.name,
                    size: 0,
                    type: 'folder',
                    last_modified: ''
                })),
                ...files.map(file => ({
                    ...file,
                    type: 'file'
                }))
            ];

            filteredFiles = [...allFiles];
            currentPage = 1;
            selectedFiles.clear();

            renderFileList();
            updateFileCount();
            updateSelectionCount();

            console.log(`Loaded ${files.length} files and ${folders.length} folders`);
        } else {
            throw new Error(result.error || 'Failed to load files');
        }
    } catch (error) {
        console.error('Failed to load files:', error);
        fileListContainer.innerHTML = `<div class="status-info">Error: ${error.message}</div>`;
    }
}

function renderFileList() {
    const container = document.getElementById('fileListContainer');

    if (filteredFiles.length === 0) {
        container.innerHTML = '<div class="status-info">No files found in this folder</div>';
        document.getElementById('paginationControls').style.display = 'none';
        return;
    }

    // Pagination
    totalPages = Math.ceil(filteredFiles.length / filesPerPage);
    const startIndex = (currentPage - 1) * filesPerPage;
    const endIndex = startIndex + filesPerPage;
    const pageFiles = filteredFiles.slice(startIndex, endIndex);

    let html = '';

    pageFiles.forEach(file => {
        const isSelected = selectedFiles.has(file.key);
        const isFolder = file.type === 'folder';
        const icon = isFolder ? 'folder' : getFileIcon(file.filename);
        const iconClass = isFolder ? 'folder' : '';

        html += `
            <div class="file-list-item ${isSelected ? 'selected' : ''}"
                 onclick="${isFolder ? `navigateToFolder('${file.key}')` : `toggleFileSelection('${file.key}')`}">
                ${!isFolder ? `<input type="checkbox" class="file-checkbox" ${isSelected ? 'checked' : ''}
                     onclick="event.stopPropagation(); toggleFileSelection('${file.key}')">` : ''}
                <i class="fas fa-${icon} file-icon ${iconClass}"></i>
                <div class="file-details">
                    <span class="file-name">${file.filename}</span>
                    <span class="file-meta">
                        ${isFolder ? 'Folder' : formatFileSize(file.size)}
                        ${file.last_modified ? ` | ${formatDate(file.last_modified)}` : ''}
                    </span>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;

    // Update pagination
    updatePaginationControls();
}

function getFileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const iconMap = {
        'pdf': 'file-pdf',
        'doc': 'file-word',
        'docx': 'file-word',
        'xls': 'file-excel',
        'xlsx': 'file-excel',
        'ppt': 'file-powerpoint',
        'pptx': 'file-powerpoint',
        'jpg': 'file-image',
        'jpeg': 'file-image',
        'png': 'file-image',
        'gif': 'file-image',
        'svg': 'file-image',
        'zip': 'file-archive',
        'rar': 'file-archive',
        'txt': 'file-alt',
        'md': 'file-alt',
        'json': 'file-code',
        'js': 'file-code',
        'css': 'file-code',
        'html': 'file-code'
    };
    return iconMap[ext] || 'file';
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString();
}

function updateFileCount() {
    const fileCount = document.getElementById('fileCount');
    const fileOnlyCount = filteredFiles.filter(f => f.type === 'file').length;
    const folderOnlyCount = filteredFiles.filter(f => f.type === 'folder').length;
    fileCount.textContent = `${fileOnlyCount} files, ${folderOnlyCount} folders`;
}

function updateSelectionCount() {
    const selectionCount = document.getElementById('selectionCount');
    selectionCount.textContent = `${selectedFiles.size} selected`;
}

function updatePaginationControls() {
    const paginationControls = document.getElementById('paginationControls');
    const pageInfo = document.getElementById('pageInfo');
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');

    if (totalPages <= 1) {
        paginationControls.style.display = 'none';
        return;
    }

    paginationControls.style.display = 'flex';
    pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
    prevBtn.disabled = currentPage === 1;
    nextBtn.disabled = currentPage === totalPages;
}

window.previousPage = function() {
    if (currentPage > 1) {
        currentPage--;
        renderFileList();
    }
};

window.nextPage = function() {
    if (currentPage < totalPages) {
        currentPage++;
        renderFileList();
    }
};

window.toggleFileSelection = function(filePath) {
    if (selectedFiles.has(filePath)) {
        selectedFiles.delete(filePath);
    } else {
        selectedFiles.add(filePath);
    }
    renderFileList();
    updateSelectionCount();
    updateSelectAllCheckbox();
};

window.toggleSelectAll = function() {
    const selectAllCheckbox = document.getElementById('selectAll');
    const selectableFiles = filteredFiles.filter(f => f.type === 'file');

    if (selectAllCheckbox.checked) {
        selectableFiles.forEach(file => selectedFiles.add(file.key));
    } else {
        selectedFiles.clear();
    }

    renderFileList();
    updateSelectionCount();
};

function updateSelectAllCheckbox() {
    const selectAllCheckbox = document.getElementById('selectAll');
    const selectableFiles = filteredFiles.filter(f => f.type === 'file');
    selectAllCheckbox.checked = selectableFiles.length > 0 &&
        selectableFiles.every(file => selectedFiles.has(file.key));
}

window.filterFiles = function() {
    const searchTerm = document.getElementById('fileSearch').value.toLowerCase();

    if (!searchTerm) {
        filteredFiles = [...allFiles];
    } else {
        filteredFiles = allFiles.filter(file =>
            file.filename.toLowerCase().includes(searchTerm)
        );
    }

    currentPage = 1;
    renderFileList();
    updateFileCount();
};

// ============================================
// File Upload
// ============================================

async function handleFileUpload(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    showStatus(`Uploading ${files.length} file(s)...`, 'info');
    showUploadProgress();

    try {
        let uploadedCount = 0;

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const formData = new FormData();
            formData.append('file', file);
            formData.append('folder_path', currentFolderPath);

            updateUploadProgress((i / files.length) * 100, file.name);

            const response = await fetch(`${API_BASE}/api/s3/documents`, {
                method: 'POST',
                body: formData,
                credentials: 'include'
            });

            if (response.ok) {
                uploadedCount++;
                console.log(`Uploaded: ${file.name}`);
            } else {
                const result = await response.json();
                console.error(`Failed to upload ${file.name}:`, result.error);
            }
        }

        updateUploadProgress(100, 'Complete');
        showStatus(`Successfully uploaded ${uploadedCount} file(s)`, 'success');

        // Refresh file list
        await loadFilesInFolder(currentFolderPath);

    } catch (error) {
        console.error('Upload failed:', error);
        showStatus(`Upload failed: ${error.message}`, 'error');
    } finally {
        event.target.value = '';
        setTimeout(hideUploadProgress, 2000);
    }
}

async function handleFolderUpload(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    showStatus(`Uploading folder with ${files.length} file(s)...`, 'info');
    showUploadProgress();

    try {
        const formData = new FormData();

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            formData.append('files', file);
            formData.append('paths', file.webkitRelativePath);
        }

        formData.append('folder_path', currentFolderPath);

        const response = await fetch(`${API_BASE}/api/s3/upload/folder`, {
            method: 'POST',
            body: formData,
            credentials: 'include'
        });

        const result = await response.json();

        if (response.ok) {
            updateUploadProgress(100, 'Complete');
            showStatus(`Folder uploaded successfully (${result.uploaded_count} files)`, 'success');

            // Refresh views
            await loadFolderTree();
            await loadFilesInFolder(currentFolderPath);
        } else {
            throw new Error(result.error || 'Upload failed');
        }
    } catch (error) {
        console.error('Folder upload failed:', error);
        showStatus(`Folder upload failed: ${error.message}`, 'error');
    } finally {
        event.target.value = '';
        setTimeout(hideUploadProgress, 2000);
    }
}

function showUploadProgress() {
    const progressElement = document.getElementById('uploadProgress');
    progressElement.style.display = 'block';
}

function hideUploadProgress() {
    const progressElement = document.getElementById('uploadProgress');
    progressElement.style.display = 'none';
    document.getElementById('uploadProgressFill').style.width = '0%';
}

function updateUploadProgress(percent, fileName = '') {
    document.getElementById('uploadProgressFill').style.width = `${percent}%`;
    document.getElementById('uploadProgressText').textContent = `${Math.round(percent)}%`;
    if (fileName) {
        document.getElementById('uploadFileName').textContent = fileName;
    }
}

// ============================================
// File Actions
// ============================================

window.downloadSelectedFiles = async function() {
    if (selectedFiles.size === 0) {
        showStatus('Please select files to download', 'warning');
        return;
    }

    for (const fileKey of selectedFiles) {
        try {
            const response = await fetch(`${API_BASE}/api/s3/download?key=${encodeURIComponent(fileKey)}`, {
                credentials: 'include'
            });

            if (response.ok) {
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = fileKey.split('/').pop();
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
            }
        } catch (error) {
            console.error(`Failed to download ${fileKey}:`, error);
        }
    }

    showStatus(`Downloaded ${selectedFiles.size} file(s)`, 'success');
};

window.deleteSelectedFiles = async function() {
    if (selectedFiles.size === 0) {
        showStatus('Please select files to delete', 'warning');
        return;
    }

    if (!confirm(`Are you sure you want to delete ${selectedFiles.size} file(s)?`)) {
        return;
    }

    let deletedCount = 0;

    for (const fileKey of selectedFiles) {
        try {
            const response = await fetch(`${API_BASE}/api/s3/documents/${encodeURIComponent(fileKey)}`, {
                method: 'DELETE',
                credentials: 'include'
            });

            if (response.ok) {
                deletedCount++;
            }
        } catch (error) {
            console.error(`Failed to delete ${fileKey}:`, error);
        }
    }

    showStatus(`Deleted ${deletedCount} file(s)`, 'success');
    selectedFiles.clear();
    await loadFilesInFolder(currentFolderPath);
};

// ============================================
// Folder Actions
// ============================================

window.createFolderPrompt = function() {
    document.getElementById('createFolderPath').textContent = currentFolderPath || '/';
    document.getElementById('newFolderName').value = '';
    document.getElementById('createFolderModal').style.display = 'flex';
};

window.closeCreateFolderModal = function() {
    document.getElementById('createFolderModal').style.display = 'none';
};

window.confirmCreateFolder = async function() {
    const folderName = document.getElementById('newFolderName').value.trim();

    if (!folderName) {
        showStatus('Please enter a folder name', 'error');
        return;
    }

    const folderPath = currentFolderPath + folderName + '/';

    try {
        const response = await fetch(`${API_BASE}/api/s3/folders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folder_path: folderPath }),
            credentials: 'include'
        });

        if (response.ok) {
            showStatus(`Folder "${folderName}" created successfully`, 'success');
            closeCreateFolderModal();
            await loadFolderTree();
            await loadFilesInFolder(currentFolderPath);
        } else {
            const result = await response.json();
            throw new Error(result.error || 'Failed to create folder');
        }
    } catch (error) {
        showStatus(`Failed to create folder: ${error.message}`, 'error');
    }
};

window.deleteCurrentFolder = async function() {
    if (!currentFolderPath) {
        showStatus('Cannot delete root folder', 'error');
        return;
    }

    if (!confirm(`Are you sure you want to delete the folder "${currentFolderPath}" and all its contents?`)) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/api/s3/folders/${encodeURIComponent(currentFolderPath)}`, {
            method: 'DELETE',
            credentials: 'include'
        });

        if (response.ok) {
            showStatus('Folder deleted successfully', 'success');
            currentFolderPath = '';
            await loadFolderTree();
            await loadFilesInFolder('');
        } else {
            const result = await response.json();
            throw new Error(result.error || 'Failed to delete folder');
        }
    } catch (error) {
        showStatus(`Failed to delete folder: ${error.message}`, 'error');
    }
};

// ============================================
// Move Files
// ============================================

window.moveSelectedFiles = function() {
    if (selectedFiles.size === 0) {
        showStatus('Please select files to move', 'warning');
        return;
    }

    document.getElementById('moveFileCount').textContent = selectedFiles.size;
    moveDestinationPath = null;
    document.getElementById('moveBtn').disabled = true;
    document.getElementById('selectedDestination').style.display = 'none';

    // Render folder tree in modal
    renderMoveFolderTree();

    document.getElementById('moveFilesModal').style.display = 'flex';
};

window.closeMoveModal = function() {
    document.getElementById('moveFilesModal').style.display = 'none';
};

function renderMoveFolderTree() {
    const container = document.getElementById('moveFolderTree');
    container.innerHTML = '';

    // Add root
    const rootItem = document.createElement('div');
    rootItem.className = 'move-folder-item';
    rootItem.innerHTML = '<i class="fas fa-folder"></i> Root (/)';
    rootItem.onclick = () => selectMoveDestination('', rootItem);
    container.appendChild(rootItem);

    // Add all folders
    function addFolders(tree, level = 0) {
        tree.forEach(item => {
            if (item.type === 'folder') {
                const folderItem = document.createElement('div');
                folderItem.className = 'move-folder-item';
                folderItem.style.paddingLeft = `${(level + 1) * 15}px`;
                folderItem.innerHTML = `<i class="fas fa-folder"></i> ${item.name}`;
                folderItem.onclick = () => selectMoveDestination(item.path, folderItem);
                container.appendChild(folderItem);

                if (item.children && item.children.length > 0) {
                    addFolders(item.children, level + 1);
                }
            }
        });
    }

    addFolders(folderTreeData);
}

function selectMoveDestination(path, element) {
    document.querySelectorAll('.move-folder-item').forEach(item => {
        item.classList.remove('selected');
    });
    element.classList.add('selected');

    moveDestinationPath = path;
    document.getElementById('destinationPath').textContent = path || 'Root (/)';
    document.getElementById('selectedDestination').style.display = 'block';
    document.getElementById('moveBtn').disabled = false;
}

window.createFolderForMove = async function() {
    const folderName = document.getElementById('newMoveFolder').value.trim();

    if (!folderName) {
        showStatus('Please enter a folder name', 'error');
        return;
    }

    const folderPath = folderName + '/';

    try {
        const response = await fetch(`${API_BASE}/api/s3/folders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folder_path: folderPath }),
            credentials: 'include'
        });

        if (response.ok) {
            document.getElementById('newMoveFolder').value = '';
            await loadFolderTree();
            renderMoveFolderTree();
            showStatus(`Folder "${folderName}" created`, 'success');
        }
    } catch (error) {
        showStatus(`Failed to create folder: ${error.message}`, 'error');
    }
};

window.confirmMoveFiles = async function() {
    if (moveDestinationPath === null) {
        showStatus('Please select a destination folder', 'error');
        return;
    }

    document.getElementById('moveProcessingStatus').style.display = 'flex';
    document.getElementById('moveBtn').disabled = true;

    let movedCount = 0;

    for (const fileKey of selectedFiles) {
        const fileName = fileKey.split('/').pop();
        const newKey = moveDestinationPath + fileName;

        try {
            const response = await fetch(`${API_BASE}/api/s3/move`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    source_key: fileKey,
                    destination_key: newKey
                }),
                credentials: 'include'
            });

            if (response.ok) {
                movedCount++;
            }
        } catch (error) {
            console.error(`Failed to move ${fileKey}:`, error);
        }
    }

    document.getElementById('moveProcessingStatus').style.display = 'none';
    closeMoveModal();

    showStatus(`Moved ${movedCount} file(s) successfully`, 'success');
    selectedFiles.clear();
    await loadFilesInFolder(currentFolderPath);
};

// ============================================
// Status Messages
// ============================================

function showStatus(message, type = 'info') {
    const statusElement = document.getElementById('statusMessage');
    statusElement.textContent = message;
    statusElement.className = `status-indicator status-${type}`;
    statusElement.style.display = 'block';

    // Auto-hide after 5 seconds
    if (type === 'success' || type === 'info') {
        setTimeout(() => {
            statusElement.style.display = 'none';
        }, 5000);
    }
}

// ============================================
// Tab Navigation
// ============================================

window.switchTab = function(tabName) {
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === tabName + 'Tab');
    });

    // Initialize admin tab if switching to it
    if (tabName === 'admin') {
        initializeAdminTab();
    }
};

// ============================================
// Admin State
// ============================================

let adminState = {
    currentJobId: null,
    selectedScrapeRun: null,
    pollingInterval: null
};

// ============================================
// Admin Tab Initialization
// ============================================

async function initializeAdminTab() {
    await refreshAdminStatus();
    await loadScrapeRuns();
    await loadResetPreview();
    await checkCurrentJob();
}

async function refreshAdminStatus() {
    const statusElement = document.getElementById('adminApiStatus');

    try {
        // Check admin health
        const response = await fetch(`${API_BASE}/api/admin/health`, {
            credentials: 'include'
        });

        const result = await response.json();

        if (response.ok && result.success) {
            statusElement.innerHTML = '<i class="fas fa-circle"></i> API Connected';
            statusElement.className = 'api-status connected';

            // Update individual service statuses
            updateServiceStatus('neo4jStatus', result.neo4j);
            updateServiceStatus('postgresStatus', result.postgres);
            updateServiceStatus('s3Status', result.s3);

            // Load stats
            await loadAdminStats();
        } else {
            statusElement.innerHTML = '<i class="fas fa-circle"></i> API Error';
            statusElement.className = 'api-status disconnected';
        }
    } catch (error) {
        statusElement.innerHTML = '<i class="fas fa-circle"></i> API Unavailable';
        statusElement.className = 'api-status disconnected';
        console.error('Failed to check admin API:', error);
    }
}

function updateServiceStatus(elementId, status) {
    const element = document.getElementById(elementId);
    if (!element) return;

    if (status === 'connected' || status === true || status === 'healthy') {
        element.textContent = 'Connected';
        element.className = 'status-value connected';
    } else if (status === 'disconnected' || status === false || status === 'unhealthy') {
        element.textContent = 'Disconnected';
        element.className = 'status-value disconnected';
    } else {
        element.textContent = status || '--';
        element.className = 'status-value';
    }
}

async function loadAdminStats() {
    try {
        const response = await fetch(`${API_BASE}/api/admin/stats`, {
            credentials: 'include'
        });

        const result = await response.json();

        if (response.ok && result.success) {
            document.getElementById('statEntities').textContent = formatNumber(result.entities || 0);
            document.getElementById('statRelationships').textContent = formatNumber(result.relationships || 0);
            document.getElementById('statEmbeddings').textContent = formatNumber(result.embeddings || 0);
            document.getElementById('statLabels').textContent = formatNumber(result.labels || 0);
        }
    } catch (error) {
        console.error('Failed to load admin stats:', error);
    }
}

function formatNumber(num) {
    if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
}

// ============================================
// Scrape Runs Management
// ============================================

async function loadScrapeRuns() {
    const container = document.getElementById('scrapeRunsList');
    container.innerHTML = '<div class="status-info"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';

    try {
        const response = await fetch(`${API_BASE}/api/admin/s3/scrape-runs`, {
            credentials: 'include'
        });

        const result = await response.json();

        if (response.ok && result.success && result.runs && result.runs.length > 0) {
            renderScrapeRuns(result.runs);
        } else {
            container.innerHTML = '<div class="status-info">No scrape runs found</div>';
        }
    } catch (error) {
        console.error('Failed to load scrape runs:', error);
        container.innerHTML = '<div class="status-info">Error loading scrape runs</div>';
    }
}

function renderScrapeRuns(runs) {
    const container = document.getElementById('scrapeRunsList');
    container.innerHTML = '';

    runs.forEach(run => {
        const div = document.createElement('div');
        div.className = 'scrape-run-card';
        if (adminState.selectedScrapeRun === run.path) {
            div.classList.add('selected');
        }

        const runDate = run.date ? new Date(run.date).toLocaleDateString() : 'Unknown';
        const runType = run.type || 'FULL';
        const productCount = run.productCount || 0;

        div.innerHTML = `
            <div class="scrape-run-info">
                <span class="scrape-run-type ${runType.toLowerCase()}">${runType}</span>
                <span class="scrape-run-name">${run.name || run.path}</span>
                <span class="scrape-run-meta">${runDate} | ${productCount} products</span>
            </div>
            <button class="btn btn-small ${adminState.selectedScrapeRun === run.path ? 'btn-success' : 'btn-secondary'}"
                    onclick="selectScrapeRun('${run.path}', this)">
                ${adminState.selectedScrapeRun === run.path ? '<i class="fas fa-check"></i> Selected' : 'Select'}
            </button>
        `;

        container.appendChild(div);
    });
}

window.selectScrapeRun = function(path, buttonElement) {
    adminState.selectedScrapeRun = path;

    // Update all scrape run cards
    document.querySelectorAll('.scrape-run-card').forEach(card => {
        card.classList.remove('selected');
        const btn = card.querySelector('button');
        if (btn) {
            btn.className = 'btn btn-small btn-secondary';
            btn.innerHTML = 'Select';
        }
    });

    // Update the clicked card
    const card = buttonElement.closest('.scrape-run-card');
    if (card) {
        card.classList.add('selected');
        buttonElement.className = 'btn btn-small btn-success';
        buttonElement.innerHTML = '<i class="fas fa-check"></i> Selected';
    }

    // Update refresh description
    const descEl = document.getElementById('refreshDescription');
    descEl.textContent = `Will refresh from: ${path}`;

    showAdminStatus(`Selected scrape run: ${path}`, 'success');
};

// ============================================
// Refresh from S3
// ============================================

window.startRefresh = async function() {
    const btn = document.getElementById('startRefreshBtn');

    try {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Starting...';

        const requestBody = {};
        if (adminState.selectedScrapeRun) {
            requestBody.scrapeRunPath = adminState.selectedScrapeRun;
        }

        const response = await fetch(`${API_BASE}/api/admin/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(requestBody)
        });

        const result = await response.json();

        if (response.ok && result.success) {
            adminState.currentJobId = result.jobId;
            showAdminStatus(`Refresh started: ${result.jobId}`, 'success');

            // Show current job section and start polling
            document.getElementById('currentJobSection').style.display = 'block';
            startJobPolling();
        } else {
            throw new Error(result.error || 'Failed to start refresh');
        }
    } catch (error) {
        console.error('Failed to start refresh:', error);
        showAdminStatus(`Error: ${error.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-play"></i> Start Refresh from S3';
    }
};

// ============================================
// Job Status Polling
// ============================================

function startJobPolling() {
    // Clear any existing polling
    if (adminState.pollingInterval) {
        clearInterval(adminState.pollingInterval);
    }

    // Poll every 2 seconds
    adminState.pollingInterval = setInterval(async () => {
        await checkCurrentJob();
    }, 2000);

    // Also check immediately
    checkCurrentJob();
}

function stopJobPolling() {
    if (adminState.pollingInterval) {
        clearInterval(adminState.pollingInterval);
        adminState.pollingInterval = null;
    }
}

async function checkCurrentJob() {
    try {
        const response = await fetch(`${API_BASE}/api/admin/refresh/status`, {
            credentials: 'include'
        });

        const result = await response.json();

        if (response.ok && result.success && result.job) {
            updateJobDisplay(result.job);

            // Stop polling if job is complete or failed
            if (result.job.status === 'completed' || result.job.status === 'failed' || result.job.status === 'cancelled') {
                stopJobPolling();

                // Refresh stats after job completes
                await loadAdminStats();
            }
        } else {
            // No active job
            document.getElementById('currentJobSection').style.display = 'none';
            stopJobPolling();
        }
    } catch (error) {
        console.error('Failed to check job status:', error);
    }
}

function updateJobDisplay(job) {
    const section = document.getElementById('currentJobSection');
    section.style.display = 'block';

    // Update phase badge
    const phaseBadge = document.getElementById('jobPhaseBadge');
    phaseBadge.textContent = job.phase || job.status || 'Processing';
    phaseBadge.className = `job-phase-badge ${job.status}`;

    // Update message
    document.getElementById('jobMessage').textContent = job.message || '';

    // Update progress bar
    const progress = job.progress || 0;
    document.getElementById('jobProgressFill').style.width = `${progress}%`;

    // Update job details
    document.getElementById('jobId').textContent = job.id || adminState.currentJobId || '--';
    document.getElementById('jobStarted').textContent = job.startedAt
        ? new Date(job.startedAt).toLocaleTimeString()
        : '--';

    // Show/hide spinner based on status
    const spinner = document.getElementById('jobSpinner');
    if (job.status === 'running' || job.status === 'processing') {
        spinner.style.display = 'block';
    } else {
        spinner.style.display = 'none';
    }

    // Handle error display
    const errorEl = document.getElementById('jobError');
    if (job.error) {
        errorEl.style.display = 'block';
        errorEl.textContent = job.error;
    } else {
        errorEl.style.display = 'none';
    }

    // Handle results display
    const resultsEl = document.getElementById('jobResults');
    const resultsList = document.getElementById('jobResultsList');
    if (job.results && Object.keys(job.results).length > 0) {
        resultsEl.style.display = 'block';
        resultsList.innerHTML = '';
        for (const [key, value] of Object.entries(job.results)) {
            const li = document.createElement('li');
            li.textContent = `${key}: ${value}`;
            resultsList.appendChild(li);
        }
    } else {
        resultsEl.style.display = 'none';
    }
}

window.cancelCurrentJob = async function() {
    if (!adminState.currentJobId) {
        showAdminStatus('No active job to cancel', 'warning');
        return;
    }

    if (!confirm('Are you sure you want to cancel the current job?')) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/api/admin/refresh/jobs/${adminState.currentJobId}`, {
            method: 'DELETE',
            credentials: 'include'
        });

        const result = await response.json();

        if (response.ok && result.success) {
            showAdminStatus('Job cancelled', 'success');
            stopJobPolling();
            document.getElementById('currentJobSection').style.display = 'none';
            adminState.currentJobId = null;
        } else {
            showAdminStatus(`Failed to cancel job: ${result.error}`, 'error');
        }
    } catch (error) {
        showAdminStatus(`Error: ${error.message}`, 'error');
    }
};

// ============================================
// Database Reset
// ============================================

async function loadResetPreview() {
    const previewEl = document.getElementById('resetPreview');

    try {
        const response = await fetch(`${API_BASE}/api/admin/reset/preview`, {
            credentials: 'include'
        });

        const result = await response.json();

        if (response.ok && result.success) {
            previewEl.innerHTML = `
                <p class="warning-text"><i class="fas fa-exclamation-triangle"></i> This will delete:</p>
                <ul class="reset-list">
                    <li><strong>${formatNumber(result.entities || 0)}</strong> entities from Neo4j</li>
                    <li><strong>${formatNumber(result.relationships || 0)}</strong> relationships from Neo4j</li>
                    <li><strong>${formatNumber(result.embeddings || 0)}</strong> embeddings from PostgreSQL</li>
                </ul>
                <p class="backup-note"><i class="fas fa-shield-alt"></i> A backup will be created automatically before reset.</p>
            `;
        } else {
            previewEl.innerHTML = '<p class="warning-text">Unable to load preview</p>';
        }
    } catch (error) {
        console.error('Failed to load reset preview:', error);
        previewEl.innerHTML = '<p class="warning-text">Error loading preview</p>';
    }
}

window.showResetConfirm = function() {
    document.getElementById('resetConfirmModal').style.display = 'flex';
};

window.closeResetModal = function() {
    document.getElementById('resetConfirmModal').style.display = 'none';
};

window.confirmReset = async function() {
    const btn = document.querySelector('#resetConfirmModal .btn-danger');

    try {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Resetting...';

        const response = await fetch(`${API_BASE}/api/admin/reset`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-admin-confirm': 'true'
            },
            credentials: 'include'
        });

        const result = await response.json();

        if (response.ok && result.success) {
            closeResetModal();
            showAdminStatus('Database reset complete. Backup created.', 'success');

            // Refresh all admin data
            await refreshAdminStatus();
            await loadResetPreview();
        } else {
            throw new Error(result.error || 'Reset failed');
        }
    } catch (error) {
        console.error('Reset failed:', error);
        showAdminStatus(`Reset failed: ${error.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-trash-alt"></i> Yes, Reset Everything';
    }
};

// ============================================
// Admin Status Messages
// ============================================

function showAdminStatus(message, type = 'info') {
    const statusElement = document.getElementById('adminStatusMessage');
    statusElement.textContent = message;
    statusElement.className = `status-indicator status-${type}`;
    statusElement.style.display = 'block';

    // Auto-hide after 5 seconds for non-error messages
    if (type === 'success' || type === 'info') {
        setTimeout(() => {
            statusElement.style.display = 'none';
        }, 5000);
    }
}

// ============================================
// Export for global access
// ============================================

// Document management exports
window.refreshFolderTree = refreshFolderTree;
window.navigateToFolder = navigateToFolder;
window.toggleFileSelection = toggleFileSelection;
window.toggleSelectAll = toggleSelectAll;
window.filterFiles = filterFiles;
window.previousPage = previousPage;
window.nextPage = nextPage;
window.downloadSelectedFiles = downloadSelectedFiles;
window.deleteSelectedFiles = deleteSelectedFiles;
window.moveSelectedFiles = moveSelectedFiles;
window.closeMoveModal = closeMoveModal;
window.confirmMoveFiles = confirmMoveFiles;
window.createFolderForMove = createFolderForMove;
window.createFolderPrompt = createFolderPrompt;
window.closeCreateFolderModal = closeCreateFolderModal;
window.confirmCreateFolder = confirmCreateFolder;
window.deleteCurrentFolder = deleteCurrentFolder;

// Admin tab exports
window.refreshAdminStatus = refreshAdminStatus;
window.selectScrapeRun = selectScrapeRun;
window.startRefresh = startRefresh;
window.cancelCurrentJob = cancelCurrentJob;
window.showResetConfirm = showResetConfirm;
window.closeResetModal = closeResetModal;
window.confirmReset = confirmReset;
