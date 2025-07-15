const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, '..', 'uploads', 'pdfs');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const filename = file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname);
    cb(null, filename);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Hanya file PDF yang diperbolehkan!'), false);
    }
  }
});

// Simple PDF text extraction
async function extractPdfText(filePath) {
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const uint8Array = new Uint8Array(dataBuffer);
    
    const pdfDocument = await pdfjsLib.getDocument({ data: uint8Array }).promise;
    const numPages = pdfDocument.numPages;
    let fullText = '';
    
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await pdfDocument.getPage(pageNum);
      const textContent = await page.getTextContent();
      
      let pageText = `\n========== HALAMAN ${pageNum} ==========\n`;
      textContent.items.forEach(item => {
        pageText += item.str + ' ';
      });
      
      fullText += pageText + '\n';
      page.cleanup();
    }
    
    pdfDocument.destroy();
    return {
      text: fullText,
      textLength: fullText.length,
      numPages: numPages
    };
  } catch (error) {
    throw new Error(`PDF extraction failed: ${error.message}`);
  }
}

// API Routes
router.get('/', (req, res) => {
  res.json({ message: 'PDF API Ready' });
});

router.post('/upload', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Tidak ada file yang diupload'
      });
    }

    // Extract text dan simpan
    const extractResult = await extractPdfText(req.file.path);
    const textFileName = req.file.filename.replace('.pdf', '.txt');
    const textFilePath = path.join(path.dirname(req.file.path), textFileName);
    fs.writeFileSync(textFilePath, extractResult.text, 'utf8');

    res.json({
      success: true,
      message: 'File PDF berhasil diupload dan diproses',
      data: {
        originalName: req.file.originalname,
        filename: req.file.filename,
        size: req.file.size,
        textLength: extractResult.textLength,
        numPages: extractResult.numPages,
        uploadDate: new Date()
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengupload file',
      error: error.message
    });
  }
});

router.get('/files', (req, res) => {
  try {
    const uploadsPath = path.join(__dirname, '..', 'uploads', 'pdfs');
    
    if (!fs.existsSync(uploadsPath)) {
      return res.json({ success: true, files: [] });
    }

    const files = fs.readdirSync(uploadsPath);
    const pdfFiles = files.filter(file => path.extname(file).toLowerCase() === '.pdf');
    
    const fileList = pdfFiles.map(filename => {
      const filePath = path.join(uploadsPath, filename);
      const stats = fs.statSync(filePath);
      
      return {
        filename: filename,
        size: stats.size,
        uploadDate: stats.birthtime
      };
    });

    res.json({ success: true, files: fileList });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil daftar file',
      error: error.message
    });
  }
});

router.get('/download/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(__dirname, '..', 'uploads', 'pdfs', filename);
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('File tidak ditemukan');
  }
  
  res.download(filePath, filename);
});

router.get('/view/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const textFileName = filename.replace('.pdf', '.txt');
    const textFilePath = path.join(__dirname, '..', 'uploads', 'pdfs', textFileName);

    if (!fs.existsSync(textFilePath)) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html lang="id">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>File Tidak Ditemukan</title>
            <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
        </head>
        <body class="bg-light">
            <div class="container mt-5">
                <div class="row justify-content-center">
                    <div class="col-md-8">
                        <div class="alert alert-danger text-center">
                            <h4>❌ File Tidak Ditemukan</h4>
                            <p>File teks hasil parsing tidak ditemukan. Silakan upload ulang PDF.</p>
                            <a href="/test" class="btn btn-primary">🔙 Kembali ke Upload</a>
                        </div>
                    </div>
                </div>
            </div>
        </body>
        </html>
      `);
    }

    const textContent = fs.readFileSync(textFilePath, 'utf8');
    
    // Format HTML dengan Bootstrap
    let htmlContent = textContent
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>')
      .replace(/========== HALAMAN (\d+) ==========/g, 
        '<div class="alert alert-primary mt-4"><h5 class="mb-0">📄 Halaman $1</h5></div>')
      .replace(/BAB ([IVXLCDM]+)/g, 
        '<h4 class="text-success mt-4 mb-3">📑 BAB $1</h4>')
      .replace(/Pasal (\d+)/g, 
        '<h5 class="text-info mt-3 mb-2">📜 Pasal $1</h5>');

    const htmlPage = `
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Hasil Parsing PDF - ${filename}</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
    <style>
        .pdf-content {
            font-family: 'Courier New', Monaco, monospace;
            font-size: 14px;
            line-height: 1.6;
            white-space: pre-wrap;
            word-wrap: break-word;
        }
        .navbar-brand {
            font-weight: bold;
        }
        .stats-card {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
        }
        @media print {
            .no-print { display: none !important; }
            .pdf-content { font-size: 12px; }
        }
    </style>
</head>
<body class="bg-light">
    <!-- Navbar -->
    <nav class="navbar navbar-expand-lg navbar-dark bg-primary no-print">
        <div class="container">
            <a class="navbar-brand" href="#">
                <i class="fas fa-file-pdf me-2"></i>Lintas Pasal
            </a>
            <div class="navbar-nav ms-auto">
                <a class="nav-link text-white" href="/test">
                    <i class="fas fa-upload me-1"></i>Upload PDF
                </a>
            </div>
        </div>
    </nav>

    <div class="container mt-4">
        <!-- Header -->
        <div class="row mb-4">
            <div class="col-12">
                <div class="card">
                    <div class="card-header bg-primary text-white">
                        <h4 class="mb-0">
                            <i class="fas fa-file-pdf me-2"></i>Hasil Parsing PDF
                        </h4>
                    </div>
                    <div class="card-body">
                        <h5 class="text-primary mb-3">📄 ${filename}</h5>
                        
                        <!-- Action Buttons -->
                        <div class="btn-group mb-3 no-print" role="group">
                            <a href="/api/download/${filename}" class="btn btn-success">
                                <i class="fas fa-download me-2"></i>Download PDF
                            </a>
                            <a href="/test" class="btn btn-secondary">
                                <i class="fas fa-arrow-left me-2"></i>Kembali
                            </a>
                            <button onclick="window.print()" class="btn btn-info">
                                <i class="fas fa-print me-2"></i>Print
                            </button>
                            <button onclick="copyToClipboard()" class="btn btn-warning">
                                <i class="fas fa-copy me-2"></i>Copy Text
                            </button>
                        </div>
                        
                        <!-- Stats -->
                        <div class="card stats-card">
                            <div class="card-body">
                                <div class="row text-center">
                                    <div class="col-md-4">
                                        <h6 class="mb-1">📊 Jumlah Karakter</h6>
                                        <strong>${textContent.length.toLocaleString('id-ID')}</strong>
                                    </div>
                                    <div class="col-md-4">
                                        <h6 class="mb-1">⚡ Metode Ekstraksi</h6>
                                        <strong>PDF.js</strong>
                                    </div>
                                    <div class="col-md-4">
                                        <h6 class="mb-1">� Waktu Parsing</h6>
                                        <strong>${new Date().toLocaleString('id-ID')}</strong>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- PDF Content -->
        <div class="row">
            <div class="col-12">
                <div class="card">
                    <div class="card-body">
                        <div class="pdf-content">
                            ${htmlContent}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- Footer -->
    <footer class="bg-dark text-white text-center py-3 mt-5 no-print">
        <div class="container">
            <p class="mb-0">© 2025 Lintas Pasal - PDF Parser & Viewer</p>
        </div>
    </footer>

    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"></script>
    <script>
        function copyToClipboard() {
            const textContent = document.querySelector('.pdf-content').innerText;
            navigator.clipboard.writeText(textContent).then(() => {
                alert('✅ Teks berhasil disalin ke clipboard!');
            }).catch(() => {
                alert('❌ Gagal menyalin teks');
            });
        }
        
        // Keyboard shortcuts
        document.addEventListener('keydown', function(e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
                e.preventDefault();
                window.print();
            }
        });
    </script>
</body>
</html>
    `;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(htmlPage);

  } catch (error) {
    res.status(500).send(`
      <!DOCTYPE html>
      <html lang="id">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Error</title>
          <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
      </head>
      <body class="bg-light">
          <div class="container mt-5">
              <div class="row justify-content-center">
                  <div class="col-md-8">
                      <div class="alert alert-danger text-center">
                          <h4>❌ Terjadi Kesalahan</h4>
                          <p>${error.message}</p>
                          <a href="/test" class="btn btn-primary">🔙 Kembali ke Upload</a>
                      </div>
                  </div>
              </div>
          </div>
      </body>
      </html>
    `);
  }
});

module.exports = router;
