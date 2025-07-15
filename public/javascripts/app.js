// Upload functionality
const pdfFile = document.getElementById('pdfFile');
const uploadBtn = document.getElementById('uploadBtn');
const uploadForm = document.getElementById('uploadForm');
const uploadArea = document.querySelector('.upload-area');
const progressContainer = document.getElementById('progressContainer');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');

if (pdfFile && uploadBtn && uploadForm) {
    pdfFile.addEventListener('change', function() {
        if (this.files.length > 0) {
            const file = this.files[0];
            uploadBtn.disabled = false;
            document.getElementById('uploadContent').innerHTML = `
                <i class="fas fa-file-pdf text-success mb-3" style="font-size: 3rem;"></i>
                <h5 class="text-success mb-2">${file.name}</h5>
                <p class="text-muted mb-0">${(file.size / 1024 / 1024).toFixed(2)} MB</p>
            `;
        }
    });

    // Drag and drop functionality
    if (uploadArea) {
        ['dragover', 'dragleave', 'drop'].forEach(eventName => {
            uploadArea.addEventListener(eventName, function(e) {
                e.preventDefault();
                if (eventName === 'dragover') this.classList.add('dragover');
                else if (eventName === 'dragleave') this.classList.remove('dragover');
                else {
                    this.classList.remove('dragover');
                    const files = e.dataTransfer.files;
                    if (files.length > 0 && files[0].type === 'application/pdf') {
                        pdfFile.files = files;
                        pdfFile.dispatchEvent(new Event('change'));
                    } else alert('Harap pilih file PDF yang valid!');
                }
            });
        });
    }

    uploadForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        if (!pdfFile.files.length) {
            alert('Pilih file PDF terlebih dahulu!');
            return;
        }

        const formData = new FormData();
        formData.append('pdf', pdfFile.files[0]);
        uploadBtn.disabled = true;
        uploadBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Uploading...';
        if (progressContainer) progressContainer.style.display = 'block';

        try {
            const xhr = new XMLHttpRequest();
            
            if (progressBar && progressText) {
                xhr.upload.addEventListener('progress', function(e) {
                    if (e.lengthComputable) {
                        const percentComplete = (e.loaded / e.total) * 100;
                        progressBar.style.width = percentComplete + '%';
                        progressText.textContent = Math.round(percentComplete) + '%';
                    }
                });
            }

            xhr.onload = function() {
                if (xhr.status === 200) {
                    const response = JSON.parse(xhr.responseText);
                    if (response.success) {
                        uploadForm.reset();
                        uploadBtn.disabled = true;
                        uploadBtn.innerHTML = '<i class="fas fa-upload me-2"></i>Upload & Parse PDF';
                        if (progressContainer) progressContainer.style.display = 'none';
                        document.getElementById('uploadContent').innerHTML = `
                            <i class="fas fa-cloud-upload-alt text-primary mb-3" style="font-size: 3rem;"></i>
                            <h5 class="text-primary mb-2">Klik atau Drag & Drop PDF</h5>
                            <p class="text-muted mb-0">File maksimal 10MB</p>
                        `;
                        if (typeof loadFileList === 'function') loadFileList();
                    } else alert('❌ Error: ' + response.message);
                } else alert('❌ Terjadi kesalahan saat upload');
                
                uploadBtn.disabled = false;
                uploadBtn.innerHTML = '<i class="fas fa-upload me-2"></i>Upload & Parse PDF';
                if (progressContainer) progressContainer.style.display = 'none';
            };

            xhr.onerror = function() {
                alert('❌ Terjadi kesalahan jaringan');
                uploadBtn.disabled = false;
                uploadBtn.innerHTML = '<i class="fas fa-upload me-2"></i>Upload & Parse PDF';
                if (progressContainer) progressContainer.style.display = 'none';
            };

            xhr.open('POST', '/api/upload');
            xhr.send(formData);
        } catch (error) {
            alert('❌ Error: ' + error.message);
            uploadBtn.disabled = false;
            uploadBtn.innerHTML = '<i class="fas fa-upload me-2"></i>Upload & Parse PDF';
            if (progressContainer) progressContainer.style.display = 'none';
        }
    });
}

// File list functionality
async function loadFileList() {
    const fileList = document.getElementById('fileList');
    if (!fileList) return;
    
    fileList.innerHTML = `
        <div class="text-center text-muted">
            <i class="fas fa-spinner fa-spin mb-2" style="font-size: 2rem;"></i>
            <p>Memuat daftar file...</p>
        </div>
    `;

    try {
        const response = await fetch('/api/files');
        const data = await response.json();

        if (data.success && data.files.length > 0) {
            fileList.innerHTML = data.files.map(file => `
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
        } else {
            fileList.innerHTML = `
                <div class="text-center text-muted">
                    <i class="fas fa-folder-open mb-2" style="font-size: 2rem;"></i>
                    <p>Belum ada file PDF yang diupload</p>
                </div>
            `;
        }
    } catch (error) {
        fileList.innerHTML = `
            <div class="text-center text-danger">
                <i class="fas fa-exclamation-triangle mb-2" style="font-size: 2rem;"></i>
                <p>Gagal memuat daftar file</p>
            </div>
        `;
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    if (typeof loadFileList === 'function') loadFileList();
});
