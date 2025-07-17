// ===== DOM ELEMENTS =====
const pdfFile = document.getElementById('pdfFile');
const uploadBtn = document.getElementById('uploadBtn');
const uploadForm = document.getElementById('uploadForm');
const uploadArea = document.querySelector('.upload-area');
const progressContainer = document.getElementById('progressContainer');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');

// ===== UPLOAD FUNCTIONALITY =====
if (pdfFile && uploadBtn && uploadForm) {
    // File selection handler
    pdfFile.addEventListener('change', handleFileSelection);
    
    // Drag and drop functionality
    if (uploadArea) {
        setupDragAndDrop();
    }
    
    // Form submission handler
    uploadForm.addEventListener('submit', handleFormSubmission);
}

function handleFileSelection() {
    if (pdfFile.files.length > 0) {
        const file = pdfFile.files[0];
        uploadBtn.disabled = false;
        updateUploadContent(file);
    }
}

function updateUploadContent(file) {
    document.getElementById('uploadContent').innerHTML = `
        <i class="fas fa-file-pdf text-success mb-3 upload-icon"></i>
        <h5 class="text-success mb-2">${file.name}</h5>
        <p class="text-muted mb-0">${(file.size / 1024 / 1024).toFixed(2)} MB</p>
    `;
}

function setupDragAndDrop() {
    ['dragover', 'dragleave', 'drop'].forEach(eventName => {
        uploadArea.addEventListener(eventName, handleDragEvent);
    });
}

function handleDragEvent(e) {
    e.preventDefault();
    
    if (e.type === 'dragover') {
        this.classList.add('dragover');
    } else if (e.type === 'dragleave') {
        this.classList.remove('dragover');
    } else if (e.type === 'drop') {
        this.classList.remove('dragover');
        const files = e.dataTransfer.files;
        
        if (files.length > 0 && files[0].type === 'application/pdf') {
            pdfFile.files = files;
            handleFileSelection();
        } else {
            alert('Harap pilih file PDF yang valid!');
        }
    }
}

async function handleFormSubmission(e) {
    e.preventDefault();
    
    if (!pdfFile.files.length) {
        alert('Pilih file PDF terlebih dahulu!');
        return;
    }

    const formData = new FormData();
    formData.append('pdf', pdfFile.files[0]);
    
    setUploadState(true);
    showProgress(true);

    try {
        const xhr = new XMLHttpRequest();
        
        if (progressBar && progressText) {
            xhr.upload.addEventListener('progress', updateProgress);
        }

        xhr.onload = handleUploadComplete;
        xhr.onerror = handleUploadError;

        xhr.open('POST', '/api/upload');
        xhr.send(formData);
    } catch (error) {
        handleUploadError(error);
    }
}

function setUploadState(uploading) {
    uploadBtn.disabled = uploading;
    uploadBtn.innerHTML = uploading 
        ? '<i class="fas fa-spinner fa-spin me-2"></i>Uploading...'
        : '<i class="fas fa-upload me-2"></i>Upload & Parse PDF';
}

function showProgress(show) {
    if (progressContainer) {
        progressContainer.classList.toggle('d-none', !show);
    }
}

function updateProgress(e) {
    if (e.lengthComputable) {
        const percentComplete = (e.loaded / e.total) * 100;
        progressBar.style.width = percentComplete + '%';
        progressBar.setAttribute('aria-valuenow', percentComplete);
        progressText.textContent = Math.round(percentComplete) + '%';
    }
}

function handleUploadComplete() {
    if (this.status === 200) {
        const response = JSON.parse(this.responseText);
        if (response.success) {
            resetUploadForm();
            if (typeof loadFileList === 'function') {
                loadFileList();
            }
        } else {
            alert('❌ Error: ' + response.message);
        }
    } else {
        alert('❌ Terjadi kesalahan saat upload');
    }
    
    setUploadState(false);
    showProgress(false);
}

function handleUploadError() {
    alert('❌ Terjadi kesalahan jaringan');
    setUploadState(false);
    showProgress(false);
}

function resetUploadForm() {
    uploadForm.reset();
    uploadBtn.disabled = true;
    document.getElementById('uploadContent').innerHTML = `
        <i class="fas fa-cloud-upload-alt text-wiki-primary mb-3 upload-icon"></i>
        <h5 class="text-wiki-primary mb-2">Klik atau Drag & Drop PDF</h5>
        <p class="text-wiki-secondary mb-0">File maksimal 10MB</p>
    `;
}

// ===== FILE LIST FUNCTIONALITY =====
async function loadFileList() {
    const fileList = document.getElementById('fileList');
    if (!fileList) return;
    
    showLoadingState(fileList);

    try {
        const response = await fetch('/api/files');
        const data = await response.json();

        if (data.success && data.files.length > 0) {
            displayFileList(fileList, data.files);
        } else {
            showEmptyState(fileList);
        }
    } catch (error) {
        showErrorState(fileList);
    }
}

function showLoadingState(container) {
    container.innerHTML = `
        <div class="text-center text-muted">
            <i class="fas fa-spinner fa-spin mb-2 file-icon"></i>
            <p>Memuat daftar file...</p>
        </div>
    `;
}

function displayFileList(container, files) {
    container.innerHTML = files.map(file => `
        <div class="file-list-item border rounded p-3 mb-2 bg-light">
            <div class="d-flex justify-content-between align-items-center">
                <div class="flex-grow-1 me-2">
                    <h6 class="mb-1 text-primary">
                        <i class="fas fa-file-pdf me-2"></i>${file.filename}
                    </h6>
                    <small class="text-muted">
                        ${(file.size / 1024 / 1024).toFixed(2)} MB • 
                        ${new Date(file.uploadDate).toLocaleDateString('id-ID')}
                    </small>
                </div>
                <div class="btn-group btn-group-sm">
                    <a href="/api/view/${file.filename}" target="_blank" class="btn btn-primary btn-sm">
                        <i class="fas fa-eye"></i>
                    </a>
                    <a href="/api/download/${file.filename}" class="btn btn-success btn-sm">
                        <i class="fas fa-download"></i>
                    </a>
                </div>
            </div>
        </div>
    `).join('');
}

function showEmptyState(container) {
    container.innerHTML = `
        <div class="text-center text-muted">
            <i class="fas fa-folder-open mb-2 file-icon"></i>
            <p>Belum ada file PDF yang diupload</p>
        </div>
    `;
}

function showErrorState(container) {
    container.innerHTML = `
        <div class="text-center text-danger">
            <i class="fas fa-exclamation-triangle mb-2 file-icon"></i>
            <p>Gagal memuat daftar file</p>
        </div>
    `;
}

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', function() {
    if (typeof loadFileList === 'function') {
        loadFileList();
    }
});
