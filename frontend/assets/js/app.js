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

    // Initialize processing tab if switching to it
    if (tabName === 'processing') {
        initializeProcessingTab();
    }
};

// ============================================
// Processing State
// ============================================

let processingState = {
    apiConfigured: false,
    currentScrapeRunPath: '',
    currentPhase: 'metadata',
    jobs: {
        metadata: null,
        pdf: null,
        embeddings: null
    },
    data: {
        products: [],
        categories: [],
        pdfs: [],
        entities: []
    }
};

// ============================================
// Processing Initialization
// ============================================

async function initializeProcessingTab() {
    await checkProcessingApiConfig();
    await refreshJobList();
}

async function checkProcessingApiConfig() {
    const statusElement = document.getElementById('processingApiStatus');

    try {
        const response = await fetch(`${API_BASE}/api/processing/config`, {
            credentials: 'include'
        });

        const result = await response.json();

        if (result.configured) {
            processingState.apiConfigured = true;
            statusElement.innerHTML = '<i class="fas fa-circle"></i> API Connected';
            statusElement.className = 'api-status connected';
        } else {
            processingState.apiConfigured = false;
            statusElement.innerHTML = '<i class="fas fa-circle"></i> API Key Not Configured';
            statusElement.className = 'api-status not-configured';
        }
    } catch (error) {
        processingState.apiConfigured = false;
        statusElement.innerHTML = '<i class="fas fa-circle"></i> API Unavailable';
        statusElement.className = 'api-status disconnected';
        console.error('Failed to check processing API config:', error);
    }
}

// ============================================
// Phase Navigation
// ============================================

window.switchPhase = function(phase) {
    processingState.currentPhase = phase;

    // Update phase tabs
    document.querySelectorAll('.phase-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.phase === phase);
    });

    // Update phase panels
    document.querySelectorAll('.phase-panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === phase + 'Phase');
    });
};

// ============================================
// Scrape Run Selection
// ============================================

let selectedScrapeRunPathTemp = null;

window.openScrapeRunSelector = async function() {
    document.getElementById('scrapeRunModal').style.display = 'flex';
    selectedScrapeRunPathTemp = null;
    document.getElementById('selectScrapeRunBtn').disabled = true;
    document.getElementById('selectedScrapeRun').style.display = 'none';

    await loadScrapeRunFolders();
};

window.closeScrapeRunModal = function() {
    document.getElementById('scrapeRunModal').style.display = 'none';
};

async function loadScrapeRunFolders() {
    const container = document.getElementById('scrapeRunFolderTree');
    container.innerHTML = '<div class="status-info"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';

    try {
        // Load the folder structure from S3
        const response = await fetch(`${API_BASE}/api/s3/structure/tree`, {
            credentials: 'include'
        });

        const result = await response.json();

        if (response.ok && result.tree_structure) {
            renderScrapeRunFolders(result.tree_structure.tree || []);
        } else {
            container.innerHTML = '<div class="status-info">Failed to load folders</div>';
        }
    } catch (error) {
        console.error('Failed to load scrape run folders:', error);
        container.innerHTML = '<div class="status-info">Error loading folders</div>';
    }
}

function renderScrapeRunFolders(tree, level = 0) {
    const container = document.getElementById('scrapeRunFolderTree');

    if (level === 0) {
        container.innerHTML = '';
    }

    tree.forEach(item => {
        if (item.type === 'folder') {
            const div = document.createElement('div');
            div.className = 'scrape-run-item';
            div.style.paddingLeft = `${level * 15 + 12}px`;
            div.innerHTML = `<i class="fas fa-folder"></i> ${item.name}`;
            div.dataset.path = item.path;
            div.onclick = () => selectScrapeRunFolder(item.path, div);
            container.appendChild(div);

            // Render children
            if (item.children && item.children.length > 0) {
                renderScrapeRunFolders(item.children, level + 1);
            }
        }
    });
}

function selectScrapeRunFolder(path, element) {
    document.querySelectorAll('.scrape-run-item').forEach(item => {
        item.classList.remove('selected');
    });
    element.classList.add('selected');

    selectedScrapeRunPathTemp = path;
    document.getElementById('selectedScrapeRunPath').textContent = path;
    document.getElementById('selectedScrapeRun').style.display = 'block';
    document.getElementById('selectScrapeRunBtn').disabled = false;
}

window.confirmScrapeRunSelection = function() {
    if (selectedScrapeRunPathTemp) {
        processingState.currentScrapeRunPath = selectedScrapeRunPathTemp;
        document.getElementById('scrapeRunPath').value = selectedScrapeRunPathTemp;
        closeScrapeRunModal();
        showProcessingStatus(`Scrape run selected: ${selectedScrapeRunPathTemp}`, 'success');
    }
};

// ============================================
// Phase 1: Metadata Processing
// ============================================

window.startMetadataProcessing = async function() {
    if (!processingState.apiConfigured) {
        showProcessingStatus('Processing API is not configured', 'error');
        return;
    }

    if (!processingState.currentScrapeRunPath) {
        showProcessingStatus('Please select a scrape run first', 'warning');
        return;
    }

    const batchSize = parseInt(document.getElementById('metadataBatchSize').value) || 10;
    const btn = document.getElementById('startMetadataBtn');

    try {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Starting...';

        // Step 1: Start the metadata job
        const startResponse = await fetch(`${API_BASE}/api/processing/metadata/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                scrapeRunPath: processingState.currentScrapeRunPath,
                options: { batchSize }
            })
        });

        const startResult = await startResponse.json();

        if (!startResult.success) {
            throw new Error(startResult.error || 'Failed to start metadata job');
        }

        processingState.jobs.metadata = startResult.jobId;
        showProcessingStatus(`Metadata job started: ${startResult.jobId}`, 'success');

        // Step 2: Load metadata
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading metadata...';

        const loadResponse = await fetch(`${API_BASE}/api/processing/metadata/load`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                jobId: startResult.jobId,
                scrapeRunPath: processingState.currentScrapeRunPath
            })
        });

        const loadResult = await loadResponse.json();

        if (!loadResult.success) {
            throw new Error(loadResult.error || 'Failed to load metadata');
        }

        processingState.data.products = loadResult.products || [];
        processingState.data.categories = loadResult.categories || [];

        const totalProducts = processingState.data.products.length;
        showProcessingStatus(`Loaded ${totalProducts} products, ${loadResult.totalCategories || 0} categories`, 'success');

        // Step 3: Process in batches
        if (totalProducts > 0) {
            await processMetadataBatches(startResult.jobId, batchSize);
        }

    } catch (error) {
        console.error('Metadata processing error:', error);
        showProcessingStatus(`Error: ${error.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-play"></i> Start Processing';
        await refreshJobList();
    }
};

async function processMetadataBatches(jobId, batchSize) {
    const products = processingState.data.products;
    const total = products.length;

    // Show progress
    const progressEl = document.getElementById('metadataProgress');
    const resultsEl = document.getElementById('metadataResults');
    const resultsListEl = document.getElementById('metadataResultsList');

    progressEl.style.display = 'block';
    resultsEl.style.display = 'block';
    resultsListEl.innerHTML = '';

    document.getElementById('metadataTotal').textContent = total;

    let processed = 0;
    let failed = 0;

    for (let i = 0; i < total; i += batchSize) {
        const batch = products.slice(i, i + batchSize);

        try {
            const response = await fetch(`${API_BASE}/api/processing/metadata/batch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    jobId,
                    products: batch
                })
            });

            const result = await response.json();

            if (result.success) {
                processed += result.processed || 0;
                failed += result.failed || 0;

                // Add results to list
                if (result.results) {
                    result.results.forEach(r => {
                        const itemHtml = `
                            <div class="result-item ${r.success ? 'success' : 'error'}">
                                <i class="fas fa-${r.success ? 'check-circle' : 'times-circle'}"></i>
                                <span class="result-name">${r.productName}</span>
                                <span class="result-stats">${r.success ? `${r.entitiesCreated} entities` : r.error || 'Failed'}</span>
                            </div>
                        `;
                        resultsListEl.insertAdjacentHTML('beforeend', itemHtml);
                    });
                }
            }
        } catch (error) {
            console.error('Batch processing error:', error);
            failed += batch.length;
        }

        // Update progress
        updateMetadataProgress(processed, failed, total);
    }

    // Mark phase as complete
    document.getElementById('metadataPhaseStatus').textContent = 'Complete';
    document.getElementById('metadataPhaseStatus').className = 'phase-status completed';
    document.querySelector('.phase-tab[data-phase="metadata"]').classList.add('completed');

    showProcessingStatus(`Metadata processing complete: ${processed} succeeded, ${failed} failed`, 'success');
}

function updateMetadataProgress(processed, failed, total) {
    const percent = Math.round((processed + failed) / total * 100);

    document.getElementById('metadataProcessed').textContent = processed;
    document.getElementById('metadataFailed').textContent = failed;
    document.getElementById('metadataProgressPercent').textContent = `${percent}%`;
    document.getElementById('metadataProgressFill').style.width = `${percent}%`;
    document.getElementById('metadataProgressLabel').textContent =
        `Processing products... (${processed + failed}/${total})`;
}

// ============================================
// Phase 2: PDF Processing
// ============================================

window.startPdfProcessing = async function() {
    if (!processingState.apiConfigured) {
        showProcessingStatus('Processing API is not configured', 'error');
        return;
    }

    if (!processingState.currentScrapeRunPath) {
        showProcessingStatus('Please select a scrape run first', 'warning');
        return;
    }

    const batchSize = parseInt(document.getElementById('pdfBatchSize').value) || 5;
    const chunkSize = parseInt(document.getElementById('chunkSize').value) || 1000;
    const btn = document.getElementById('startPdfBtn');

    try {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Starting...';

        // Step 1: Start the PDF job
        const startResponse = await fetch(`${API_BASE}/api/processing/pdf/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                scrapeRunPath: processingState.currentScrapeRunPath,
                options: { batchSize, chunkSize, chunkOverlap: 200 }
            })
        });

        const startResult = await startResponse.json();

        if (!startResult.success) {
            throw new Error(startResult.error || 'Failed to start PDF job');
        }

        processingState.jobs.pdf = startResult.jobId;
        showProcessingStatus(`PDF job started: ${startResult.jobId}`, 'success');

        // Step 2: List PDFs
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Listing PDFs...';

        const listResponse = await fetch(
            `${API_BASE}/api/processing/pdf/list?jobId=${startResult.jobId}&scrapeRunPath=${encodeURIComponent(processingState.currentScrapeRunPath)}`,
            { credentials: 'include' }
        );

        const listResult = await listResponse.json();

        if (!listResult.success) {
            throw new Error(listResult.error || 'Failed to list PDFs');
        }

        processingState.data.pdfs = listResult.pdfs || [];
        const totalPdfs = processingState.data.pdfs.length;

        // Display PDF list
        displayPdfList(processingState.data.pdfs);
        showProcessingStatus(`Found ${totalPdfs} PDFs to process`, 'success');

        // Step 3: Process PDFs in batches
        if (totalPdfs > 0) {
            await processPdfBatches(startResult.jobId, batchSize);
        }

    } catch (error) {
        console.error('PDF processing error:', error);
        showProcessingStatus(`Error: ${error.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-play"></i> Start Processing';
        await refreshJobList();
    }
};

function displayPdfList(pdfs) {
    const container = document.getElementById('pdfListContainer');
    const list = document.getElementById('pdfList');
    const count = document.getElementById('pdfCount');

    container.style.display = 'block';
    count.textContent = pdfs.length;

    list.innerHTML = pdfs.slice(0, 50).map(pdf => `
        <div class="pdf-item">
            <i class="fas fa-file-pdf"></i>
            <span class="pdf-name">${pdf.filename}</span>
            <span class="pdf-size">${formatFileSize(pdf.size || 0)}</span>
        </div>
    `).join('');

    if (pdfs.length > 50) {
        list.insertAdjacentHTML('beforeend', `
            <div class="pdf-item">
                <i class="fas fa-ellipsis-h"></i>
                <span class="pdf-name">... and ${pdfs.length - 50} more</span>
            </div>
        `);
    }
}

async function processPdfBatches(jobId, batchSize) {
    const pdfs = processingState.data.pdfs;
    const total = pdfs.length;

    // Show progress
    const progressEl = document.getElementById('pdfProgress');
    const resultsEl = document.getElementById('pdfResults');
    const resultsListEl = document.getElementById('pdfResultsList');

    progressEl.style.display = 'block';
    resultsEl.style.display = 'block';
    resultsListEl.innerHTML = '';

    document.getElementById('pdfTotal').textContent = total;

    let processed = 0;
    let failed = 0;

    for (let i = 0; i < total; i += batchSize) {
        const batch = pdfs.slice(i, i + batchSize);

        // For each PDF in the batch, we need to fetch its content from S3
        const pdfBatchData = [];

        for (const pdf of batch) {
            try {
                // Get presigned URL and download PDF content
                const downloadResponse = await fetch(
                    `${API_BASE}/api/s3/download?key=${encodeURIComponent(pdf.path)}`,
                    { credentials: 'include' }
                );

                if (downloadResponse.ok) {
                    const downloadResult = await downloadResponse.json();
                    if (downloadResult.url) {
                        // Fetch the actual PDF content
                        const pdfResponse = await fetch(downloadResult.url);
                        const pdfBlob = await pdfResponse.blob();
                        const base64Content = await blobToBase64(pdfBlob);

                        pdfBatchData.push({
                            ...pdf,
                            content: base64Content
                        });
                    }
                }
            } catch (error) {
                console.error(`Failed to fetch PDF ${pdf.filename}:`, error);
                failed++;
            }
        }

        // Process the batch
        if (pdfBatchData.length > 0) {
            try {
                const response = await fetch(`${API_BASE}/api/processing/pdf/batch`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        jobId,
                        pdfs: pdfBatchData
                    })
                });

                const result = await response.json();

                if (result.success) {
                    processed += result.processed || 0;
                    failed += result.failed || 0;

                    // Add results to list
                    if (result.results) {
                        result.results.forEach(r => {
                            const itemHtml = `
                                <div class="result-item ${r.success ? 'success' : 'error'}">
                                    <i class="fas fa-${r.success ? 'check-circle' : 'times-circle'}"></i>
                                    <span class="result-name">${r.filename}</span>
                                    <span class="result-stats">${r.success ? `${r.chunksCreated} chunks` : r.error || 'Failed'}</span>
                                </div>
                            `;
                            resultsListEl.insertAdjacentHTML('beforeend', itemHtml);
                        });
                    }
                }
            } catch (error) {
                console.error('Batch processing error:', error);
                failed += pdfBatchData.length;
            }
        }

        // Update progress
        updatePdfProgress(processed, failed, total);
    }

    // Mark phase as complete
    document.getElementById('pdfPhaseStatus').textContent = 'Complete';
    document.getElementById('pdfPhaseStatus').className = 'phase-status completed';
    document.querySelector('.phase-tab[data-phase="pdf"]').classList.add('completed');

    showProcessingStatus(`PDF processing complete: ${processed} succeeded, ${failed} failed`, 'success');
}

function updatePdfProgress(processed, failed, total) {
    const percent = Math.round((processed + failed) / total * 100);

    document.getElementById('pdfProcessed').textContent = processed;
    document.getElementById('pdfFailed').textContent = failed;
    document.getElementById('pdfProgressPercent').textContent = `${percent}%`;
    document.getElementById('pdfProgressFill').style.width = `${percent}%`;
    document.getElementById('pdfProgressLabel').textContent =
        `Processing PDFs... (${processed + failed}/${total})`;
}

// Helper function to convert blob to base64
function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64 = reader.result.split(',')[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// ============================================
// Phase 3: Embeddings Processing
// ============================================

window.startEmbeddingsProcessing = async function() {
    if (!processingState.apiConfigured) {
        showProcessingStatus('Processing API is not configured', 'error');
        return;
    }

    const batchSize = parseInt(document.getElementById('embeddingsBatchSize').value) || 20;
    const entityTypeFilter = document.getElementById('entityTypeFilter').value;
    const btn = document.getElementById('startEmbeddingsBtn');

    try {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Starting...';

        // Step 1: Start the embeddings job
        const options = { batchSize };
        if (entityTypeFilter) {
            options.entityTypes = [entityTypeFilter];
        }

        const startResponse = await fetch(`${API_BASE}/api/processing/embeddings/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ options })
        });

        const startResult = await startResponse.json();

        if (!startResult.success) {
            throw new Error(startResult.error || 'Failed to start embeddings job');
        }

        processingState.jobs.embeddings = startResult.jobId;
        showProcessingStatus(`Embeddings job started: ${startResult.jobId}`, 'success');

        // Step 2: List entities needing embeddings
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Listing entities...';

        const listResponse = await fetch(
            `${API_BASE}/api/processing/embeddings/entities?jobId=${startResult.jobId}&limit=1000`,
            { credentials: 'include' }
        );

        const listResult = await listResponse.json();

        if (!listResult.success) {
            throw new Error(listResult.error || 'Failed to list entities');
        }

        // Display summary
        displayEntitiesSummary(listResult);

        // Get entities without embeddings
        const entitiesWithoutEmbeddings = (listResult.entities || []).filter(e => !e.hasEmbedding);
        processingState.data.entities = entitiesWithoutEmbeddings;

        showProcessingStatus(`Found ${entitiesWithoutEmbeddings.length} entities without embeddings`, 'success');

        // Step 3: Generate embeddings in batches
        if (entitiesWithoutEmbeddings.length > 0) {
            await processEmbeddingsBatches(startResult.jobId, batchSize);
        }

    } catch (error) {
        console.error('Embeddings processing error:', error);
        showProcessingStatus(`Error: ${error.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-play"></i> Start Processing';
        await refreshJobList();
    }
};

function displayEntitiesSummary(data) {
    const summaryEl = document.getElementById('entitiesSummary');
    summaryEl.style.display = 'flex';

    document.getElementById('entitiesWithEmbeddings').textContent = data.withEmbeddings || 0;
    document.getElementById('entitiesWithoutEmbeddings').textContent = data.withoutEmbeddings || 0;
}

async function processEmbeddingsBatches(jobId, batchSize) {
    const entities = processingState.data.entities;
    const total = entities.length;

    // Show progress
    const progressEl = document.getElementById('embeddingsProgress');
    const resultsEl = document.getElementById('embeddingsResults');
    const resultsListEl = document.getElementById('embeddingsResultsList');

    progressEl.style.display = 'block';
    resultsEl.style.display = 'block';
    resultsListEl.innerHTML = '';

    document.getElementById('embeddingsTotal').textContent = total;

    let processed = 0;
    let failed = 0;

    for (let i = 0; i < total; i += batchSize) {
        const batch = entities.slice(i, i + batchSize);
        const entityNames = batch.map(e => e.name);

        try {
            const response = await fetch(`${API_BASE}/api/processing/embeddings/batch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    jobId,
                    entityNames
                })
            });

            const result = await response.json();

            if (result.success) {
                processed += result.processed || 0;
                failed += result.failed || 0;

                // Add results to list (show first few)
                if (result.results && resultsListEl.children.length < 50) {
                    result.results.slice(0, 5).forEach(r => {
                        const itemHtml = `
                            <div class="result-item ${r.success ? 'success' : 'error'}">
                                <i class="fas fa-${r.success ? 'check-circle' : 'times-circle'}"></i>
                                <span class="result-name">${r.entityName}</span>
                                <span class="result-stats">${r.success ? `${r.dimensions}d` : r.error || 'Failed'}</span>
                            </div>
                        `;
                        resultsListEl.insertAdjacentHTML('beforeend', itemHtml);
                    });
                }
            }
        } catch (error) {
            console.error('Batch processing error:', error);
            failed += batch.length;
        }

        // Update progress
        updateEmbeddingsProgress(processed, failed, total);
    }

    // Mark phase as complete
    document.getElementById('embeddingsPhaseStatus').textContent = 'Complete';
    document.getElementById('embeddingsPhaseStatus').className = 'phase-status completed';
    document.querySelector('.phase-tab[data-phase="embeddings"]').classList.add('completed');

    showProcessingStatus(`Embeddings generation complete: ${processed} succeeded, ${failed} failed`, 'success');
}

function updateEmbeddingsProgress(processed, failed, total) {
    const percent = Math.round((processed + failed) / total * 100);

    document.getElementById('embeddingsProcessed').textContent = processed;
    document.getElementById('embeddingsFailed').textContent = failed;
    document.getElementById('embeddingsProgressPercent').textContent = `${percent}%`;
    document.getElementById('embeddingsProgressFill').style.width = `${percent}%`;
    document.getElementById('embeddingsProgressLabel').textContent =
        `Generating embeddings... (${processed + failed}/${total})`;
}

// ============================================
// Job Management
// ============================================

async function refreshJobList() {
    const jobList = document.getElementById('jobList');

    try {
        const response = await fetch(`${API_BASE}/api/processing/jobs`, {
            credentials: 'include'
        });

        const result = await response.json();

        if (result.success && result.jobs && result.jobs.length > 0) {
            jobList.innerHTML = result.jobs.map(job => `
                <div class="job-item">
                    <span class="job-type ${job.type}">${job.type}</span>
                    <div class="job-info">
                        <div class="job-id">${job.id}</div>
                        <div class="job-progress-text">
                            ${job.progress ? `${job.progress.processed}/${job.progress.total} (${job.progress.percentage}%)` : 'Starting...'}
                        </div>
                    </div>
                    <span class="job-status ${job.status}">${job.status}</span>
                    <div class="job-actions">
                        ${job.status === 'running' ? `
                            <button type="button" class="btn btn-small btn-secondary" onclick="cancelJob('${job.id}')">
                                <i class="fas fa-stop"></i>
                            </button>
                        ` : ''}
                    </div>
                </div>
            `).join('');
        } else {
            jobList.innerHTML = '<div class="status-info">No active jobs</div>';
        }
    } catch (error) {
        console.error('Failed to refresh job list:', error);
    }
}

window.cancelJob = async function(jobId) {
    if (!confirm('Are you sure you want to cancel this job?')) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/api/processing/jobs/${jobId}`, {
            method: 'DELETE',
            credentials: 'include'
        });

        const result = await response.json();

        if (result.success) {
            showProcessingStatus('Job cancelled', 'success');
            await refreshJobList();
        } else {
            showProcessingStatus(`Failed to cancel job: ${result.error}`, 'error');
        }
    } catch (error) {
        showProcessingStatus(`Error: ${error.message}`, 'error');
    }
};

// ============================================
// Processing Status Messages
// ============================================

function showProcessingStatus(message, type = 'info') {
    const statusElement = document.getElementById('processingStatusMessage');
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
